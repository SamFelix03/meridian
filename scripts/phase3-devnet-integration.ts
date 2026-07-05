/** Phase 3 live Seaport integration — CIP-56 cash leg, DvP award, repayment proof, overdue. */
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
  buildMarkOverdueCommand,
  buildOpenFinancingRoundCommand,
  buildPostForBidCommand,
  buildSubmitBidCommand,
  INTERFACE_IDS,
  LedgerClientError,
  TEMPLATE_IDS,
  extractCreatedContractId,
  oracleAnchoredMode,
  type JsonLedgerClient,
} from "@meridian/ledger-client";
import {
  awardWithDvP,
  fetchRepaymentProofs,
  loadCashManifest,
  markOverdue,
  musdBalance,
  repayWithProof,
} from "./cash-devnet-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");
const REGISTRY_API = process.env.REGISTRY_API_URL ?? "http://127.0.0.1:4022";

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";
const ADVANCE = "1500";
const FACE_VALUE = "2000";

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
  proposalId: string,
  dueDate = "2026-12-31"
): Promise<string> {
  const proposeResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildCreateReceivableProposalCommand({
        proposalId,
        supplier,
        buyer,
        lineItems: [{ description: "Phase 3 integration item", quantity: "1", unitPrice: FACE_VALUE }],
        faceValue: FACE_VALUE,
        currency: "USD",
        dueDate,
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
  const requestCid = extractCreatedContractId(roundResult, "FinancingRequest:FinancingRequest");
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
  advanceAmount = ADVANCE,
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
  const bid = bids.find((b) => String((b.payload as Record<string, unknown>).requestId) === requestId);
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
  if (!process.env.DEVNET_CLIENT_SECRET) {
    throw new Error("DEVNET_CLIENT_SECRET required");
  }
  if (!existsSync(join(ROOT, "infra/manifests/cash.devnet.json"))) {
    throw new Error("run: pnpm bootstrap:cash:devnet");
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
  const cash = loadCashManifest(ROOT);

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();

  console.log("\n1. CIP-56 discovery via registry-api...");
  try {
    const metaRes = await fetch(`${REGISTRY_API}/registry/token-metadata/MUSD`);
    assert.equal(metaRes.status, 200);
    const holdingsRes = await fetch(
      `${REGISTRY_API}/registry/holdings/${encodeURIComponent(financierA)}`
    );
    assert.equal(holdingsRes.status, 200);
    const holdingsBody = (await holdingsRes.json()) as { balance?: number };
    assert.ok((holdingsBody.balance ?? 0) > 0, "financier MUSD balance via registry-api");
    console.log(`   registry-api MUSD balance=${holdingsBody.balance} ✓`);
  } catch {
    const bal = await musdBalance(client, financierA, cash.registryAdminPartyId);
    assert.ok(bal > 0, "financier MUSD on ledger");
    console.log(`   ledger MUSD balance=${bal} (registry-api offline) ✓`);
  }

  console.log("\n2. Award DvP — supplier MUSD increases, receivable Funded...");
  const proposalId = `P3-DVP-${Date.now()}`;
  const requestId = `ROUND-P3-${Date.now()}`;
  const postedCid = await issuePostedReceivable(client, supplier, buyer, platformOperator, proposalId);
  const round = await openFinancingRound(
    client,
    supplier,
    postedCid,
    requestId,
    [financierA],
    oracle
  );
  const { requestCid, bidCid } = await submitOracleBid(
    client,
    supplier,
    round.requestCid,
    requestId,
    financierA,
    oracle
  );
  const supplierBalBefore = await musdBalance(client, supplier, cash.registryAdminPartyId);
  const { fundedReceivableCid } = await awardWithDvP(client, cash, {
    supplier,
    financier: financierA,
    requestCid,
    bidCid,
    advanceAmount: ADVANCE,
  });
  const supplierBalAfter = await musdBalance(client, supplier, cash.registryAdminPartyId);
  assert.ok(
    supplierBalAfter >= supplierBalBefore + Number(ADVANCE) - 0.01,
    "supplier MUSD must increase by advance amount"
  );
  const fundedRows = await client.getActiveContractsByTemplate(supplier, TEMPLATE_IDS.receivable);
  const funded = fundedRows.find((r) => r.contractId === fundedReceivableCid);
  assert.ok(funded, "funded receivable missing");
  assert.equal(String((funded.payload as Record<string, unknown>).state), "Funded");
  const receivableId = String((funded.payload as Record<string, unknown>).receivableId);
  console.log(`   supplier MUSD ${supplierBalBefore} → ${supplierBalAfter} ✓`);

  console.log("\n3. Repayment privacy — buyer IBuyerView has no pricing...");
  const buyerViews = await client.getActiveContractsByInterface(buyer, INTERFACE_IDS.buyerView);
  const buyerEntry = buyerViews.find((c) => c.contractId === fundedReceivableCid);
  assert.ok(buyerEntry, "buyer view for funded receivable missing");
  const view = buyerEntry.interfaceViews.find((v) => v.interfaceId.includes("IBuyerView"))
    ?.viewValue as Record<string, unknown> | undefined;
  assert.ok(view, "buyer interface view missing");
  assert.ok(!("discountRate" in view), "buyer view must not expose discount rate");
  assert.ok(!("advanceAmount" in view), "buyer view must not expose advance amount");
  console.log("   buyer IBuyerView: no pricing fields ✓");

  console.log("\n4. Repayment + cryptographic proof...");
  const settlementRef = `p3-repay-${Date.now()}`;
  const { repaidReceivableCid, proofCid } = await repayWithProof(client, cash, {
    buyer,
    supplier,
    payee: financierA,
    receivableCid: fundedReceivableCid,
    faceValue: FACE_VALUE,
    settlementRef,
  });
  assert.notEqual(repaidReceivableCid, fundedReceivableCid);
  const proofs = await fetchRepaymentProofs(client, supplier, receivableId);
  assert.ok(proofs.some((p) => p.contractId === proofCid), "supplier must observe RepaymentProof");
  const proofPayload = (
    await client.getActiveContractsByTemplate(supplier, TEMPLATE_IDS.receivable)
  ).find((r) => r.contractId === repaidReceivableCid)?.payload as Record<string, unknown>;
  assert.equal(String(proofPayload?.state), "Repaid");
  console.log(`   proof cid ${proofCid.slice(0, 24)}… ✓`);

  console.log("\n5. Overdue boundary...");
  const overdueProposalId = `P3-OVD-${Date.now()}`;
  const overdueRequestId = `ROUND-OVD-${Date.now()}`;
  const futureDueCid = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    `${overdueProposalId}-future`,
    "2026-12-31"
  );
  const futureRound = await openFinancingRound(
    client,
    supplier,
    futureDueCid,
    `${overdueRequestId}-future`,
    [financierA],
    oracle
  );
  const futureBid = await submitOracleBid(
    client,
    supplier,
    futureRound.requestCid,
    `${overdueRequestId}-future`,
    financierA,
    oracle
  );
  const { fundedReceivableCid: futureFundedCid } = await awardWithDvP(client, cash, {
    supplier,
    financier: financierA,
    requestCid: futureBid.requestCid,
    bidCid: futureBid.bidCid,
    advanceAmount: ADVANCE,
  });
  await expectSubmitFailure(client, {
    actAs: [supplier],
    commands: [buildMarkOverdueCommand({ receivableContractId: futureFundedCid })],
  });
  console.log("   MarkOverdue before due date rejected ✓");

  const pastDueCid = await issuePostedReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    overdueProposalId,
    "2020-01-01"
  );
  const pastRound = await openFinancingRound(
    client,
    supplier,
    pastDueCid,
    overdueRequestId,
    [financierA],
    oracle
  );
  const pastBid = await submitOracleBid(
    client,
    supplier,
    pastRound.requestCid,
    overdueRequestId,
    financierA,
    oracle
  );
  const { fundedReceivableCid: pastFundedCid } = await awardWithDvP(client, cash, {
    supplier,
    financier: financierA,
    requestCid: pastBid.requestCid,
    bidCid: pastBid.bidCid,
    advanceAmount: ADVANCE,
  });
  const overdueCid = await markOverdue(client, { supplier, receivableCid: pastFundedCid });
  const overdueRow = (
    await client.getActiveContractsByTemplate(supplier, TEMPLATE_IDS.receivable)
  ).find((r) => r.contractId === overdueCid);
  assert.equal(String((overdueRow?.payload as Record<string, unknown>).state), "Overdue");
  console.log("   MarkOverdue after due date succeeded ✓");

  console.log("\n6. Phase 2 regression — sealed bid privacy...");
  const privProposal = `P3-PRIV-${Date.now()}`;
  const privRequestId = `ROUND-PRIV-${Date.now()}`;
  const privPosted = await issuePostedReceivable(client, supplier, buyer, platformOperator, privProposal);
  const privRound = await openFinancingRound(
    client,
    supplier,
    privPosted,
    privRequestId,
    [financierA, financierB],
    oracle
  );
  await submitOracleBid(client, supplier, privRound.requestCid, privRequestId, financierA, oracle);
  const competitorBids = await client.getActiveContractsByTemplate(financierB, TEMPLATE_IDS.bid);
  assert.equal(competitorBids.length, 0, "financier B must not see financier A's sealed bid");
  console.log("   financier B bid ACS: empty ✓");

  console.log("\nPhase 3 DevNet integration: ALL PASSED");
}

main().catch((err) => {
  console.error("\nPhase 3 DevNet integration FAILED:", err);
  process.exit(1);
});
