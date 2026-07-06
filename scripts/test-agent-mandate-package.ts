/**
 * Isolated test: BiddingMandate package must match FinancingRequest package for viaAgent bids.
 *
 * Reproduces INTERPRETATION_UPGRADE_ERROR when a v5 mandate is referenced from a v6 SubmitBid,
 * then verifies a fresh v6 mandate + v6 round agent bid succeeds.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildCoSignAndIssueCommand,
  buildCreateBiddingMandateCommand,
  buildCreateFinancingFactoryCommand,
  buildCreateReceivableProposalCommand,
  buildOpenFinancingRoundCommand,
  buildPostForBidCommand,
  buildSubmitBidCommand,
  extractCreatedContractId,
  LedgerClientError,
  oracleAnchoredMode,
  packageIdFromTemplateId,
  pickMandateForRequestPackage,
  resolveBiddingMandateTemplateId,
  resolveFinancingRequestTemplateId,
  resolveMandateTemplateMap,
  templateIdsSamePackage,
  type JsonLedgerClient,
} from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");
const FINANCIER_INDEXER = process.env.FINANCIER_INDEXER_URL ?? "http://127.0.0.1:4013";

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";
const V6_PACKAGE_HASH = "79a2de17b44239341291fc39217981fc47065fe42894118ad84f9cc829809f66";
const V5_PACKAGE_HASH = "bdafdb3a3f6d73b85040b46de818b55a05ca49c1bbe469b3a1f2a277b41c05de";

loadDotenv({ path: join(ROOT, ".env") });

function party(manifest: DevNetPartiesManifest, orgId: string): string {
  const p = manifest.personas.find((x) => x.orgId === orgId);
  if (!p?.partyId) throw new Error(`party missing: ${orgId}`);
  return p.partyId;
}

function loadOracle() {
  if (!existsSync(ORACLE_SNAPSHOT)) throw new Error("run: pnpm redstone:fetch");
  const raw = JSON.parse(readFileSync(ORACLE_SNAPSHOT, "utf-8")) as {
    canton?: { payloadHex?: string };
    packageTimestampMs?: number;
  };
  const payloadHex = raw.canton?.payloadHex;
  const packageTimestampMs = raw.packageTimestampMs;
  if (!payloadHex || packageTimestampMs == null) throw new Error("invalid oracle snapshot");
  return { payloadHex, packageTimestampMs };
}

async function expectSubmitFailure(
  client: JsonLedgerClient,
  params: Parameters<JsonLedgerClient["submitAndWaitForTransaction"]>[0]
): Promise<string> {
  try {
    await client.submitAndWaitForTransaction(params);
    assert.fail("expected ledger submit to fail");
  } catch (err) {
    assert.ok(err instanceof LedgerClientError, String(err));
    return err.message;
  }
}

async function issueAndOpenRound(
  client: JsonLedgerClient,
  supplier: string,
  buyer: string,
  platformOperator: string,
  financierA: string,
  financierB: string,
  tag: string
): Promise<{ receivableCid: string; requestCid: string }> {
  const ts = Date.now();
  const proposalId = `MANDATE-TEST-${tag}-${ts}`;

  const proposeResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildCreateReceivableProposalCommand({
        proposalId,
        supplier,
        buyer,
        lineItems: [{ description: "mandate package test", quantity: "1", unitPrice: "2500" }],
        faceValue: "2500",
        currency: "USD",
        dueDate: "2026-12-31",
        consentSource: { tag: "InlineConsent", value: true },
      }),
    ],
  });
  const proposalCid = extractCreatedContractId(proposeResult)!;

  const issueResult = await client.submitAndWaitForTransaction({
    actAs: [buyer],
    commands: [
      buildCoSignAndIssueCommand({
        proposalContractId: proposalCid,
        platformOperator,
      }),
    ],
  });
  const receivableCid = extractCreatedContractId(issueResult, "Receivable:Receivable")!;

  const postResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildPostForBidCommand(receivableCid)],
  });
  const postedCid = extractCreatedContractId(postResult, "Receivable") ?? receivableCid;

  const factoryResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildCreateFinancingFactoryCommand({ supplier })],
  });
  const factoryCid =
    extractCreatedContractId(factoryResult, "FinancingRoundFactory") ??
    extractCreatedContractId(factoryResult)!;

  const deadline = new Date(Date.now() + 7 * 86400000).toISOString();
  const openResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildOpenFinancingRoundCommand({
        factoryContractId: factoryCid,
        receivableCid: postedCid,
        requestId: `ROUND-MANDATE-${tag}-${ts}`,
        financiers: [financierA, financierB],
        deadline,
        pricingBandMin: PRICING_BAND_MIN,
        pricingBandMax: PRICING_BAND_MAX,
        redstoneFeedId: SOFR_FEED_ID_ASCII,
      }),
    ],
  });
  const requestCid = extractCreatedContractId(openResult, "FinancingRequest")!;
  return { receivableCid: postedCid, requestCid };
}

async function main(): Promise<void> {
  console.log("=== test-agent-mandate-package ===\n");

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const supplier = party(manifest, "meridian-supplier");
  const buyer = party(manifest, "meridian-buyer");
  const financierA = party(manifest, "meridian-financier-a");
  const financierB = party(manifest, "meridian-financier-b");
  const platformOperator = party(manifest, "meridian-platform");

  if (!process.env.DEVNET_CLIENT_SECRET) {
    console.error("DEVNET_CLIENT_SECRET required");
    process.exit(1);
  }

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();
  const oracle = loadOracle();
  const mode = oracleAnchoredMode();
  const ledgerTime = new Date(oracle.packageTimestampMs).toISOString();

  const { mandates } = (await fetch(`${FINANCIER_INDEXER}/financier/mandates`).then((r) =>
    r.json()
  )) as {
    mandates: Array<{
      contractId: string;
      mandateId: string;
      agentEnabled: boolean;
      revoked: boolean;
    }>;
  };

  const active = mandates.filter((m) => !m.revoked);
  const templateMap = await resolveMandateTemplateMap(client, financierA, active.map((m) => m.contractId));

  console.log("1. Mandate package inventory:");
  for (const m of active.slice(0, 8)) {
    const tid = templateMap.get(m.contractId);
    const pkg = tid ? packageIdFromTemplateId(tid).slice(0, 16) : "?";
    console.log(`   ${m.mandateId} agent=${m.agentEnabled} pkg=${pkg}…`);
  }

  const v5Mandate = active.find((m) => {
    const tid = templateMap.get(m.contractId);
    return tid != null && packageIdFromTemplateId(tid).startsWith(V5_PACKAGE_HASH.slice(0, 8));
  });
  const v6MandateExisting = active.find((m) => {
    const tid = templateMap.get(m.contractId);
    return (
      m.agentEnabled &&
      tid != null &&
      packageIdFromTemplateId(tid).startsWith(V6_PACKAGE_HASH.slice(0, 8))
    );
  });

  console.log("\n2. Open fresh v6 financing round…");
  const { requestCid } = await issueAndOpenRound(
    client,
    supplier,
    buyer,
    platformOperator,
    financierA,
    financierB,
    "PKG"
  );
  const requestTemplateId = await resolveFinancingRequestTemplateId(
    client,
    [financierA, supplier],
    requestCid
  );
  const requestPkg = packageIdFromTemplateId(requestTemplateId);
  console.log(`   requestCid=${requestCid.slice(0, 24)}… package=${requestPkg.slice(0, 16)}…`);
  assert.ok(
    requestPkg.startsWith(V6_PACKAGE_HASH.slice(0, 8)),
    "expected new round on v6 package"
  );

  if (v5Mandate) {
    console.log("\n3. Reproduce mismatch: v6 round + v5 mandate (expect upgrade error)…");
    const v5TemplateId = templateMap.get(v5Mandate.contractId)!;
    assert.ok(!templateIdsSamePackage(requestTemplateId, v5TemplateId));
    const errMsg = await expectSubmitFailure(client, {
      actAs: [financierA],
      commands: [
        buildSubmitBidCommand({
          requestContractId: requestCid,
          requestTemplateId,
          financier: financierA,
          advanceAmount: "1500",
          discountRate: "0.05",
          redstonePayload: oracle.payloadHex,
          redstoneTimestampMs: oracle.packageTimestampMs,
          mode,
          ledgerTime,
          viaAgent: true,
          mandateContractId: v5Mandate.contractId,
        }),
      ],
    });
    assert.match(
      errMsg,
      /UPGRADE|upgrade|Validation fails/i,
      `expected upgrade validation error, got: ${errMsg.slice(0, 200)}`
    );
    console.log("   ✓ mismatch rejected as expected");
  } else {
    console.log("\n3. Skip mismatch repro (no v5 mandate on DevNet)");
  }

  let v6MandateCid: string;
  if (v6MandateExisting) {
    v6MandateCid = v6MandateExisting.contractId;
    console.log(`\n4. Using existing v6 mandate ${v6MandateExisting.mandateId}`);
  } else {
    console.log("\n4. Create fresh v6 mandate…");
    const mandateId = `MANDATE-V6-PKG-${Date.now()}`;
    const createResult = await client.submitAndWaitForTransaction({
      actAs: [financierA],
      commands: [
        buildCreateBiddingMandateCommand({
          mandateId,
          financier: financierA,
          maxExposure: "2000",
          minSpread: "0.03",
          eligibleSuppliers: [],
          agentEnabled: true,
        }),
      ],
    });
    v6MandateCid = extractCreatedContractId(createResult, "BiddingMandate")!;
    console.log(`   created ${mandateId} cid=${v6MandateCid.slice(0, 24)}…`);
  }

  const mandateTemplateId = await resolveBiddingMandateTemplateId(client, [financierA], v6MandateCid);
  assert.ok(templateIdsSamePackage(requestTemplateId, mandateTemplateId), "package match required");

  const matched = pickMandateForRequestPackage(
    [{ mandateId: "test-v6", contractId: v6MandateCid, agentEnabled: true, revoked: false }],
    new Map([[v6MandateCid, mandateTemplateId]]),
    requestTemplateId
  );
  assert.ok(matched, "pickMandateForRequestPackage should find v6 mandate");

  console.log("\n5. Submit viaAgent bid with package-matched v6 mandate…");
  const bidResult = await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid,
        requestTemplateId,
        financier: financierA,
        advanceAmount: "1500",
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode,
        ledgerTime,
        viaAgent: true,
        mandateContractId: v6MandateCid,
      }),
    ],
  });
  const bidCid = extractCreatedContractId(bidResult, "Bid");
  assert.ok(bidCid, "bid contract id missing");
  console.log(`   ✓ bid submitted cid=${bidCid.slice(0, 24)}…`);

  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exit(1);
});
