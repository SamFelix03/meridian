import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { DevNetAuthClient } from "@meridian/devnet-auth";
import type { FetchResult } from "@meridian/shared-types";
import {
  buildCreateReceivableProposalCommand,
  buildCoSignAndIssueCommand,
  buildCreateConsentPolicyCommand,
  buildCreateFinancingFactoryCommand,
  buildOpenFinancingRoundCommand,
  buildSubmitBidCommand,
  buildAwardBidCommand,
  buildPauseRoundCommand,
  buildEnterStaticFallbackCommand,
  buildReplaceBidCommand,
  buildExpireRoundCommand,
  buildMintHoldingCommand,
  buildRepayWithProofCommand,
  buildMarkOverdueCommand,
  buildAdvanceAllocationCommand,
  buildCreateSyndicationFactoryCommand,
  buildOpenSyndicationOfferingCommand,
  buildSubmitSyndicationBidCommand,
  buildReplaceSyndicationBidCommand,
  buildAwardSyndicationBidCommand,
  buildPauseSyndicationRoundCommand,
  buildSyndicationStaticFallbackCommand,
  buildExpireSyndicationRoundCommand,
  buildCreateBiddingMandateCommand,
  buildRevokeMandateCommand,
  buildUpdateMandateCommand,
  buildSetMandateAgentEnabledCommand,
  buildGrantComplianceObserverCommand,
  buildCreateRegulatorJurisdictionGrantCommand,
  buildRevokeRegulatorJurisdictionGrantCommand,
  extractAllocationCid,
  computeWaterfall,
  buildWaterfallAllocations,
  CIP56_INTERFACES,
  CASH,
  oracleAnchoredMode,
  staticReferenceMode,
  inlineConsent,
  TEMPLATE_IDS,
  INTERFACE_IDS,
} from "@meridian/ledger-client";
import {
  defaultManifestPath,
  extractCreatedContractId,
  loadPortalParties,
  proxyGet,
} from "./manifest.js";
import { loadCashManifest } from "./cash.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");

loadDotenv({ path: join(ROOT, ".env") });

const PORT = Number(process.env.PORTAL_API_PORT ?? 4000);
const SUPPLIER_INDEXER = process.env.SUPPLIER_INDEXER_URL ?? "http://127.0.0.1:4011";
const FINANCIER_INDEXER = process.env.FINANCIER_INDEXER_URL ?? "http://127.0.0.1:4013";
const FINANCIER_INDEXER_B = process.env.FINANCIER_INDEXER_B_URL ?? "http://127.0.0.1:4014";
const ORACLE_RELAY = process.env.ORACLE_RELAY_URL ?? "http://127.0.0.1:4021";
const REGISTRY_API = process.env.REGISTRY_API_URL ?? "http://127.0.0.1:4022";
const AGENT_RUNTIME = process.env.AGENT_RUNTIME_URL ?? "http://127.0.0.1:4025";
const REGULATOR_INDEXER = process.env.REGULATOR_INDEXER_URL ?? "http://127.0.0.1:4015";
const PLATFORM_INDEXER = process.env.PLATFORM_INDEXER_URL ?? "http://127.0.0.1:4016";
const KYB_GATEWAY = process.env.KYB_GATEWAY_URL ?? "http://127.0.0.1:8090";
const PARTY_PROVISIONER = process.env.PARTY_PROVISIONER_URL ?? "http://127.0.0.1:8091";
const KYB_COMPLETE_SECRET = process.env.KYB_COMPLETE_SECRET ?? "dev-kyb-secret";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function financingRequestId(pathname: string, suffix?: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  // /financing/:id or /financing/:id/award|pause|static-fallback|bid|replace-bid|expire
  if (parts[0] !== "financing" || !parts[1]) return null;
  const id = decodeURIComponent(parts[1]);
  if (suffix) {
    if (parts[2] !== suffix) return null;
  } else if (parts.length > 2) {
    return null;
  }
  return id;
}

function syndicationOfferingId(pathname: string, suffix?: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "syndication" || !parts[1] || parts[1] === "open") return null;
  const id = decodeURIComponent(parts[1]);
  if (suffix) {
    if (parts[2] !== suffix) return null;
  } else if (parts.length > 2) {
    return null;
  }
  return id;
}

function parseCapTableEntries(raw: unknown): Array<{ participant: string; shareBps: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const e = entry as Record<string, unknown>;
    return {
      participant: String(e.participant ?? ""),
      shareBps: Number(e.shareBps ?? 0),
    };
  });
}

async function findOrCreateSyndicationFactory(
  client: Awaited<ReturnType<DevNetAuthClient["createAuthenticatedLedgerClient"]>>,
  leadFinancier: string
): Promise<string> {
  const factories = await client.getActiveContractsByTemplate(
    leadFinancier,
    TEMPLATE_IDS.syndicationFactory
  );
  if (factories.length > 0) {
    return factories[0]!.contractId;
  }
  const cmd = buildCreateSyndicationFactoryCommand({ leadFinancier });
  const result = await client.submitAndWaitForTransaction({
    actAs: [leadFinancier],
    commands: [cmd],
  });
  const factoryId = extractCreatedContractId(result);
  if (!factoryId) throw new Error("syndication factory creation did not return contract id");
  return factoryId;
}

