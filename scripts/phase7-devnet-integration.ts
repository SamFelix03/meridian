/** Phase 7 live Seaport integration — regulator views, settlement audit, KYB gate. */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildCoSignAndIssueCommand,
  buildCreateFinancingFactoryCommand,
  buildCreateReceivableProposalCommand,
  buildCreateRegulatorJurisdictionGrantCommand,
  buildGrantComplianceObserverCommand,
  buildOpenFinancingRoundCommand,
  buildPostForBidCommand,
  buildSubmitBidCommand,
  extractCreatedContractId,
  INTERFACE_IDS,
  LedgerClientError,
  oracleAnchoredMode,
  SETTLEMENT,
  TEMPLATE_IDS,
  type JsonLedgerClient,
} from "@meridian/ledger-client";
import { awardWithDvP, loadCashManifest } from "./cash-devnet-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";
const ADVANCE = "1500.0";

const KYB_PORT = 18090;
const PROV_PORT = 18091;

loadDotenv({ path: join(ROOT, ".env") });

interface OracleSnapshot {
  payloadHex: string;
  packageTimestampMs: number;
  isFresh: boolean;
}

function party(manifest: DevNetPartiesManifest, orgId: string): string {
  const p = manifest.personas.find((x) => x.orgId === orgId);
  if (!p?.partyId) throw new Error(`party missing: ${orgId}`);
  return p.partyId;
}

function millisToLedgerTime(ms: number): string {
  return new Date(ms).toISOString();
}

