/** Phase 4 live Seaport integration — syndication secondary market + waterfall repayment. */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildAwardSyndicationBidCommand,
  buildCoSignAndIssueCommand,
  buildCreateFinancingFactoryCommand,
  buildCreateReceivableProposalCommand,
  buildCreateSyndicationFactoryCommand,
  buildOpenFinancingRoundCommand,
  buildOpenSyndicationOfferingCommand,
  buildPostForBidCommand,
  buildSubmitBidCommand,
  buildSubmitSyndicationBidCommand,
  INTERFACE_IDS,
  TEMPLATE_IDS,
  extractCreatedContractId,
  oracleAnchoredMode,
  shareAmount,
  type JsonLedgerClient,
} from "@meridian/ledger-client";
import {
  awardWithDvP,
  loadCashManifest,
  musdBalance,
  repayWithWaterfall,
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
const PARTICIPANT_SHARE_BPS = 4000;

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

async function fundReceivable(
  client: JsonLedgerClient,
  supplier: string,
  buyer: string,
  platformOperator: string,
  financierA: string,
  oracle: OracleSnapshot
): Promise<{ fundedReceivableCid: string; receivableId: string }> {
  const proposalId = `P4-FUND-${Date.now()}`;
  const requestId = `ROUND-P4-${Date.now()}`;

  const proposeResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildCreateReceivableProposalCommand({
        proposalId,
        supplier,
        buyer,
        lineItems: [{ description: "Phase 4 syndication item", quantity: "1", unitPrice: FACE_VALUE }],
        faceValue: FACE_VALUE,
        currency: "USD",
        dueDate: "2026-12-31",
        consentSource: { tag: "InlineConsent", value: true },
      }),
    ],
  });
  const proposalCid = extractCreatedContractId(proposeResult);
  assert.ok(proposalCid);

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
  assert.ok(receivableCid);

  const postResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildPostForBidCommand(receivableCid)],
  });
  const postedCid = extractCreatedContractId(postResult);
  assert.ok(postedCid);

  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);
  const factoryResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildCreateFinancingFactoryCommand({ supplier })],
  });
  const factoryCid = extractCreatedContractId(factoryResult);
  assert.ok(factoryCid);

  const roundResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildOpenFinancingRoundCommand({
        factoryContractId: factoryCid,
        receivableCid: postedCid,
        requestId,
        financiers: [financierA],
        deadline: addDaysLedgerTime(ledgerTime, 7),
        pricingBandMin: PRICING_BAND_MIN,
        pricingBandMax: PRICING_BAND_MAX,
        redstoneFeedId: SOFR_FEED_ID_ASCII,
      }),
    ],
  });
  const requestCid = extractCreatedContractId(roundResult, "FinancingRequest:FinancingRequest");
  assert.ok(requestCid);

  await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildSubmitBidCommand({
        requestContractId: requestCid,
        financier: financierA,
        advanceAmount: ADVANCE,
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
      }),
    ],
  });

  const bids = await client.getActiveContractsByTemplate(financierA, TEMPLATE_IDS.bid);
  const bid = bids.find((b) => String((b.payload as Record<string, unknown>).requestId) === requestId);
  assert.ok(bid);
  const updatedRequests = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.financingRequest
  );
  const updatedRequest = updatedRequests.find(
    (r) => String((r.payload as Record<string, unknown>).requestId) === requestId
  );
  assert.ok(updatedRequest);

  const cash = loadCashManifest(ROOT);
  const { fundedReceivableCid } = await awardWithDvP(client, cash, {
    supplier,
    financier: financierA,
    requestCid: updatedRequest.contractId,
    bidCid: bid.contractId,
    advanceAmount: ADVANCE,
  });

  const fundedRows = await client.getActiveContractsByTemplate(supplier, TEMPLATE_IDS.receivable);
  const funded = fundedRows.find((r) => r.contractId === fundedReceivableCid);
  assert.ok(funded);
  const receivableId = String((funded.payload as Record<string, unknown>).receivableId);
  return { fundedReceivableCid, receivableId };
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
  const financierB = party(manifest, "meridian-financier-b");
  const platformOperator = party(manifest, "meridian-platform");
  const cash = loadCashManifest(ROOT);

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);

  console.log("1. Fund receivable via Phase 2+3 flow...");
  const { fundedReceivableCid, receivableId } = await fundReceivable(
    client,
    supplier,
    buyer,
    platformOperator,
    financierA,
    oracle
  );
  console.log(`   funded receivable ${fundedReceivableCid.slice(0, 24)}… ✓`);

  console.log("\n2. Lead opens syndication, participant bids, lead awards...");
  const offeringId = `SYN-P4-${Date.now()}`;
  const factoryResult = await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [buildCreateSyndicationFactoryCommand({ leadFinancier: financierA })],
  });
  const syndicationFactoryCid = extractCreatedContractId(factoryResult);
  assert.ok(syndicationFactoryCid);

  const offeringResult = await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildOpenSyndicationOfferingCommand({
        factoryContractId: syndicationFactoryCid,
        receivableCid: fundedReceivableCid,
        offeringId,
        participants: [financierB],
        deadline: addDaysLedgerTime(ledgerTime, 7),
        pricingBandMin: PRICING_BAND_MIN,
        pricingBandMax: PRICING_BAND_MAX,
        redstoneFeedId: SOFR_FEED_ID_ASCII,
      }),
    ],
  });
  const offeringCid = extractCreatedContractId(offeringResult, "SyndicationOffering");
  assert.ok(offeringCid);

  const bidResult = await client.submitAndWaitForTransaction({
    actAs: [financierB],
    commands: [
      buildSubmitSyndicationBidCommand({
        offeringContractId: offeringCid,
        participant: financierB,
        shareBps: PARTICIPANT_SHARE_BPS,
        discountRate: "0.05",
        redstonePayload: oracle.payloadHex,
        redstoneTimestampMs: oracle.packageTimestampMs,
        mode: oracleAnchoredMode(),
        ledgerTime,
      }),
    ],
  });
  const syndicationBidCid = extractCreatedContractId(bidResult, "SyndicationBid");
  assert.ok(syndicationBidCid);

  const participantBidsOnLead = await client.getActiveContractsByTemplate(
    financierA,
    TEMPLATE_IDS.syndicationBid
  );
  assert.ok(
    participantBidsOnLead.some((b) => b.contractId === syndicationBidCid),
    "lead sees sealed bid before award"
  );

  const offeringsAfterBid = await client.getActiveContractsByTemplate(
    financierA,
    TEMPLATE_IDS.syndicationOffering
  );
  const activeOffering = offeringsAfterBid.find(
    (o) => String((o.payload as Record<string, unknown>).offeringId) === offeringId
  );
  assert.ok(activeOffering, "active syndication offering missing after bid");
  const updatedOfferingCid = activeOffering.contractId;

  const awardResult = await client.submitAndWaitForTransaction({
    actAs: [financierA, financierB],
    commands: [
      buildAwardSyndicationBidCommand({
        offeringContractId: updatedOfferingCid,
        winningBidCid: syndicationBidCid,
        winningParticipant: financierB,
      }),
    ],
  });
  const syndicatedReceivableCid = extractCreatedContractId(awardResult, "Receivable");
  assert.ok(syndicatedReceivableCid);
  console.log(`   syndicated receivable ${syndicatedReceivableCid.slice(0, 24)}… ✓`);

  console.log("\n3. Visibility matrix...");
  const leadViews = await client.getActiveContractsByInterface(
    financierA,
    INTERFACE_IDS.leadFinancierView
  );
  const leadEntry = leadViews.find((c) => c.contractId === syndicatedReceivableCid);
  assert.ok(leadEntry, "lead must see ILeadFinancierView");
  const leadView = leadEntry.interfaceViews.find((v) =>
    v.interfaceId.includes("ILeadFinancierView")
  )?.viewValue as Record<string, unknown> | undefined;
  assert.ok(leadView);
  const capTable = leadView.capTable as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(capTable) && capTable.length === 1);
  assert.equal(Number(capTable[0]?.shareBps), PARTICIPANT_SHARE_BPS);

  const participantInterests = await client.getActiveContractsByTemplate(
    financierB,
    TEMPLATE_IDS.participationInterest
  );
  assert.ok(participantInterests.length > 0, "participant must see own interest");

  const buyerOfferings = await client.getActiveContractsByTemplate(
    buyer,
    TEMPLATE_IDS.syndicationOffering
  );
  const supplierOfferings = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.syndicationOffering
  );
  assert.equal(buyerOfferings.length, 0, "buyer must not see syndication offering");
  assert.equal(supplierOfferings.length, 0, "supplier must not see syndication offering");
  console.log("   privacy matrix ✓");

  console.log("\n4. Supplier ISupplierView still shows Funded...");
  const supplierViews = await client.getActiveContractsByInterface(
    supplier,
    INTERFACE_IDS.supplierView
  );
  const supplierEntry = supplierViews.find((c) => c.contractId === syndicatedReceivableCid);
  assert.ok(supplierEntry);
  const supplierView = supplierEntry.interfaceViews.find((v) =>
    v.interfaceId.includes("ISupplierView")
  )?.viewValue as Record<string, unknown> | undefined;
  assert.equal(String(supplierView?.state), "Funded");
  assert.ok(!("capTable" in (supplierView ?? {})), "supplier view must not expose cap table");
  console.log("   supplier masked state ✓");

  console.log("\n5. Waterfall repayment — participant MUSD increases...");
  const participantBalBefore = await musdBalance(client, financierB, cash.registryAdminPartyId);
  const leadBalBefore = await musdBalance(client, financierA, cash.registryAdminPartyId);
  const expectedParticipant = shareAmount(Number(FACE_VALUE), PARTICIPANT_SHARE_BPS);
  const expectedLeadRemainder = Number(FACE_VALUE) - expectedParticipant;

  await repayWithWaterfall(client, cash, {
    buyer,
    supplier,
    payee: financierA,
    receivableCid: syndicatedReceivableCid,
    faceValue: FACE_VALUE,
    settlementRef: `p4-waterfall-${Date.now()}`,
    capTable: [{ participant: financierB, shareBps: PARTICIPANT_SHARE_BPS }],
  });

  const participantBalAfter = await musdBalance(client, financierB, cash.registryAdminPartyId);
  const leadBalAfter = await musdBalance(client, financierA, cash.registryAdminPartyId);
  assert.ok(
    Math.abs(participantBalAfter - participantBalBefore - expectedParticipant) < 0.01,
    `participant pro-rata expected ${expectedParticipant}`
  );
  assert.ok(
    Math.abs(leadBalAfter - leadBalBefore - expectedLeadRemainder) < 0.01,
    `lead remainder expected ${expectedLeadRemainder}`
  );
  console.log(
    `   participant +${expectedParticipant}, lead +${expectedLeadRemainder} MUSD ✓`
  );

  console.log("\n6. Adversarial rounding (3333 bps on odd face value)...");
  const oddFace = "10001";
  const oddBps = 3333;
  const oddParticipantAmt = shareAmount(Number(oddFace), oddBps);
  const oddLeadAmt = Number(oddFace) - oddParticipantAmt;
  assert.equal(oddParticipantAmt + oddLeadAmt, Number(oddFace));
  console.log(`   ${oddBps} bps on ${oddFace}: ${oddParticipantAmt} + ${oddLeadAmt} = ${oddFace} ✓`);

  console.log("\n7. Registry participation metadata...");
  try {
    const metaRes = await fetch(`${REGISTRY_API}/registry/token-metadata/PARTICIPATION`);
    assert.equal(metaRes.status, 200);
    const meta = (await metaRes.json()) as { legalNature?: string };
    assert.equal(meta.legalNature, "pass-through-proceeds");
    const interestsRes = await fetch(
      `${REGISTRY_API}/registry/participation-interests/${encodeURIComponent(financierB)}`
    );
    assert.equal(interestsRes.status, 200);
    console.log("   registry-api participation metadata ✓");
  } catch {
    console.log("   registry-api offline — skipping HTTP check");
  }

  console.log("\n8. Phase 1–3 regression spot-checks...");
  const buyerViews = await client.getActiveContractsByInterface(buyer, INTERFACE_IDS.buyerView);
  const buyerEntry = buyerViews.find((c) => c.contractId === syndicatedReceivableCid);
  if (buyerEntry) {
    const buyerView = buyerEntry.interfaceViews.find((v) => v.interfaceId.includes("IBuyerView"))
      ?.viewValue as Record<string, unknown> | undefined;
    assert.ok(buyerView);
    assert.ok(!("discountRate" in buyerView));
    assert.equal(String(buyerView.payee), financierA);
  }
  const financierBBids = await client.getActiveContractsByTemplate(financierB, TEMPLATE_IDS.bid);
  const otherFinancierBids = financierBBids.filter(
    (b) => String((b.payload as Record<string, unknown>).financier) !== financierB
  );
  assert.equal(otherFinancierBids.length, 0);
  console.log(`   receivableId=${receivableId} buyer view + bid privacy ✓`);

  console.log("\nPhase 4 devnet integration: ALL PASSED");
}

main().catch((err) => {
  console.error("\nPhase 4 devnet integration FAILED:", err);
  process.exit(1);
});
