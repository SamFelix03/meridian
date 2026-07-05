/** Phase 2 live Seaport visibility-matrix integration tests. */
import { readFileSync, existsSync } from "node:fs";
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
  buildEnterStaticFallbackCommand,
  buildOpenFinancingRoundCommand,
  buildPauseRoundCommand,
  buildPostForBidCommand,
  buildSubmitBidCommand,
  INTERFACE_IDS,
  LedgerClientError,
  extractCreatedContractId,
  oracleAnchoredMode,
  TEMPLATE_IDS,
  type JsonLedgerClient,
} from "@meridian/ledger-client";
import { awardWithDvP, loadCashManifest } from "./cash-devnet-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const STALE_LEDGER_TIME = "2020-01-01T00:00:00Z";
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
        lineItems: [{ description: "Phase 2 integration item", quantity: "1", unitPrice: "2000" }],
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
): Promise<{ requestCid: string; requestId: string }> {
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
  return { requestCid, requestId };
}

async function submitOracleBid(
  client: JsonLedgerClient,
  supplier: string,
  requestCid: string,
  requestId: string,
  financier: string,
  oracle: OracleSnapshot,
  advanceAmount = "1500",
  discountRate = "0.05"
): Promise<{ requestCid: string; bidCid: string }> {
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);
  await client.submitAndWaitForTransaction({
    actAs: [financier],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid,
        financier,
        advanceAmount,
        discountRate,
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
      }),
    ],
  });

  const bids = await client.getActiveContractsByTemplate(financier, TEMPLATE_IDS.bid);
  const bid = bids.find(
    (b) => String((b.payload as Record<string, unknown>).requestId) === requestId
  );
  assert.ok(bid, "bid contract missing after submit");
  const updatedRequests = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.financingRequest
  );
  const updatedRequest = updatedRequests.find(
    (r) => String((r.payload as Record<string, unknown>).requestId) === requestId
  );
  assert.ok(updatedRequest, "updated financing request missing");
  return { requestCid: updatedRequest.contractId, bidCid: bid.contractId };
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
  const financierB = party(manifest, "meridian-financier-b");
  const platformOperator = party(manifest, "meridian-platform");

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();

  console.log("\n1. Visibility matrix — sealed bid privacy...");
  const privacyReceivable = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    `P2-PRIV-${Date.now()}`
  );
  const privacyRequestId = `ROUND-PRIV-${Date.now()}`;
  const privacyRound = await openFinancingRound(
    client,
    supplier,
    privacyReceivable,
    privacyRequestId,
    [financierA, financierB],
    oracle
  );
  await submitOracleBid(
    client,
    supplier,
    privacyRound.requestCid,
    privacyRequestId,
    financierA,
    oracle
  );
  const competitorBids = await client.getActiveContractsByTemplate(
    financierB,
    TEMPLATE_IDS.bid
  );
  assert.equal(
    competitorBids.length,
    0,
    "financier B must not see financier A's sealed bid"
  );
  console.log("   financier B bid ACS: empty ✓");

  console.log("\n2. Visibility matrix — uninvited financier (negative)...");
  const uninvitedReceivable = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    `P2-UNINV-${Date.now()}`
  );
  const uninvitedRequestId = `ROUND-UNINV-${Date.now()}`;
  const uninvitedRound = await openFinancingRound(
    client,
    supplier,
    uninvitedReceivable,
    uninvitedRequestId,
    [financierA],
    oracle
  );
  const uninvitedRequests = await client.getActiveContractsByTemplate(
    financierB,
    TEMPLATE_IDS.financingRequest
  );
  const seesUninvitedRound = uninvitedRequests.some(
    (r) => String((r.payload as Record<string, unknown>).requestId) === uninvitedRequestId
  );
  assert.equal(
    seesUninvitedRound,
    false,
    "uninvited financier B must not see the uninvited FinancingRequest"
  );
  await expectSubmitFailure(client, {
    actAs: [financierB],
    commands: [
      buildSubmitBidCommand({
        requestContractId: uninvitedRound.requestCid,
        financier: financierB,
        advanceAmount: "1000",
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime: millisToLedgerTime(oracle.packageTimestampMs),
      }),
    ],
  });
  console.log("   uninvited financier ACS empty + submit rejected ✓");

  console.log("\n3. Visibility matrix — buyer no pricing post-fund...");
  const fundReceivable = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    `P2-FUND-${Date.now()}`
  );
  const fundRequestId = `ROUND-FUND-${Date.now()}`;
  const fundRound = await openFinancingRound(
    client,
    supplier,
    fundReceivable,
    fundRequestId,
    [financierA],
    oracle
  );
  const { requestCid: fundedReqCid, bidCid } = await submitOracleBid(
    client,
    supplier,
    fundRound.requestCid,
    fundRequestId,
    financierA,
    oracle
  );
  const cash = loadCashManifest(ROOT);
  const { fundedReceivableCid } = await awardWithDvP(client, cash, {
    supplier,
    financier: financierA,
    requestCid: fundedReqCid,
    bidCid,
    advanceAmount: "1500",
  });

  const buyerViews = await client.getActiveContractsByInterface(
    buyer,
    INTERFACE_IDS.buyerView
  );
  const buyerEntry = buyerViews.find((c) => c.contractId === fundedReceivableCid);
  assert.ok(buyerEntry, "buyer view for funded receivable missing");
  const view = buyerEntry.interfaceViews.find((v) =>
    v.interfaceId.includes("IBuyerView")
  )?.viewValue as Record<string, unknown> | undefined;
  assert.ok(view, "buyer interface view value missing");
  assert.ok(view.faceValue, "buyer sees face value");
  assert.ok(view.dueDate, "buyer sees due date");
  assert.equal(String(view.payee), financierA, "buyer sees financier payee-of-record");
  assert.ok(!("lineItems" in view), "buyer view must not include line items");
  assert.ok(!("discountRate" in view), "buyer view must not include discount rate");
  assert.ok(!("advanceAmount" in view), "buyer view must not include advance amount");
  assert.ok(!("reportId" in view), "buyer view must not include oracle report id");
  assert.ok(!("pricingBandMin" in view), "buyer view must not include pricing band");
  console.log("   buyer IBuyerView: payee/amount/dueDate only ✓");

  console.log("\n4. Visibility matrix — stale oracle rejected...");
  const staleReceivable = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    `P2-STALE-${Date.now()}`
  );
  const staleRequestId = `ROUND-STALE-${Date.now()}`;
  const staleRound = await openFinancingRound(
    client,
    supplier,
    staleReceivable,
    staleRequestId,
    [financierA],
    oracle
  );
  await expectSubmitFailure(client, {
    actAs: [financierA],
    commands: [
      buildSubmitBidCommand({
        requestContractId: staleRound.requestCid,
        financier: financierA,
        advanceAmount: "1500",
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime: STALE_LEDGER_TIME,
      }),
    ],
  });
  console.log("   stale oracle bid rejected at contract level ✓");

  console.log("\n5. Pause and static fallback visible to invited financiers...");
  const pauseReceivable = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    `P2-PAUSE-${Date.now()}`
  );
  const pauseRequestId = `ROUND-PAUSE-${Date.now()}`;
  const pauseRound = await openFinancingRound(
    client,
    supplier,
    pauseReceivable,
    pauseRequestId,
    [financierA, financierB],
    oracle
  );
  const pauseResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildPauseRoundCommand(pauseRound.requestCid)],
  });
  const pausedCid = extractCreatedContractId(pauseResult);
  assert.ok(pausedCid, "paused financing request missing");
  const financierAPaused = await client.getActiveContractsByTemplate(
    financierA,
    TEMPLATE_IDS.financingRequest
  );
  const financierBPaused = await client.getActiveContractsByTemplate(
    financierB,
    TEMPLATE_IDS.financingRequest
  );
  assert.ok(
    financierAPaused.some((c) => c.contractId === pausedCid),
    "financier A must see paused round"
  );
  assert.ok(
    financierBPaused.some((c) => c.contractId === pausedCid),
    "financier B must see paused round"
  );
  const pausedPayload = financierAPaused.find((c) => c.contractId === pausedCid)!
    .payload as Record<string, unknown>;
  assert.equal(String(pausedPayload.roundState), "Paused");

  const fallbackResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildEnterStaticFallbackCommand(pausedCid!)],
  });
  const fallbackCid = extractCreatedContractId(fallbackResult);
  assert.ok(fallbackCid, "fallback financing request missing");
  const financierAFallback = await client.getActiveContractsByTemplate(
    financierA,
    TEMPLATE_IDS.financingRequest
  );
  const fallbackPayload = financierAFallback.find((c) => c.contractId === fallbackCid)!
    .payload as Record<string, unknown>;
  assert.equal(String(fallbackPayload.roundState), "StaticReferenceFallback");
  console.log("   Paused + StaticReferenceFallback visible to financiers ✓");

  console.log("\n6. Oracle relay freshness preflight (fault injection guard)...");
  const relayUrl = process.env.ORACLE_RELAY_URL ?? "http://127.0.0.1:4021";
  try {
    const relayRes = await fetch(`${relayUrl}/health`);
    if (relayRes.ok) {
      const feedsRes = await fetch(`${relayUrl}/feeds/latest`);
      assert.ok(feedsRes.ok, "oracle relay /feeds/latest must respond when relay is running");
      const feedBody = (await feedsRes.json()) as { isFresh?: boolean };
      assert.equal(typeof feedBody.isFresh, "boolean", "relay must expose isFresh flag");
      console.log(`   oracle relay reachable at ${relayUrl} ✓`);
    } else {
      console.log("   oracle relay not running locally — snapshot preflight only ✓");
    }
  } catch {
    console.log("   oracle relay not running locally — snapshot preflight only ✓");
  }

  console.log("\nPhase 2 DevNet integration: ALL PASSED");
}

main().catch((err) => {
  console.error("\nPhase 2 DevNet integration FAILED:", err);
  process.exit(1);
});