async function fetchReceivablePayload(
  client: Awaited<ReturnType<DevNetAuthClient["createAuthenticatedLedgerClient"]>>,
  supplierPartyId: string,
  receivableCid: string
): Promise<Record<string, unknown> | null> {
  const rows = await client.getActiveContractsByTemplate(
    supplierPartyId,
    TEMPLATE_IDS.receivable
  );
  const row = rows.find((r) => r.contractId === receivableCid);
  return (row?.payload as Record<string, unknown> | undefined) ?? null;
}

async function resolveSyndicationOfferingCid(
  client: Awaited<ReturnType<DevNetAuthClient["createAuthenticatedLedgerClient"]>>,
  lead: string,
  offeringContractId: string,
  offeringId?: string
): Promise<string> {
  const rows = await client.getActiveContractsByTemplate(lead, TEMPLATE_IDS.syndicationOffering);
  const direct = rows.find((r) => r.contractId === offeringContractId);
  if (direct) return offeringContractId;
  if (offeringId) {
    const byBusinessId = rows.find(
      (r) => String((r.payload as Record<string, unknown>).offeringId) === offeringId
    );
    if (byBusinessId) return byBusinessId.contractId;
  }
  const openRounds = rows.filter((r) => {
    const state = String((r.payload as Record<string, unknown>).roundState ?? "");
    return state === "RoundOpen" || state === "StaticReferenceFallback";
  });
  if (openRounds.length === 1) return openRounds[0]!.contractId;
  throw new Error(
    "syndication offering contract id is stale — refresh offerings after bid submission"
  );
}

