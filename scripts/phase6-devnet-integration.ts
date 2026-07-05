/** Phase 6 live Seaport integration — mandate-constrained agentic bidding on-ledger. */
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
  TEMPLATE_IDS,
  type JsonLedgerClient,
} from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";

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

async function issuePostedReceivable(
  client: JsonLedgerClient,
  supplier: string,
  buyer: string,
  platformOperator: string,
  proposalId: string
): Promise<string> {
  const proposeResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildCreateReceivableProposalCommand({
        proposalId,
        supplier,
        buyer,
        lineItems: [{ description: "Phase 6 mandate item", quantity: "1", unitPrice: "2000" }],
        faceValue: "2000",
        currency: "USD",
        dueDate: "2026-12-31",
        consentSource: { tag: "InlineConsent", value: true },
      }),
    ],
  });
  const proposalCid = extractCreatedContractId(proposeResult);
  assert.ok(proposalCid, "proposal contract id missing");

  const issueResult = await client.submitAndWaitForTransaction({
    actAs: [buyer],
    commands: [
      buildCoSignAndIssueCommand({
        proposalContractId: proposalCid,
        jurisdiction: "US",
        platformOperator,
      }),
    ],
  });
  const receivableCid = extractCreatedContractId(issueResult);
  assert.ok(receivableCid, "receivable contract id missing");

  const postResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildPostForBidCommand(receivableCid)],
  });
  const postedCid = extractCreatedContractId(postResult);
  assert.ok(postedCid, "posted receivable contract id missing");
  return postedCid;
}

async function openFinancingRound(
  client: JsonLedgerClient,
  supplier: string,
  receivableCid: string,
  requestId: string,
  financiers: string[],
  oracle: OracleSnapshot
): Promise<string> {
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);
  const factoryResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildCreateFinancingFactoryCommand({ supplier })],
  });
  const factoryCid = extractCreatedContractId(factoryResult);
  assert.ok(factoryCid, "financing factory contract id missing");

  const roundResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildOpenFinancingRoundCommand({
        factoryContractId: factoryCid,
        receivableCid,
        requestId,
        financiers,
        deadline: addDaysLedgerTime(ledgerTime, 7),
        pricingBandMin: PRICING_BAND_MIN,
        pricingBandMax: PRICING_BAND_MAX,
        redstoneFeedId: SOFR_FEED_ID_ASCII,
      }),
    ],
  });
  const requestCid = extractCreatedContractId(
    roundResult,
    "FinancingRequest:FinancingRequest"
  );
  assert.ok(requestCid, "financing request contract id missing");
  return requestCid;
}

async function createMandate(
  client: JsonLedgerClient,
  financier: string,
  supplier: string,
  mandateId: string,
  maxExposure: string,
  minSpread: string
): Promise<string> {
  const result = await client.submitAndWaitForTransaction({
    actAs: [financier],
    commands: [
      buildCreateBiddingMandateCommand({
        mandateId,
        financier,
        maxExposure,
        minSpread,
        eligibleSuppliers: [supplier],
        agentEnabled: true,
      }),
    ],
  });
  const mandateCid = extractCreatedContractId(result, "BiddingMandate");
  assert.ok(mandateCid, "mandate contract id missing");
  return mandateCid;
}

async function main(): Promise<void> {
  if (!existsSync(MANIFEST)) {
    console.error("manifest missing");
    process.exit(1);
  }
  if (!process.env.DEVNET_CLIENT_SECRET) {
    console.error("DEVNET_CLIENT_SECRET required for live integration test");
    process.exit(1);
  }

  console.log("0. Oracle preflight...");
  const oracle = loadOracleSnapshot();
  assert.ok(oracle.isFresh, "oracle snapshot must be fresh — run: pnpm redstone:fetch");
  console.log(`   payload ${oracle.payloadHex.length} hex chars, ts=${oracle.packageTimestampMs} ✓`);

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const supplier = party(manifest, "meridian-supplier");
  const buyer = party(manifest, "meridian-buyer");
  const financierA = party(manifest, "meridian-financier-a");
  const platformOperator = party(manifest, "meridian-platform");

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);
  const ts = Date.now();

  console.log("\n1. Agent bid within mandate succeeds...");
  const receivable1 = await issuePostedReceivable(client, supplier, buyer, platformOperator, `P6-OK-${ts}`);
  const requestId1 = `ROUND-P6-OK-${ts}`;
  const requestCid1 = await openFinancingRound(
    client,
    supplier,
    receivable1,
    requestId1,
    [financierA],
    oracle
  );
  const mandateCid1 = await createMandate(
    client,
    financierA,
    supplier,
    `MANDATE-OK-${ts}`,
    "2000",
    "0.03"
  );
  await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid1,
        financier: financierA,
        advanceAmount: "1500",
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
        viaAgent: true,
        mandateContractId: mandateCid1,
      }),
    ],
  });
  const agentBids = await client.getActiveContractsByTemplate(financierA, TEMPLATE_IDS.bid);
  const agentBid = agentBids.find(
    (b) => String((b.payload as Record<string, unknown>).requestId) === requestId1
  );
  assert.ok(agentBid, "agent bid contract missing");
  assert.equal(Boolean((agentBid.payload as Record<string, unknown>).viaAgent), true);
  console.log("   in-mandate agent bid created ✓");

  console.log("\n2. Adversarial out-of-mandate advance rejected...");
  const receivable2 = await issuePostedReceivable(client, supplier, buyer, platformOperator, `P6-BAD-${ts}`);
  const requestId2 = `ROUND-P6-BAD-${ts}`;
  const requestCid2 = await openFinancingRound(
    client,
    supplier,
    receivable2,
    requestId2,
    [financierA],
    oracle
  );
  const mandateCid2 = await createMandate(
    client,
    financierA,
    supplier,
    `MANDATE-BAD-${ts}`,
    "1000",
    "0.03"
  );
  await expectSubmitFailure(client, {
    actAs: [financierA],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid2,
        financier: financierA,
        advanceAmount: "2500",
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
        viaAgent: true,
        mandateContractId: mandateCid2,
      }),
    ],
  });
  const badBids = await client.getActiveContractsByTemplate(financierA, TEMPLATE_IDS.bid);
  assert.ok(
    !badBids.some((b) => String((b.payload as Record<string, unknown>).requestId) === requestId2),
    "out-of-mandate bid must not exist"
  );
  console.log("   ledger rejected excessive advance ✓");

  console.log("\n3. Manual bid without mandate still works (regression)...");
  const receivable3 = await issuePostedReceivable(client, supplier, buyer, platformOperator, `P6-MAN-${ts}`);
  const requestId3 = `ROUND-P6-MAN-${ts}`;
  const requestCid3 = await openFinancingRound(
    client,
    supplier,
    receivable3,
    requestId3,
    [financierA],
    oracle
  );
  await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid3,
        financier: financierA,
        advanceAmount: "1500",
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
        viaAgent: false,
      }),
    ],
  });
  const manualBids = await client.getActiveContractsByTemplate(financierA, TEMPLATE_IDS.bid);
  const manualBid = manualBids.find(
    (b) => String((b.payload as Record<string, unknown>).requestId) === requestId3
  );
  assert.ok(manualBid, "manual bid contract missing");
  assert.equal(Boolean((manualBid.payload as Record<string, unknown>).viaAgent), false);
  console.log("   manual bid without mandate ✓");

  console.log("\nPhase 6 DevNet integration: all checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