function addDaysLedgerTime(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function loadOracleSnapshot(): OracleSnapshot {
  if (!existsSync(ORACLE_SNAPSHOT)) {
    throw new Error("oracle snapshot missing — run: pnpm redstone:fetch");
  }
  const raw = JSON.parse(readFileSync(ORACLE_SNAPSHOT, "utf-8")) as {
    canton?: { payloadHex?: string };
    packageTimestampMs?: number;
    isFresh?: boolean;
  };
  const payloadHex = raw.canton?.payloadHex;
  const packageTimestampMs = raw.packageTimestampMs;
  if (!payloadHex || packageTimestampMs == null) {
    throw new Error("invalid oracle snapshot — run: pnpm redstone:fetch");
  }
  return {
    payloadHex,
    packageTimestampMs,
    isFresh: raw.isFresh ?? false,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function spawnService(
  name: string,
  cwd: string,
  args: string[],
  env: Record<string, string> = {}
): ChildProcess {
  const child = spawn("node", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
  return child;
}

async function expectSubmitFailure(
  client: JsonLedgerClient,
  params: Parameters<JsonLedgerClient["submitAndWaitForTransaction"]>[0]
): Promise<void> {
  try {
    await client.submitAndWaitForTransaction(params);
    assert.fail("expected ledger submit to fail");
  } catch (err) {
    assert.ok(err instanceof LedgerClientError, String(err));
    assert.equal(err.code, "SUBMIT_FAILED");
  }
}

function regulatorViewPayload(
  rows: Awaited<ReturnType<JsonLedgerClient["getActiveContractsByInterface"]>>
): Record<string, unknown> | null {
  for (const row of rows) {
    const view = row.interfaceViews?.find((v) =>
      v.interfaceId.includes("IRegulatorView")
    );
    if (view?.viewValue && typeof view.viewValue === "object") {
      return view.viewValue as Record<string, unknown>;
    }
  }
  return null;
}

async function fundReceivable(
  client: JsonLedgerClient,
  params: {
    supplier: string;
    buyer: string;
    platformOperator: string;
    financier: string;
    oracle: OracleSnapshot;
    proposalId: string;
    requestId: string;
  }
): Promise<{ fundedReceivableCid: string; receivableId: string }> {
  const proposeResult = await client.submitAndWaitForTransaction({
    actAs: [params.supplier],
    commands: [
      buildCreateReceivableProposalCommand({
        proposalId: params.proposalId,
        supplier: params.supplier,
        buyer: params.buyer,
        lineItems: [{ description: "Phase 7 compliance item", quantity: "1", unitPrice: "2000" }],
        faceValue: "2000",
        currency: "USD",
        dueDate: "2026-12-31",
        consentSource: { tag: "InlineConsent", value: true },
      }),
    ],
  });
  const proposalCid = extractCreatedContractId(proposeResult);
  assert.ok(proposalCid);

  const issueResult = await client.submitAndWaitForTransaction({
    actAs: [params.buyer],
    commands: [
      buildCoSignAndIssueCommand({
        proposalContractId: proposalCid,
        jurisdiction: "US",
        platformOperator: params.platformOperator,
      }),
    ],
  });
  const receivableCid = extractCreatedContractId(issueResult, "Receivable");
  assert.ok(receivableCid);

  const postResult = await client.submitAndWaitForTransaction({
    actAs: [params.supplier],
    commands: [buildPostForBidCommand(receivableCid)],
  });
  const postedCid = extractCreatedContractId(postResult, "Receivable");
  assert.ok(postedCid);

  const ledgerTime = millisToLedgerTime(params.oracle.packageTimestampMs);
  const factoryResult = await client.submitAndWaitForTransaction({
    actAs: [params.supplier],
    commands: [buildCreateFinancingFactoryCommand({ supplier: params.supplier })],
  });
  const factoryCid = extractCreatedContractId(factoryResult);
  assert.ok(factoryCid);

  const roundResult = await client.submitAndWaitForTransaction({
    actAs: [params.supplier],
    commands: [
      buildOpenFinancingRoundCommand({
        factoryContractId: factoryCid,
        receivableCid: postedCid,
        requestId: params.requestId,
        financiers: [params.financier],
        deadline: addDaysLedgerTime(ledgerTime, 7),
        pricingBandMin: PRICING_BAND_MIN,
        pricingBandMax: PRICING_BAND_MAX,
        redstoneFeedId: SOFR_FEED_ID_ASCII,
      }),
    ],
  });
  const requestCid = extractCreatedContractId(roundResult, "FinancingRequest");
  assert.ok(requestCid);

  await client.submitAndWaitForTransaction({
    actAs: [params.financier],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid,
        financier: params.financier,
        advanceAmount: ADVANCE,
        discountRate: "0.05",
        redstonePayload: params.oracle.payloadHex,
        redstoneTimestampMs: params.oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
      }),
    ],
  });

  const bids = await client.getActiveContractsByTemplate(params.financier, TEMPLATE_IDS.bid);
  const bid = bids.find(
    (b) => String((b.payload as Record<string, unknown>).requestId) === params.requestId
  );
  assert.ok(bid);

  const updatedRequests = await client.getActiveContractsByTemplate(
    params.supplier,
    TEMPLATE_IDS.financingRequest
  );
  const updatedRequest = updatedRequests.find(
    (r) => String((r.payload as Record<string, unknown>).requestId) === params.requestId
  );
  assert.ok(updatedRequest);

  const cash = loadCashManifest(ROOT);
  const { fundedReceivableCid } = await awardWithDvP(client, cash, {
    supplier: params.supplier,
    financier: params.financier,
    requestCid: updatedRequest.contractId,
    bidCid: bid.contractId,
    advanceAmount: ADVANCE,
  });

  const fundedRows = await client.getActiveContractsByTemplate(
    params.supplier,
    TEMPLATE_IDS.receivable
  );
  const funded = fundedRows.find((r) => r.contractId === fundedReceivableCid);
  assert.ok(funded);
  const receivableId = String((funded.payload as Record<string, unknown>).receivableId);
  return { fundedReceivableCid, receivableId };
}

async function testKybGate(): Promise<void> {
  const kybData = join(ROOT, ".data/phase7-kyb");
  const provData = join(ROOT, ".data/phase7-prov");
  mkdirSync(kybData, { recursive: true });
  mkdirSync(provData, { recursive: true });

  const children: ChildProcess[] = [];
  try {
    children.push(
      spawnService("kyb", join(ROOT, "services/kyb-gateway"), ["dist/index.js"], {
        KYB_GATEWAY_PORT: String(KYB_PORT),
        KYB_DATA_DIR: kybData,
      })
    );
    children.push(
      spawnService("provisioner", join(ROOT, "services/party-provisioner"), ["dist/index.js"], {
        PROVISIONER_PORT: String(PROV_PORT),
        PROVISIONER_DATA_DIR: provData,
        KYB_GATEWAY_URL: `http://127.0.0.1:${KYB_PORT}`,
      })
    );
    await waitForHealth(`http://127.0.0.1:${KYB_PORT}/health`);
    await waitForHealth(`http://127.0.0.1:${PROV_PORT}/health`);

    const missingVerify = await fetch(`http://127.0.0.1:${PROV_PORT}/v1/parties/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalEntityId: "LE-P7-MISSING",
        partyHint: `p7-missing-${Date.now()}`,
        role: "Supplier",
        jurisdiction: "US",
        verificationId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    assert.notEqual(missingVerify.status, 200, "missing verification must be rejected");

    const verifyRes = await fetch(`http://127.0.0.1:${KYB_PORT}/v1/kyb/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalEntityId: "LE-P7-OK",
        jurisdiction: "US",
        requestedRoles: ["Supplier"],
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = (await verifyRes.json()) as { verificationId: string; status: string };
    assert.equal(verifyBody.status, "PENDING");

    const pendingAlloc = await fetch(`http://127.0.0.1:${PROV_PORT}/v1/parties/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalEntityId: "LE-P7-OK",
        partyHint: `p7-pending-${Date.now()}`,
        role: "Supplier",
        jurisdiction: "US",
        verificationId: verifyBody.verificationId,
      }),
    });
    assert.notEqual(pendingAlloc.status, 200, "PENDING verification must block allocation");

    const completeRes = await fetch(
      `http://127.0.0.1:${KYB_PORT}/v1/kyb/verify/${verifyBody.verificationId}/complete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.KYB_COMPLETE_SECRET ?? "dev-kyb-secret"}`,
        },
        body: JSON.stringify({ decision: "APPROVED" }),
      }
    );
    assert.equal(completeRes.status, 200);

    const okAlloc = await fetch(`http://127.0.0.1:${PROV_PORT}/v1/parties/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalEntityId: "LE-P7-OK",
        partyHint: `p7-approved-${Date.now()}`,
        role: "Supplier",
        jurisdiction: "US",
        verificationId: verifyBody.verificationId,
      }),
    });
    const okText = await okAlloc.text();
    assert.equal(okAlloc.status, 200, okText);
  } finally {
    for (const child of children) {
      if (!child.killed) child.kill();
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.DEVNET_CLIENT_SECRET) {
    throw new Error("DEVNET_CLIENT_SECRET required");
  }
  if (!existsSync(join(ROOT, "infra/manifests/cash.devnet.json"))) {
    throw new Error("run: pnpm bootstrap:cash:devnet");
  }

  const oracle = loadOracleSnapshot();
  assert.ok(oracle.isFresh, "oracle snapshot must be fresh — run: pnpm redstone:fetch");

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const supplier = party(manifest, "meridian-supplier");
  const buyer = party(manifest, "meridian-buyer");
  const financierA = party(manifest, "meridian-financier-a");
  const platformOperator = party(manifest, "meridian-platform");
  const regulator = party(manifest, "meridian-regulator");

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();
  const ts = Date.now();

  console.log("1. Issue + fund receivable with jurisdiction US...");
  const { fundedReceivableCid, receivableId } = await fundReceivable(client, {
    supplier,
    buyer,
    platformOperator,
    financier: financierA,
    oracle,
    proposalId: `P7-${ts}`,
    requestId: `P7-ROUND-${ts}`,
  });
  console.log(`   funded receivable ${fundedReceivableCid.slice(0, 24)}… ✓`);

  console.log("\n2. Before grant — regulator has no regulator view...");
  const preGrantViews = await client.getActiveContractsByInterface(
    regulator,
    INTERFACE_IDS.regulatorView
  );
  const preView = regulatorViewPayload(preGrantViews);
  assert.equal(preView, null, "regulator must not see exposure before grant");
  console.log("   no regulator view ✓");

  console.log("\n3. Platform operator creates jurisdiction grant + compliance observer...");
  await client.submitAndWaitForTransaction({
    actAs: [platformOperator],
    commands: [
      buildCreateRegulatorJurisdictionGrantCommand({
        grantId: `GRANT-P7-${ts}`,
        platformOperator,
        regulator,
        jurisdiction: "US",
      }),
    ],
  });

  const grantResult = await client.submitAndWaitForTransaction({
    actAs: [platformOperator],
    commands: [
      buildGrantComplianceObserverCommand({
        receivableContractId: fundedReceivableCid,
        observerParty: regulator,
        expectedJurisdiction: "US",
      }),
    ],
  });
  const observedReceivableCid =
    extractCreatedContractId(grantResult, "Receivable") ?? fundedReceivableCid;
  console.log(`   observer granted on ${observedReceivableCid.slice(0, 24)}… ✓`);

  console.log("\n4. Regulator sees jurisdiction + aggregate exposure only...");
  const regulatorViews = await client.getActiveContractsByInterface(
    regulator,
    INTERFACE_IDS.regulatorView
  );
  assert.ok(regulatorViews.length >= 1, "regulator must see IRegulatorView");
  const view = regulatorViewPayload(regulatorViews);
  assert.ok(view);
  assert.equal(view.receivableId, receivableId);
  assert.equal(view.jurisdiction, "US");
  assert.ok(Number(view.aggregateExposure) > 0);
  assert.equal(view.lineItems, undefined);
  assert.equal(view.discountRate, undefined);
  console.log("   regulator view fields OK ✓");

  console.log("\n5. Regulator cannot see bids or financing requests...");
  const regulatorBids = await client.getActiveContractsByTemplate(regulator, TEMPLATE_IDS.bid);
  const regulatorRequests = await client.getActiveContractsByTemplate(
    regulator,
    TEMPLATE_IDS.financingRequest
  );
  assert.equal(regulatorBids.length, 0);
  assert.equal(regulatorRequests.length, 0);
  console.log("   bid/financing ACS empty ✓");

  console.log("\n6. Jurisdiction mismatch grant fails...");
  await expectSubmitFailure(client, {
    actAs: [platformOperator],
    commands: [
      buildGrantComplianceObserverCommand({
        receivableContractId: observedReceivableCid,
        observerParty: regulator,
        expectedJurisdiction: "EU",
      }),
    ],
  });
  console.log("   mismatch rejected ✓");

  console.log("\n7. Regulator cannot exercise operational choices...");
  await expectSubmitFailure(client, {
    actAs: [regulator],
    commands: [buildPostForBidCommand(observedReceivableCid)],
  });
  const activeRequests = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.financingRequest
  );
  const anyRequest = activeRequests[0];
  if (anyRequest) {
    await expectSubmitFailure(client, {
      actAs: [regulator],
      commands: [
        buildSubmitBidCommand({
          requestContractId: anyRequest.contractId,
          financier: regulator,
          advanceAmount: "100",
          discountRate: "0.05",
          redstonePayload: oracle.payloadHex,
          redstoneTimestampMs: oracle.packageTimestampMs,
          mode: oracleAnchoredMode(),
          ledgerTime: millisToLedgerTime(oracle.packageTimestampMs),
        }),
      ],
    });
  }
  await expectSubmitFailure(client, {
    actAs: [regulator],
    commands: [
      buildGrantComplianceObserverCommand({
        receivableContractId: observedReceivableCid,
        observerParty: regulator,
        expectedJurisdiction: "US",
      }),
    ],
  });
  console.log("   adversarial exercises rejected ✓");

  console.log("\n8. Settlement audit record — no commercial pricing fields...");
  const audits = await client.getActiveContractsByTemplate(
    platformOperator,
    SETTLEMENT.settlementAuditRecord
  );
  const audit = audits.find(
    (a) => String((a.payload as Record<string, unknown>).receivableId) === receivableId
  );
  assert.ok(audit, "platform operator must see settlement audit");
  const payload = audit.payload as Record<string, unknown>;
  assert.equal(payload.finality, "Atomic");
  assert.equal(payload.discountRate, undefined);
  assert.equal(payload.advanceAmount, undefined);
  assert.equal(payload.pricingBandMin, undefined);
  console.log("   audit payload OK ✓");

  console.log("\n9. KYB gate — PENDING blocks allocation until APPROVED...");
  await testKybGate();
  console.log("   KYB gate OK ✓");

  console.log("\nPhase 7 DevNet integration passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