async function fetchOracleFeed(): Promise<FetchResult> {
  const res = await fetch(`${ORACLE_RELAY}/feeds/latest`);
  if (!res.ok) {
    throw new Error(`oracle relay ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as FetchResult;
}

async function findOrCreateFinancingFactory(
  client: Awaited<ReturnType<DevNetAuthClient["createAuthenticatedLedgerClient"]>>,
  supplierPartyId: string
): Promise<string> {
  const factories = await client.getActiveContractsByTemplate(
    supplierPartyId,
    TEMPLATE_IDS.financingRoundFactory
  );
  if (factories.length > 0) {
    return factories[0]!.contractId;
  }
  const cmd = buildCreateFinancingFactoryCommand({ supplier: supplierPartyId });
  const result = await client.submitAndWaitForTransaction({
    actAs: [supplierPartyId],
    commands: [cmd],
  });
  const factoryId = extractCreatedContractId(result);
  if (!factoryId) throw new Error("factory creation did not return contract id");
  return factoryId;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: DevNetAuthClient,
  parties: ReturnType<typeof loadPortalParties>
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/buyer/obligations") {
      const data = await proxyGet(`${process.env.BUYER_INDEXER_URL ?? "http://127.0.0.1:4012"}/buyer/obligations`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/buyer/repayable-obligations") {
      const data = await proxyGet(
        `${process.env.BUYER_INDEXER_URL ?? "http://127.0.0.1:4012"}/buyer/repayable-obligations`
      );
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/buyer/pending-proposals") {
      const data = await proxyGet(`${process.env.BUYER_INDEXER_URL ?? "http://127.0.0.1:4012"}/buyer/pending-proposals`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/supplier/receivables") {
      const data = await proxyGet(`${SUPPLIER_INDEXER}/supplier/receivables`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/supplier/consent-policies") {
      const data = await proxyGet(`${SUPPLIER_INDEXER}/supplier/consent-policies`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financing/rounds") {
      const data = await proxyGet(`${SUPPLIER_INDEXER}/supplier/financing-rounds`);
      json(res, 200, data);
      return;
    }

    const bidsRequestId = financingRequestId(url.pathname, "bids");
    if (req.method === "GET" && bidsRequestId) {
      const data = await proxyGet(
        `${SUPPLIER_INDEXER}/supplier/bid-comparison/${encodeURIComponent(bidsRequestId)}`
      );
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/invitations") {
      const data = await proxyGet(`${FINANCIER_INDEXER}/financier/invitations`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/my-bids") {
      const data = await proxyGet(`${FINANCIER_INDEXER}/financier/my-bids`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/mandates") {
      const data = await proxyGet(`${FINANCIER_INDEXER}/financier/mandates`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/agent/status") {
      const agentRes = await fetch(`${AGENT_RUNTIME}/status`);
      if (!agentRes.ok) {
        json(res, 502, { error: await agentRes.text() });
        return;
      }
      json(res, 200, await agentRes.json());
      return;
    }

    if (req.method === "POST" && url.pathname === "/financier/agent/tick") {
      const agentRes = await fetch(`${AGENT_RUNTIME}/tick`, { method: "POST" });
      const payload = await agentRes.json();
      json(res, agentRes.ok ? 200 : 500, payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/syndication/offerings") {
      const data = await proxyGet(`${FINANCIER_INDEXER}/financier/syndication/offerings`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/syndication/invitations") {
      const data = await proxyGet(`${FINANCIER_INDEXER_B}/financier/syndication/invitations`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/syndication/my-interests") {
      const tab = url.searchParams.get("tab");
      const base =
        tab === "lead" ? FINANCIER_INDEXER : FINANCIER_INDEXER_B;
      const data = await proxyGet(`${base}/financier/syndication/my-interests`);
      json(res, 200, data);
      return;
    }

    const capTablePath = url.pathname.match(/^\/financier\/syndication\/cap-table\/([^/]+)$/);
    if (req.method === "GET" && capTablePath) {
      const receivableId = decodeURIComponent(capTablePath[1]!);
      const data = await proxyGet(
        `${FINANCIER_INDEXER}/financier/syndication/cap-table/${encodeURIComponent(receivableId)}`
      );
      json(res, 200, data);
      return;
    }

    const syndicationBidsPath = url.pathname.match(/^\/financier\/syndication\/bids\/([^/]+)$/);
    if (req.method === "GET" && syndicationBidsPath) {
      const offeringId = decodeURIComponent(syndicationBidsPath[1]!);
      const data = await proxyGet(
        `${FINANCIER_INDEXER}/financier/syndication/bids/${encodeURIComponent(offeringId)}`
      );
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/regulator/exposure") {
      const jurisdiction = url.searchParams.get("jurisdiction");
      const path = jurisdiction
        ? `/regulator/exposure?jurisdiction=${encodeURIComponent(jurisdiction)}`
        : "/regulator/exposure";
      const data = await proxyGet(`${REGULATOR_INDEXER}${path}`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/ops/settlement-finality") {
      const data = await proxyGet(`${PLATFORM_INDEXER}/ops/settlement-finality`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/ops/regulator-grants") {
      const data = await proxyGet(`${PLATFORM_INDEXER}/ops/regulator-grants`);
      json(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/ops/oracle-health") {
      const [health, feeds] = await Promise.all([
        fetch(`${ORACLE_RELAY}/health`).then((r) => r.json()),
        fetch(`${ORACLE_RELAY}/feeds/latest`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      const feedBody = feeds as FetchResult | null;
      json(res, 200, {
        ok: Boolean((health as { ok?: boolean }).ok),
        service: "oracle-relay",
        isFresh: Boolean(feedBody?.isFresh),
        cached: feedBody != null,
        lastError: (health as { lastError?: string | null }).lastError ?? null,
        fault: (health as { fault?: string | null }).fault ?? null,
        referenceRate: feedBody?.referenceRate
          ? {
              feedId: feedBody.referenceRate.feedId,
              value: feedBody.referenceRate.value,
              ageMs: feedBody.ageMs,
            }
          : null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/parties") {
      json(res, 200, {
        supplier: parties.supplier.partyId,
        buyer: parties.buyer.partyId,
        financierA: parties.financierA.partyId,
        financierB: parties.financierB.partyId,
        platformOperator: parties.platformOperator.partyId,
        regulator: parties.regulator.partyId,
      });
      return;
    }

    const client = await auth.createAuthenticatedLedgerClient();

    if (req.method === "POST" && url.pathname === "/kyb/verify") {
      const body = await readBody(req);
      const kybRes = await fetch(`${KYB_GATEWAY}/v1/kyb/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await kybRes.text();
      json(res, kybRes.status, JSON.parse(text));
      return;
    }

    const kybCompleteMatch = url.pathname.match(/^\/kyb\/verify\/([^/]+)\/complete$/);
    if (req.method === "POST" && kybCompleteMatch) {
      const verificationId = decodeURIComponent(kybCompleteMatch[1] ?? "");
      const body = await readBody(req);
      const kybRes = await fetch(
        `${KYB_GATEWAY}/v1/kyb/verify/${encodeURIComponent(verificationId)}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${KYB_COMPLETE_SECRET}`,
          },
          body: JSON.stringify(body),
        }
      );
      const text = await kybRes.text();
      json(res, kybRes.status, JSON.parse(text));
      return;
    }

    if (req.method === "POST" && url.pathname === "/parties/allocate") {
      const body = await readBody(req);
      const provRes = await fetch(`${PARTY_PROVISIONER}/v1/parties/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await provRes.text();
      json(res, provRes.status, JSON.parse(text));
      return;
    }

    if (req.method === "POST" && url.pathname === "/ops/regulator-grants") {
      const body = (await readBody(req)) as {
        grantId?: string;
        jurisdiction?: string;
      };
      const cmd = buildCreateRegulatorJurisdictionGrantCommand({
        grantId: body.grantId ?? `GRANT-${Date.now()}`,
        platformOperator: parties.platformOperator.partyId,
        regulator: parties.regulator.partyId,
        jurisdiction: body.jurisdiction ?? "US",
      });
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.platformOperator.partyId],
        commands: [cmd],
      });
      json(res, 201, {
        contractId: extractCreatedContractId(result, "RegulatorJurisdictionGrant"),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const revokeGrantMatch = url.pathname.match(/^\/ops\/regulator-grants\/([^/]+)$/);
    if (req.method === "PATCH" && revokeGrantMatch) {
      const grantContractId = decodeURIComponent(revokeGrantMatch[1] ?? "");
      const body = (await readBody(req)) as { action?: string };
      if (body.action !== "revoke") {
        json(res, 400, { error: "only action=revoke supported" });
        return;
      }
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.platformOperator.partyId],
        commands: [buildRevokeRegulatorJurisdictionGrantCommand({ grantContractId })],
      });
      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const grantObserverMatch = url.pathname.match(/^\/ops\/receivables\/([^/]+)\/grant-observer$/);
    if (req.method === "POST" && grantObserverMatch) {
      const receivableContractId = decodeURIComponent(grantObserverMatch[1] ?? "");
      const body = (await readBody(req)) as { jurisdiction?: string };
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.platformOperator.partyId],
        commands: [
          buildGrantComplianceObserverCommand({
            receivableContractId,
            observerParty: parties.regulator.partyId,
            expectedJurisdiction: body.jurisdiction ?? "US",
          }),
        ],
      });
      json(res, 200, {
        receivableContractId: extractCreatedContractId(result, "Receivable:Receivable"),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/financier/mandates") {
      const body = (await readBody(req)) as {
        mandateId?: string;
        maxExposure?: string;
        minSpread?: string;
        eligibleSuppliers?: string[];
        agentEnabled?: boolean;
      };
      if (!body.mandateId || !body.maxExposure || body.minSpread == null) {
        json(res, 400, { error: "mandateId, maxExposure, and minSpread required" });
        return;
      }
      const cmd = buildCreateBiddingMandateCommand({
        mandateId: body.mandateId,
        financier: parties.financierA.partyId,
        maxExposure: body.maxExposure,
        minSpread: body.minSpread,
        eligibleSuppliers: body.eligibleSuppliers ?? [],
        agentEnabled: body.agentEnabled ?? true,
      });
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA.partyId],
        commands: [cmd],
      });
      json(res, 201, {
        contractId: extractCreatedContractId(result, "BiddingMandate"),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const mandatePatch = url.pathname.match(/^\/financier\/mandates\/([^/]+)$/);
    if (req.method === "PATCH" && mandatePatch) {
      const mandateContractId = decodeURIComponent(mandatePatch[1] ?? "");
      const body = (await readBody(req)) as {
        action?: "revoke" | "update" | "setAgentEnabled";
        maxExposure?: string;
        minSpread?: string;
        eligibleSuppliers?: string[];
        agentEnabled?: boolean;
      };
      const action = body.action ?? "update";
      let cmd;
      if (action === "revoke") {
        cmd = buildRevokeMandateCommand({ mandateContractId });
      } else if (action === "setAgentEnabled") {
        if (body.agentEnabled == null) {
          json(res, 400, { error: "agentEnabled required for setAgentEnabled" });
          return;
        }
        cmd = buildSetMandateAgentEnabledCommand({
          mandateContractId,
          enabled: body.agentEnabled,
        });
      } else {
        if (!body.maxExposure || body.minSpread == null) {
          json(res, 400, { error: "maxExposure and minSpread required for update" });
          return;
        }
        cmd = buildUpdateMandateCommand({
          mandateContractId,
          maxExposure: body.maxExposure,
          minSpread: body.minSpread,
          eligibleSuppliers: body.eligibleSuppliers ?? [],
        });
      }
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA.partyId],
        commands: [cmd],
      });
      json(res, 200, {
        contractId: extractCreatedContractId(result, "BiddingMandate") ?? mandateContractId,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/invoices/propose") {
      const body = (await readBody(req)) as {
        proposalId?: string;
        lineItems?: Array<{ description: string; quantity: string; unitPrice: string }>;
        faceValue?: string;
        currency?: string;
        dueDate?: string;
        consentGranted?: boolean;
      };

      const cmd = buildCreateReceivableProposalCommand({
        proposalId: body.proposalId ?? `INV-${Date.now()}`,
        supplier: parties.supplier.partyId,
        buyer: parties.buyer.partyId,
        lineItems: body.lineItems ?? [
          { description: "Services", quantity: "1", unitPrice: body.faceValue ?? "1000" },
        ],
        faceValue: body.faceValue ?? "1000",
        currency: body.currency ?? "USD",
        dueDate: body.dueDate ?? "2026-12-31",
        consentSource: inlineConsent(body.consentGranted ?? true),
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId],
        commands: [cmd],
      });

      json(res, 201, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/invoices/") && url.pathname.endsWith("/cosign")) {
      const contractId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const body = (await readBody(req)) as { jurisdiction?: string | null };
      const cmd = buildCoSignAndIssueCommand({
        proposalContractId: contractId,
        jurisdiction: body.jurisdiction ?? "US",
        platformOperator: parties.platformOperator.partyId,
      });
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.buyer.partyId],
        commands: [cmd],
      });

      json(res, 200, {
        receivableContractId: extractCreatedContractId(result, "Receivable:Receivable"),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/consent-policies") {
      const body = (await readBody(req)) as {
        masterAgreementId?: string;
        allowsAssignment?: boolean;
      };

      const cmd = buildCreateConsentPolicyCommand({
        buyer: parties.buyer.partyId,
        supplier: parties.supplier.partyId,
        masterAgreementId: body.masterAgreementId ?? `MA-${Date.now()}`,
        grantedAt: new Date().toISOString(),
        allowsAssignment: body.allowsAssignment ?? true,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.buyer.partyId],
        commands: [cmd],
      });

      json(res, 201, {
        contractId: extractCreatedContractId(result),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/financing/open") {
      const body = (await readBody(req)) as {
        receivableCid?: string;
        requestId?: string;
        financiers?: string[];
        deadline?: string;
        pricingBandMin?: string;
        pricingBandMax?: string;
        redstoneFeedId?: number[];
      };

      if (!body.receivableCid) {
        json(res, 400, { error: "receivableCid required" });
        return;
      }

      const factoryId = await findOrCreateFinancingFactory(client, parties.supplier.partyId);
      const defaultFinanciers = [
        parties.financierA.partyId,
        parties.financierB.partyId,
      ];
      const feedId =
        body.redstoneFeedId ?? "SOFR".split("").map((ch) => ch.charCodeAt(0));

      const cmd = buildOpenFinancingRoundCommand({
        factoryContractId: factoryId,
        receivableCid: body.receivableCid,
        requestId: body.requestId ?? `ROUND-${Date.now()}`,
        financiers: body.financiers ?? defaultFinanciers,
        deadline: body.deadline ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        pricingBandMin: body.pricingBandMin ?? "0.01",
        pricingBandMax: body.pricingBandMax ?? "0.15",
        redstoneFeedId: feedId,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId],
        commands: [cmd],
      });

      json(res, 201, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const awardId = financingRequestId(url.pathname, "award");
    if (req.method === "POST" && awardId) {
      const body = (await readBody(req)) as {
        winningBidCid?: string;
        advanceAmount?: string;
        financierPartyId?: string;
      };
      if (!body.winningBidCid) {
        json(res, 400, { error: "winningBidCid required" });
        return;
      }

      const cash = loadCashManifest(ROOT);
      const financier = body.financierPartyId ?? parties.financierA.partyId;
      const advance = body.advanceAmount ?? "1500.0";
      const now = new Date().toISOString();
      const weekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      const holdings = await client.getActiveContractsByInterface(
        financier,
        CIP56_INTERFACES.holding
      );
      const holdingCids = holdings
        .filter((h) => h.templateId.includes("MusdHolding"))
        .map((h) => h.contractId);
      if (holdingCids.length === 0) {
        json(res, 400, { error: "financier has no MUSD holdings — bootstrap cash first" });
        return;
      }

      const allocResult = await client.submitAndWaitForTransaction({
        actAs: [financier, cash.registryAdminPartyId],
        commands: [
          buildAdvanceAllocationCommand({
            rulesContractId: cash.rulesContractId,
            registryAdmin: cash.registryAdminPartyId,
            executor: parties.supplier.partyId,
            financier,
            supplier: parties.supplier.partyId,
            advanceAmount: advance,
            inputHoldingCids: holdingCids.slice(0, 1),
            requestedAt: now,
            allocateBefore: weekLater,
            settleBefore: twoWeeks,
          }),
        ],
      });
      const allocationCid = extractAllocationCid(allocResult);
      if (!allocationCid) {
        json(res, 500, { error: "allocation creation failed" });
        return;
      }

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId, financier],
        commands: [
          buildAwardBidCommand({
            requestContractId: awardId,
            winningBidCid: body.winningBidCid,
            settlementAllocationCid: allocationCid,
            expectedAdvance: advance,
            settlementFinancier: financier,
          }),
        ],
      });

      json(res, 200, {
        receivableContractId: extractCreatedContractId(result),
        settlementAllocationCid: allocationCid,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/cash/holdings") {
      const party = new URL(req.url ?? "/", "http://local").searchParams.get("party");
      if (!party) {
        json(res, 400, { error: "party query param required" });
        return;
      }
      const data = await proxyGet(`${REGISTRY_API}/registry/holdings/${encodeURIComponent(party)}`);
      json(res, 200, data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/cash/bootstrap") {
      json(res, 501, { error: "run pnpm bootstrap:cash:devnet from CLI" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/supplier/portfolio") {
      json(res, 200, await proxyGet(`${SUPPLIER_INDEXER}/supplier/portfolio`));
      return;
    }

    if (req.method === "GET" && url.pathname === "/financier/positions") {
      // Financier is not an observer on Receivable contracts, so we query the
      // supplier indexer (which sees all Receivables as signatory) filtered by
      // payeeOfRecord.payee === financierA.
      const financierPartyId = encodeURIComponent(parties.financierA.partyId);
      json(
        res,
        200,
        await proxyGet(`${SUPPLIER_INDEXER}/financier/positions/${financierPartyId}`)
      );
      return;
    }

    const repayMatch = url.pathname.match(/^\/receivables\/([^/]+)\/repay$/);
    if (req.method === "POST" && repayMatch) {
      const receivableCid = decodeURIComponent(repayMatch[1]!);
      const body = (await readBody(req)) as {
        faceValue?: string;
        payeePartyId?: string;
        settlementRef?: string;
      };
      const cash = loadCashManifest(ROOT);
      const receivablePayload = await fetchReceivablePayload(
        client,
        parties.supplier.partyId,
        receivableCid
      );
      const amount = body.faceValue ?? String(receivablePayload?.faceValue ?? "2000.0");
      const payee =
        body.payeePartyId ??
        String(
          (receivablePayload?.payeeOfRecord as Record<string, unknown> | undefined)?.payee ??
            parties.financierA.partyId
        );
      const state = String(receivablePayload?.state ?? "");
      const capTable = parseCapTableEntries(receivablePayload?.capTable);
      const now = new Date().toISOString();
      const weekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      let allocationCids: string[];
      let syndicationParticipants: string[] = [];

      if (state === "PartiallySyndicated" && capTable.length > 0) {
        const faceValueNum = Number(amount);
        const recipients = computeWaterfall(faceValueNum, capTable, payee);
        allocationCids = await buildWaterfallAllocations(client, {
          rulesContractId: cash.rulesContractId,
          registryAdmin: cash.registryAdminPartyId,
          executor: parties.supplier.partyId,
          buyer: parties.buyer.partyId,
          recipients,
          requestedAt: now,
          allocateBefore: weekLater,
          settleBefore: twoWeeks,
        });
        syndicationParticipants = capTable.map((e) => e.participant);
      } else {
        const buyerHoldingRows = await client.getActiveContractsByTemplate(
          parties.buyer.partyId,
          CASH.musdHolding
        );
        const buyerHoldingCids = buyerHoldingRows
          .filter((h) => {
            const p = h.payload as {
              holding?: { instrumentId?: { id?: string; admin?: string }; lock?: unknown };
            };
            return (
              p.holding?.instrumentId?.id === "MUSD" &&
              p.holding?.instrumentId?.admin === cash.registryAdminPartyId &&
              !p.holding?.lock
            );
          })
          .map((h) => h.contractId);
        if (buyerHoldingCids.length === 0) {
          json(res, 400, { error: "buyer has no MUSD holdings" });
          return;
        }

        const allocResult = await client.submitAndWaitForTransaction({
          actAs: [parties.buyer.partyId, cash.registryAdminPartyId],
          commands: [
            buildAdvanceAllocationCommand({
              rulesContractId: cash.rulesContractId,
              registryAdmin: cash.registryAdminPartyId,
              executor: parties.supplier.partyId,
              financier: parties.buyer.partyId,
              supplier: payee,
              advanceAmount: amount,
              inputHoldingCids: buyerHoldingCids,
              requestedAt: now,
              allocateBefore: weekLater,
              settleBefore: twoWeeks,
            }),
          ],
        });
        const allocationCid = extractAllocationCid(allocResult);
        if (!allocationCid) {
          json(res, 500, { error: "repayment allocation failed" });
          return;
        }
        allocationCids = [allocationCid];
      }

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.buyer.partyId, payee, parties.supplier.partyId, ...syndicationParticipants],
        commands: [
          buildRepayWithProofCommand({
            receivableContractId: receivableCid,
            settlementAllocationCids: allocationCids,
            expectedAmount: amount,
            settlementRef: body.settlementRef ?? `repay-${Date.now()}`,
            syndicationParticipants,
          }),
        ],
      });

      json(res, 200, {
        receivableContractId: extractCreatedContractId(result, "Receivable"),
        proofContractId: extractCreatedContractId(result, "RepaymentProof"),
        settlementAllocationCids: allocationCids,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const overdueMatch = url.pathname.match(/^\/receivables\/([^/]+)\/mark-overdue$/);
    if (req.method === "POST" && overdueMatch) {
      const receivableCid = decodeURIComponent(overdueMatch[1]!);
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId],
        commands: [buildMarkOverdueCommand({ receivableContractId: receivableCid })],
      });
      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const pauseId = financingRequestId(url.pathname, "pause");
    if (req.method === "POST" && pauseId) {
      const cmd = buildPauseRoundCommand(pauseId);
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId],
        commands: [cmd],
      });

      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const fallbackId = financingRequestId(url.pathname, "static-fallback");
    if (req.method === "POST" && fallbackId) {
      const cmd = buildEnterStaticFallbackCommand(fallbackId);
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId],
        commands: [cmd],
      });

      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const expireId = financingRequestId(url.pathname, "expire");
    if (req.method === "POST" && expireId) {
      const cmd = buildExpireRoundCommand({ requestContractId: expireId });
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier.partyId],
        commands: [cmd],
      });

      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const bidRequestId = financingRequestId(url.pathname, "bid");
    if (req.method === "POST" && bidRequestId) {
      const body = (await readBody(req)) as {
        advanceAmount?: string;
        discountRate?: string;
        useStaticReference?: boolean;
        viaAgent?: boolean;
        mandateContractId?: string;
      };

      if (!body.advanceAmount || !body.discountRate) {
        json(res, 400, { error: "advanceAmount and discountRate required" });
        return;
      }

      const oracle = await fetchOracleFeed();
      const mode = body.useStaticReference ? staticReferenceMode() : oracleAnchoredMode();
      const ledgerTime = new Date(oracle.packageTimestampMs).toISOString();
      const viaAgent = body.viaAgent ?? false;

      const cmd = buildSubmitBidCommand({
        requestContractId: bidRequestId,
        financier: parties.financierA.partyId,
        advanceAmount: body.advanceAmount,
        discountRate: body.discountRate,
        redstonePayload: oracle.canton.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode,
        ledgerTime,
        viaAgent,
        mandateContractId: viaAgent ? body.mandateContractId : null,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA.partyId],
        commands: [cmd],
      });

      json(res, 201, {
        bidContractId: extractCreatedContractId(result),
        oracleFresh: oracle.isFresh,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const replaceBidId = financingRequestId(url.pathname, "replace-bid");
    if (req.method === "POST" && replaceBidId) {
      const body = (await readBody(req)) as {
        advanceAmount?: string;
        discountRate?: string;
        useStaticReference?: boolean;
        viaAgent?: boolean;
        mandateContractId?: string;
      };

      if (!body.advanceAmount || !body.discountRate) {
        json(res, 400, { error: "advanceAmount and discountRate required" });
        return;
      }

      const oracle = await fetchOracleFeed();
      const mode = body.useStaticReference ? staticReferenceMode() : oracleAnchoredMode();
      const ledgerTime = new Date(oracle.packageTimestampMs).toISOString();
      const viaAgent = body.viaAgent ?? false;

      const cmd = buildReplaceBidCommand({
        requestContractId: replaceBidId,
        financier: parties.financierA.partyId,
        advanceAmount: body.advanceAmount,
        discountRate: body.discountRate,
        redstonePayload: oracle.canton.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode,
        ledgerTime,
        viaAgent,
        mandateContractId: viaAgent ? body.mandateContractId : null,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA.partyId],
        commands: [cmd],
      });

      json(res, 200, {
        bidContractId: extractCreatedContractId(result),
        oracleFresh: oracle.isFresh,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/syndication/open") {
      const body = (await readBody(req)) as {
        receivableCid?: string;
        offeringId?: string;
        participants?: string[];
        deadline?: string;
        pricingBandMin?: string;
        pricingBandMax?: string;
        redstoneFeedId?: number[];
        leadFinancierPartyId?: string;
      };

      if (!body.receivableCid) {
        json(res, 400, { error: "receivableCid required" });
        return;
      }

      const lead = body.leadFinancierPartyId ?? parties.financierA.partyId;
      const factoryId = await findOrCreateSyndicationFactory(client, lead);
      const defaultParticipants = [parties.financierB.partyId];
      const feedId =
        body.redstoneFeedId ?? "SOFR".split("").map((ch) => ch.charCodeAt(0));

      const cmd = buildOpenSyndicationOfferingCommand({
        factoryContractId: factoryId,
        receivableCid: body.receivableCid,
        offeringId: body.offeringId ?? `SYN-${Date.now()}`,
        participants: body.participants ?? defaultParticipants,
        deadline: body.deadline ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        pricingBandMin: body.pricingBandMin ?? "0.01",
        pricingBandMax: body.pricingBandMax ?? "0.15",
        redstoneFeedId: feedId,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [lead],
        commands: [cmd],
      });

      json(res, 201, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const syndicationAwardId = syndicationOfferingId(url.pathname, "award");
    if (req.method === "POST" && syndicationAwardId) {
      const body = (await readBody(req)) as {
        winningBidCid?: string;
        winningParticipant?: string;
        leadFinancierPartyId?: string;
        offeringId?: string;
      };
      if (!body.winningBidCid) {
        json(res, 400, { error: "winningBidCid required" });
        return;
      }

      const lead = body.leadFinancierPartyId ?? parties.financierA.partyId;
      const winningParticipant = body.winningParticipant ?? parties.financierB.partyId;
      const offeringCid = await resolveSyndicationOfferingCid(
        client,
        lead,
        syndicationAwardId,
        body.offeringId
      );

      const result = await client.submitAndWaitForTransaction({
        actAs: [lead, winningParticipant],
        commands: [
          buildAwardSyndicationBidCommand({
            offeringContractId: offeringCid,
            winningBidCid: body.winningBidCid,
            winningParticipant,
          }),
        ],
      });

      json(res, 200, {
        receivableContractId: extractCreatedContractId(result, "Receivable"),
        participationInterestCid: extractCreatedContractId(result, "ParticipationInterest"),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const syndicationPauseId = syndicationOfferingId(url.pathname, "pause");
    if (req.method === "POST" && syndicationPauseId) {
      const lead = parties.financierA.partyId;
      const result = await client.submitAndWaitForTransaction({
        actAs: [lead],
        commands: [buildPauseSyndicationRoundCommand(syndicationPauseId)],
      });
      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const syndicationFallbackId = syndicationOfferingId(url.pathname, "static-fallback");
    if (req.method === "POST" && syndicationFallbackId) {
      const lead = parties.financierA.partyId;
      const result = await client.submitAndWaitForTransaction({
        actAs: [lead],
        commands: [buildSyndicationStaticFallbackCommand(syndicationFallbackId)],
      });
      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const syndicationExpireId = syndicationOfferingId(url.pathname, "expire");
    if (req.method === "POST" && syndicationExpireId) {
      const lead = parties.financierA.partyId;
      const result = await client.submitAndWaitForTransaction({
        actAs: [lead],
        commands: [buildExpireSyndicationRoundCommand(syndicationExpireId)],
      });
      json(res, 200, {
        contractId: extractCreatedContractId(result),
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const syndicationBidId = syndicationOfferingId(url.pathname, "bid");
    if (req.method === "POST" && syndicationBidId) {
      const body = (await readBody(req)) as {
        shareBps?: number;
        discountRate?: string;
        useStaticReference?: boolean;
        participantPartyId?: string;
      };

      if (body.shareBps == null || !body.discountRate) {
        json(res, 400, { error: "shareBps and discountRate required" });
        return;
      }

      const participant = body.participantPartyId ?? parties.financierB.partyId;
      const oracle = await fetchOracleFeed();
      const mode = body.useStaticReference ? staticReferenceMode() : oracleAnchoredMode();
      const ledgerTime = new Date(oracle.packageTimestampMs).toISOString();

      const cmd = buildSubmitSyndicationBidCommand({
        offeringContractId: syndicationBidId,
        participant,
        shareBps: body.shareBps,
        discountRate: body.discountRate,
        redstonePayload: oracle.canton.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode,
        ledgerTime,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [participant],
        commands: [cmd],
      });

      const offeringContractId =
        extractCreatedContractId(result, "SyndicationOffering") ??
        (await resolveSyndicationOfferingCid(client, parties.financierA.partyId, syndicationBidId).catch(
          () => syndicationBidId
        ));

      json(res, 201, {
        bidContractId: extractCreatedContractId(result, "SyndicationBid"),
        offeringContractId,
        oracleFresh: oracle.isFresh,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    const syndicationReplaceBidId = syndicationOfferingId(url.pathname, "replace-bid");
    if (req.method === "POST" && syndicationReplaceBidId) {
      const body = (await readBody(req)) as {
        shareBps?: number;
        discountRate?: string;
        useStaticReference?: boolean;
        participantPartyId?: string;
      };

      if (body.shareBps == null || !body.discountRate) {
        json(res, 400, { error: "shareBps and discountRate required" });
        return;
      }

      const participant = body.participantPartyId ?? parties.financierB.partyId;
      const oracle = await fetchOracleFeed();
      const mode = body.useStaticReference ? staticReferenceMode() : oracleAnchoredMode();
      const ledgerTime = new Date(oracle.packageTimestampMs).toISOString();

      const cmd = buildReplaceSyndicationBidCommand({
        offeringContractId: syndicationReplaceBidId,
        participant,
        shareBps: body.shareBps,
        discountRate: body.discountRate,
        redstonePayload: oracle.canton.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode,
        ledgerTime,
      });

      const result = await client.submitAndWaitForTransaction({
        actAs: [participant],
        commands: [cmd],
      });

      const offeringContractId =
        extractCreatedContractId(result, "SyndicationOffering") ??
        (await resolveSyndicationOfferingCid(
          client,
          parties.financierA.partyId,
          syndicationReplaceBidId
        ).catch(() => syndicationReplaceBidId));

      json(res, 200, {
        bidContractId: extractCreatedContractId(result, "SyndicationBid"),
        offeringContractId,
        oracleFresh: oracle.isFresh,
        transaction: result.transaction?.updateId,
      });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
}

async function main(): Promise<void> {
  const manifestPath = process.env.PARTIES_MANIFEST ?? defaultManifestPath(ROOT);
  const parties = loadPortalParties(manifestPath);
  const auth = DevNetAuthClient.fromEnv();

  const server = createServer((req, res) => {
    handleRequest(req, res, auth, parties).catch((err) => json(res, 500, { error: String(err) }));
  });

  server.listen(PORT, () => {
    console.log(`portal-api listening on http://127.0.0.1:${PORT}`);
    console.log(`templates: ${TEMPLATE_IDS.receivableProposal}`);
    console.log(`interfaces: ${INTERFACE_IDS.buyerView}`);
    console.log(`supplier indexer: ${SUPPLIER_INDEXER}`);
    console.log(`financier indexer: ${FINANCIER_INDEXER}`);
    console.log(`oracle relay: ${ORACLE_RELAY}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
