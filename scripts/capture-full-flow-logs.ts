/**
 * Run the full Meridian financing → syndication → waterfall flow on Seaport DevNet
 * and write step logs + Canton explorer transaction links under logs/.
 *
 * Usage:
 *   pnpm redstone:fetch
 *   pnpm capture:flow:logs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildAdvanceAllocationCommand,
  buildAwardBidCommand,
  buildAwardSyndicationBidCommand,
  buildCoSignAndIssueCommand,
  buildCreateFinancingFactoryCommand,
  buildCreateReceivableProposalCommand,
  buildCreateSyndicationFactoryCommand,
  buildOpenFinancingRoundCommand,
  buildOpenSyndicationOfferingCommand,
  buildPostForBidCommand,
  buildRepayWithProofCommand,
  buildSubmitBidCommand,
  buildSubmitSyndicationBidCommand,
  CASH,
  extractAllocationCid,
  extractCreatedContractId,
  oracleAnchoredMode,
  shareAmount,
  TEMPLATE_IDS,
  type JsonLedgerClient,
  type SubmitAndWaitResult,
} from "@meridian/ledger-client";
import { loadCashManifest, musdBalance } from "./cash-devnet-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LOGS_DIR = join(ROOT, "logs");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");

const EXPLORER_BASE =
  process.env.CANTON_EXPLORER_URL ?? "https://lighthouse.devnet.cantonloop.com";

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";
const ADVANCE = "1500";
const FACE_VALUE = "2000";
const PARTICIPANT_SHARE_BPS = 4000;

loadDotenv({ path: join(ROOT, ".env") });

interface FlowStep {
  step: number;
  name: string;
  description: string;
  actAs: string[];
  updateId: string | null;
  explorerUrl: string | null;
  contractIds: Record<string, string>;
  recordTime: string | null;
  status: "ok" | "error";
  error?: string;
}

interface FlowLog {
  runId: string;
  startedAt: string;
  finishedAt: string;
  environment: string;
  explorerBase: string;
  parties: Record<string, string>;
  steps: FlowStep[];
  summary: {
    totalSteps: number;
    transactionsCaptured: number;
    faceValue: string;
    advance: string;
    participantShareBps: number;
  };
}

function explorerTxUrl(updateId: string): string {
  return `${EXPLORER_BASE}/transactions/${encodeURIComponent(updateId)}`;
}

function extractUpdateMeta(result: SubmitAndWaitResult): {
  updateId: string | null;
  recordTime: string | null;
} {
  const tx = result.transaction as
    | { updateId?: string; recordTime?: string }
    | undefined;
  return {
    updateId: tx?.updateId ? String(tx.updateId) : null,
    recordTime: tx?.recordTime ? String(tx.recordTime) : null,
  };
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

function loadOracleSnapshot(): {
  payloadHex: string;
  packageTimestampMs: number;
  isFresh: boolean;
} {
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

function shortId(id: string, n = 20): string {
  return id.length <= n ? id : `${id.slice(0, n)}…`;
}

async function musdHoldingCids(
  client: JsonLedgerClient,
  owner: string,
  registryAdmin: string
): Promise<string[]> {
  const holdingRows = await client.getActiveContractsByTemplate(owner, CASH.musdHolding);
  return holdingRows
    .filter((h) => {
      const p = h.payload as {
        holding?: { instrumentId?: { id?: string; admin?: string }; lock?: unknown };
      };
      return (
        p.holding?.instrumentId?.id === "MUSD" &&
        p.holding?.instrumentId?.admin === registryAdmin &&
        !p.holding?.lock
      );
    })
    .map((h) => h.contractId);
}

function writeArtifacts(log: FlowLog, consoleText: string): void {
  mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = log.runId;
  writeFileSync(join(LOGS_DIR, `full-flow-${stamp}.json`), JSON.stringify(log, null, 2));
  writeFileSync(join(LOGS_DIR, "full-flow-latest.json"), JSON.stringify(log, null, 2));
  writeFileSync(join(LOGS_DIR, `full-flow-${stamp}.console.txt`), consoleText);

  const md = renderMarkdown(log);
  writeFileSync(join(LOGS_DIR, `full-flow-${stamp}.md`), md);
  writeFileSync(join(LOGS_DIR, "full-flow-latest.md"), md);
  writeFileSync(join(LOGS_DIR, "TRANSACTIONS.md"), renderTransactionsTable(log));

  console.log(`\nWrote logs/:`);
  console.log(`  logs/full-flow-latest.md`);
  console.log(`  logs/full-flow-latest.json`);
  console.log(`  logs/TRANSACTIONS.md`);
}

function renderTransactionsTable(log: FlowLog): string {
  const rows = log.steps.filter((s) => s.updateId);
  const lines = [
    `# Meridian DevNet transaction log`,
    ``,
    `Run ID: \`${log.runId}\`  `,
    `Started: ${log.startedAt}  `,
    `Finished: ${log.finishedAt}  `,
    `Explorer: [${log.explorerBase}](${log.explorerBase})`,
    ``,
    `| # | Step | Update ID | Explorer |`,
    `|---|------|-----------|----------|`,
  ];
  for (const s of rows) {
    const id = s.updateId!;
    const short = id.length > 28 ? `${id.slice(0, 14)}…${id.slice(-8)}` : id;
    lines.push(`| ${s.step} | ${s.name} | \`${short}\` | [View](${s.explorerUrl}) |`);
  }
  lines.push(``);
  lines.push(`## Full update IDs`);
  lines.push(``);
  for (const s of rows) {
    lines.push(`### ${s.step}. ${s.name}`);
    lines.push(``);
    lines.push(`- **Description:** ${s.description}`);
    lines.push(`- **Act as:** ${s.actAs.map((p) => `\`${p.split("::")[0]}\``).join(", ")}`);
    lines.push(`- **Update ID:** \`${s.updateId}\``);
    lines.push(`- **Explorer:** ${s.explorerUrl}`);
    if (s.recordTime) lines.push(`- **Record time:** ${s.recordTime}`);
    if (Object.keys(s.contractIds).length) {
      lines.push(`- **Contracts:**`);
      for (const [k, v] of Object.entries(s.contractIds)) {
        lines.push(`  - ${k}: \`${v}\``);
      }
    }
    lines.push(``);
  }
  return lines.join("\n");
}

function renderMarkdown(log: FlowLog): string {
  const lines = [
    `# Full Meridian flow log — ${log.runId}`,
    ``,
    `End-to-end Seaport DevNet run: invoice issuance → sealed-bid financing → CIP-56 DvP award → syndication → waterfall repayment.`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Started | ${log.startedAt} |`,
    `| Finished | ${log.finishedAt} |`,
    `| Environment | ${log.environment} |`,
    `| Face value | ${log.summary.faceValue} |`,
    `| Advance | ${log.summary.advance} |`,
    `| Participant share | ${log.summary.participantShareBps} bps |`,
    `| Transactions captured | ${log.summary.transactionsCaptured} / ${log.summary.totalSteps} steps |`,
    ``,
    `## Parties`,
    ``,
    `| Role | Party hint |`,
    `|------|------------|`,
  ];
  for (const [role, id] of Object.entries(log.parties)) {
    lines.push(`| ${role} | \`${id.split("::")[0]}\` |`);
  }
  lines.push(``);
  lines.push(`## Steps`);
  lines.push(``);
  for (const s of log.steps) {
    lines.push(`### ${s.step}. ${s.name} — ${s.status}`);
    lines.push(``);
    lines.push(s.description);
    lines.push(``);
    lines.push(`- **Act as:** ${s.actAs.map((p) => `\`${p.split("::")[0]}\``).join(", ")}`);
    if (s.updateId) {
      lines.push(`- **Update ID:** \`${s.updateId}\``);
      lines.push(`- **Explorer:** [Open transaction](${s.explorerUrl})`);
    }
    if (s.error) lines.push(`- **Error:** ${s.error}`);
    if (Object.keys(s.contractIds).length) {
      lines.push(`- **Contracts:**`);
      for (const [k, v] of Object.entries(s.contractIds)) {
        lines.push(`  - **${k}:** \`${shortId(v, 48)}\``);
      }
    }
    lines.push(``);
  }
  lines.push(`See also [TRANSACTIONS.md](./TRANSACTIONS.md).`);
  lines.push(``);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const consoleLines: string[] = [];
  const logLine = (msg: string) => {
    console.log(msg);
    consoleLines.push(msg);
  };

  if (!process.env.DEVNET_CLIENT_SECRET) {
    throw new Error("DEVNET_CLIENT_SECRET required");
  }
  if (!existsSync(join(ROOT, "infra/manifests/cash.devnet.json"))) {
    throw new Error("run: pnpm bootstrap:cash:devnet");
  }

  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, "-");
  const oracle = loadOracleSnapshot();
  assert.ok(oracle.isFresh, "oracle snapshot must be fresh — run: pnpm redstone:fetch");

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const parties = {
    supplier: party(manifest, "meridian-supplier"),
    buyer: party(manifest, "meridian-buyer"),
    financierA: party(manifest, "meridian-financier-a"),
    financierB: party(manifest, "meridian-financier-b"),
    platformOperator: party(manifest, "meridian-platform"),
    registry: party(manifest, "meridian-registry"),
  };
  const cash = loadCashManifest(ROOT);
  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);

  const steps: FlowStep[] = [];
  let stepNo = 0;

  const record = async (
    name: string,
    description: string,
    actAs: string[],
    run: () => Promise<{
      result: SubmitAndWaitResult;
      contractIds?: Record<string, string>;
    }>
  ): Promise<Record<string, string>> => {
    stepNo += 1;
    logLine(`\n[${stepNo}] ${name}...`);
    try {
      const out = await run();
      const meta = extractUpdateMeta(out.result);
      const step: FlowStep = {
        step: stepNo,
        name,
        description,
        actAs,
        updateId: meta.updateId,
        explorerUrl: meta.updateId ? explorerTxUrl(meta.updateId) : null,
        contractIds: out.contractIds ?? {},
        recordTime: meta.recordTime,
        status: "ok",
      };
      steps.push(step);
      if (meta.updateId) {
        logLine(`    updateId=${meta.updateId}`);
        logLine(`    explorer=${step.explorerUrl}`);
      } else {
        logLine(`    WARNING: no updateId in submit response`);
      }
      for (const [k, v] of Object.entries(step.contractIds)) {
        logLine(`    ${k}=${shortId(v, 40)}`);
      }
      return step.contractIds;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({
        step: stepNo,
        name,
        description,
        actAs,
        updateId: null,
        explorerUrl: null,
        contractIds: {},
        recordTime: null,
        status: "error",
        error: message,
      });
      throw err;
    }
  };

  logLine(`Meridian full-flow capture starting ${startedAt}`);
  logLine(`Explorer base: ${EXPLORER_BASE}`);

  const proposalId = `FLOW-${Date.now()}`;
  const requestId = `ROUND-FLOW-${Date.now()}`;
  const offeringId = `SYN-FLOW-${Date.now()}`;

  let proposalCid = "";
  await record(
    "Propose invoice",
    "Supplier creates ReceivableProposal with inline assignment consent.",
    [parties.supplier],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier],
        commands: [
          buildCreateReceivableProposalCommand({
            proposalId,
            supplier: parties.supplier,
            buyer: parties.buyer,
            lineItems: [{ description: "Flow capture item", quantity: "1", unitPrice: FACE_VALUE }],
            faceValue: FACE_VALUE,
            currency: "USD",
            dueDate: "2026-12-31",
            consentSource: { tag: "InlineConsent", value: true },
          }),
        ],
      });
      proposalCid = extractCreatedContractId(result) ?? "";
      assert.ok(proposalCid);
      return { result, contractIds: { proposalCid } };
    }
  );

  let receivableCid = "";
  await record(
    "Co-sign and issue receivable",
    "Buyer co-signs proposal → Receivable issued (Issued state).",
    [parties.buyer],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.buyer],
        commands: [
          buildCoSignAndIssueCommand({
            proposalContractId: proposalCid,
            jurisdiction: "US",
            platformOperator: parties.platformOperator,
          }),
        ],
      });
      receivableCid = extractCreatedContractId(result) ?? "";
      assert.ok(receivableCid);
      return { result, contractIds: { receivableCid } };
    }
  );

  let postedCid = "";
  await record(
    "Post receivable for bid",
    "Supplier marks receivable PostedForBid.",
    [parties.supplier],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier],
        commands: [buildPostForBidCommand(receivableCid)],
      });
      postedCid = extractCreatedContractId(result) ?? "";
      assert.ok(postedCid);
      return { result, contractIds: { postedReceivableCid: postedCid } };
    }
  );

  let factoryCid = "";
  await record(
    "Create financing round factory",
    "Supplier creates FinancingRoundFactory.",
    [parties.supplier],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier],
        commands: [buildCreateFinancingFactoryCommand({ supplier: parties.supplier })],
      });
      factoryCid = extractCreatedContractId(result) ?? "";
      assert.ok(factoryCid);
      return { result, contractIds: { financingFactoryCid: factoryCid } };
    }
  );

  let requestCid = "";
  await record(
    "Open sealed-bid financing round",
    "Supplier opens FinancingRequest inviting Financier A (oracle-anchored band).",
    [parties.supplier],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier],
        commands: [
          buildOpenFinancingRoundCommand({
            factoryContractId: factoryCid,
            receivableCid: postedCid,
            requestId,
            financiers: [parties.financierA],
            deadline: addDaysLedgerTime(ledgerTime, 7),
            pricingBandMin: PRICING_BAND_MIN,
            pricingBandMax: PRICING_BAND_MAX,
            redstoneFeedId: SOFR_FEED_ID_ASCII,
          }),
        ],
      });
      requestCid = extractCreatedContractId(result, "FinancingRequest:FinancingRequest") ?? "";
      assert.ok(requestCid);
      return { result, contractIds: { financingRequestCid: requestCid } };
    }
  );

  await record(
    "Submit sealed bid (Financier A)",
    "Financier A submits oracle-anchored Bid (supplier-only observer).",
    [parties.financierA],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA],
        commands: [
          buildSubmitBidCommand({
            requestContractId: requestCid,
            financier: parties.financierA,
            advanceAmount: ADVANCE,
            discountRate: "0.05",
            redstonePayload: oracle.payloadHex,
            redstoneTimestampMs: oracle.packageTimestampMs,
            mode: oracleAnchoredMode(),
            ledgerTime,
          }),
        ],
      });
      const bidCid =
        extractCreatedContractId(result, "Bid") ?? extractCreatedContractId(result) ?? "";
      return { result, contractIds: bidCid ? { bidCid } : {} };
    }
  );

  const bids = await client.getActiveContractsByTemplate(parties.financierA, TEMPLATE_IDS.bid);
  const bid = bids.find((b) => String((b.payload as Record<string, unknown>).requestId) === requestId);
  assert.ok(bid, "winning bid missing");
  const updatedRequests = await client.getActiveContractsByTemplate(
    parties.supplier,
    TEMPLATE_IDS.financingRequest
  );
  const updatedRequest = updatedRequests.find(
    (r) => String((r.payload as Record<string, unknown>).requestId) === requestId
  );
  assert.ok(updatedRequest, "updated financing request missing");

  const now = new Date().toISOString();
  const weekLater = new Date(Date.now() + 7 * 86400000).toISOString();
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString();
  const holdingCids = await musdHoldingCids(client, parties.financierA, cash.registryAdminPartyId);
  assert.ok(holdingCids.length > 0, "financier A has no MUSD");

  let allocationCid = "";
  await record(
    "CIP-56 allocate MUSD advance",
    "Financier + registry create locked MusdAllocation for the advance amount.",
    [parties.financierA, cash.registryAdminPartyId],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA, cash.registryAdminPartyId],
        commands: [
          buildAdvanceAllocationCommand({
            rulesContractId: cash.rulesContractId,
            registryAdmin: cash.registryAdminPartyId,
            executor: parties.supplier,
            financier: parties.financierA,
            supplier: parties.supplier,
            advanceAmount: ADVANCE,
            inputHoldingCids: holdingCids,
            requestedAt: now,
            allocateBefore: weekLater,
            settleBefore: twoWeeks,
          }),
        ],
      });
      allocationCid = extractAllocationCid(result) ?? "";
      assert.ok(allocationCid);
      return { result, contractIds: { allocationCid } };
    }
  );

  let fundedReceivableCid = "";
  await record(
    "AwardBid atomic DvP",
    "Supplier + financier: execute allocation, ApplyFunding, close bids, write SettlementAuditRecord.",
    [parties.supplier, parties.financierA],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.supplier, parties.financierA],
        commands: [
          buildAwardBidCommand({
            requestContractId: updatedRequest.contractId,
            winningBidCid: bid.contractId,
            settlementAllocationCid: allocationCid,
            expectedAdvance: ADVANCE,
            settlementFinancier: parties.financierA,
          }),
        ],
      });
      fundedReceivableCid = extractCreatedContractId(result, "Receivable") ?? "";
      assert.ok(fundedReceivableCid);
      return {
        result,
        contractIds: {
          fundedReceivableCid,
          bidCid: bid.contractId,
          financingRequestCid: updatedRequest.contractId,
        },
      };
    }
  );

  let syndicationFactoryCid = "";
  await record(
    "Create syndication factory",
    "Lead financier creates SyndicationFactory.",
    [parties.financierA],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA],
        commands: [buildCreateSyndicationFactoryCommand({ leadFinancier: parties.financierA })],
      });
      syndicationFactoryCid = extractCreatedContractId(result) ?? "";
      assert.ok(syndicationFactoryCid);
      return { result, contractIds: { syndicationFactoryCid } };
    }
  );

  let offeringCid = "";
  await record(
    "Open syndication offering",
    "Lead opens SyndicationOffering inviting Financier B (buyer/supplier never observers).",
    [parties.financierA],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA],
        commands: [
          buildOpenSyndicationOfferingCommand({
            factoryContractId: syndicationFactoryCid,
            receivableCid: fundedReceivableCid,
            offeringId,
            participants: [parties.financierB],
            deadline: addDaysLedgerTime(ledgerTime, 7),
            pricingBandMin: PRICING_BAND_MIN,
            pricingBandMax: PRICING_BAND_MAX,
            redstoneFeedId: SOFR_FEED_ID_ASCII,
          }),
        ],
      });
      offeringCid = extractCreatedContractId(result, "SyndicationOffering") ?? "";
      assert.ok(offeringCid);
      return { result, contractIds: { offeringCid } };
    }
  );

  let syndicationBidCid = "";
  await record(
    "Submit sealed syndication bid (Financier B)",
    "Participant submits SyndicationBid (lead-only observer).",
    [parties.financierB],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierB],
        commands: [
          buildSubmitSyndicationBidCommand({
            offeringContractId: offeringCid,
            participant: parties.financierB,
            shareBps: PARTICIPANT_SHARE_BPS,
            discountRate: "0.05",
            redstonePayload: oracle.payloadHex,
            redstoneTimestampMs: oracle.packageTimestampMs,
            mode: oracleAnchoredMode(),
            ledgerTime,
          }),
        ],
      });
      syndicationBidCid = extractCreatedContractId(result, "SyndicationBid") ?? "";
      assert.ok(syndicationBidCid);
      return { result, contractIds: { syndicationBidCid } };
    }
  );

  const offeringsAfterBid = await client.getActiveContractsByTemplate(
    parties.financierA,
    TEMPLATE_IDS.syndicationOffering
  );
  const activeOffering = offeringsAfterBid.find(
    (o) => String((o.payload as Record<string, unknown>).offeringId) === offeringId
  );
  assert.ok(activeOffering);
  const updatedOfferingCid = activeOffering.contractId;

  let syndicatedReceivableCid = "";
  await record(
    "Award syndication (participation interest)",
    "Lead + participant award → ParticipationInterest + PartiallySyndicated receivable.",
    [parties.financierA, parties.financierB],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.financierA, parties.financierB],
        commands: [
          buildAwardSyndicationBidCommand({
            offeringContractId: updatedOfferingCid,
            winningBidCid: syndicationBidCid,
            winningParticipant: parties.financierB,
          }),
        ],
      });
      syndicatedReceivableCid = extractCreatedContractId(result, "Receivable") ?? "";
      assert.ok(syndicatedReceivableCid);
      const interestCid = extractCreatedContractId(result, "ParticipationInterest") ?? "";
      return {
        result,
        contractIds: {
          syndicatedReceivableCid,
          ...(interestCid ? { participationInterestCid: interestCid } : {}),
        },
      };
    }
  );

  const participantBalBefore = await musdBalance(client, parties.financierB, cash.registryAdminPartyId);
  const leadBalBefore = await musdBalance(client, parties.financierA, cash.registryAdminPartyId);
  const expectedParticipant = shareAmount(Number(FACE_VALUE), PARTICIPANT_SHARE_BPS);
  const expectedLeadRemainder = Number(FACE_VALUE) - expectedParticipant;

  const repayNow = new Date().toISOString();
  const repayWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  const repayTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString();

  const recipients = [
    { party: parties.financierB, amount: expectedParticipant },
    { party: parties.financierA, amount: expectedLeadRemainder },
  ];
  const allocationCids: string[] = [];
  let buyerHoldings = await musdHoldingCids(client, parties.buyer, cash.registryAdminPartyId);
  assert.ok(buyerHoldings.length > 0, "buyer has no MUSD");

  for (const { party: receiver, amount } of recipients) {
    if (amount <= 0) continue;
    await record(
      `CIP-56 waterfall allocation → ${receiver.split("::")[0]}`,
      `Buyer allocates ${amount} MUSD to ${receiver.split("::")[0]} for syndicated repayment waterfall.`,
      [parties.buyer, cash.registryAdminPartyId],
      async () => {
        const result = await client.submitAndWaitForTransaction({
          actAs: [parties.buyer, cash.registryAdminPartyId],
          commands: [
            buildAdvanceAllocationCommand({
              rulesContractId: cash.rulesContractId,
              registryAdmin: cash.registryAdminPartyId,
              executor: parties.supplier,
              financier: parties.buyer,
              supplier: receiver,
              advanceAmount: String(amount),
              inputHoldingCids: buyerHoldings,
              requestedAt: repayNow,
              allocateBefore: repayWeek,
              settleBefore: repayTwoWeeks,
            }),
          ],
        });
        const cid = extractAllocationCid(result) ?? "";
        assert.ok(cid);
        allocationCids.push(cid);
        buyerHoldings = await musdHoldingCids(client, parties.buyer, cash.registryAdminPartyId);
        return {
          result,
          contractIds: { allocationCid: cid, receiver, amount: String(amount) },
        };
      }
    );
  }

  await record(
    "Waterfall RepayWithProof",
    "Buyer + lead + supplier + participant: execute repayment allocations and create RepaymentProof.",
    [parties.buyer, parties.financierA, parties.supplier, parties.financierB],
    async () => {
      const result = await client.submitAndWaitForTransaction({
        actAs: [parties.buyer, parties.financierA, parties.supplier, parties.financierB],
        commands: [
          buildRepayWithProofCommand({
            receivableContractId: syndicatedReceivableCid,
            settlementAllocationCids: allocationCids,
            expectedAmount: FACE_VALUE,
            settlementRef: `flow-waterfall-${Date.now()}`,
            syndicationParticipants: [parties.financierB],
          }),
        ],
      });
      const repaidReceivableCid =
        extractCreatedContractId(result, "Receivable:Receivable") ??
        extractCreatedContractId(result, "Receivable") ??
        "";
      const proofCid = extractCreatedContractId(result, "RepaymentProof") ?? "";
      assert.ok(repaidReceivableCid && proofCid);
      return {
        result,
        contractIds: { repaidReceivableCid, repaymentProofCid: proofCid },
      };
    }
  );

  const participantBalAfter = await musdBalance(client, parties.financierB, cash.registryAdminPartyId);
  const leadBalAfter = await musdBalance(client, parties.financierA, cash.registryAdminPartyId);
  assert.ok(Math.abs(participantBalAfter - participantBalBefore - expectedParticipant) < 0.01);
  assert.ok(Math.abs(leadBalAfter - leadBalBefore - expectedLeadRemainder) < 0.01);
  logLine(`\nBalances: participant +${expectedParticipant}, lead +${expectedLeadRemainder} MUSD ✓`);

  const finishedAt = new Date().toISOString();
  const withTx = steps.filter((s) => s.updateId).length;
  const flowLog: FlowLog = {
    runId,
    startedAt,
    finishedAt,
    environment: "seaport-devnet",
    explorerBase: EXPLORER_BASE,
    parties,
    steps,
    summary: {
      totalSteps: steps.length,
      transactionsCaptured: withTx,
      faceValue: FACE_VALUE,
      advance: ADVANCE,
      participantShareBps: PARTICIPANT_SHARE_BPS,
    },
  };

  writeArtifacts(flowLog, consoleLines.join("\n") + "\n");
  logLine(`\nFull flow capture COMPLETE — ${withTx}/${steps.length} steps have updateIds`);
}

main().catch((err) => {
  console.error("\nFull flow capture FAILED:", err);
  process.exit(1);
});
