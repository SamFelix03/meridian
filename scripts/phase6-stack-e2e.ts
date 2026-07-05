/**
 * Phase 6 full stack E2E: mandate config, real Groq agent tick, adversarial rejection.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import { DevNetAuthClient } from "@meridian/devnet-auth";
import {
  buildCreateFinancingFactoryCommand,
  buildOpenFinancingRoundCommand,
  buildPostForBidCommand,
  extractCreatedContractId,
} from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ORACLE_SNAPSHOT = join(ROOT, "infra/samples/redstone-fetch-latest.json");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");

loadDotenv({ path: join(ROOT, ".env") });

const PORTAL_API = process.env.PORTAL_API_URL ?? "http://127.0.0.1:4000";
const SUPPLIER_INDEXER = process.env.SUPPLIER_INDEXER_URL ?? "http://127.0.0.1:4011";
const BUYER_INDEXER = process.env.BUYER_INDEXER_URL ?? "http://127.0.0.1:4012";
const FINANCIER_INDEXER_A = process.env.FINANCIER_INDEXER_URL ?? "http://127.0.0.1:4013";
const FINANCIER_INDEXER_B = process.env.FINANCIER_INDEXER_B_URL ?? "http://127.0.0.1:4014";
const NOTIFICATIONS = process.env.NOTIFICATIONS_URL ?? "http://127.0.0.1:4020";
const ORACLE_RELAY = process.env.ORACLE_RELAY_URL ?? "http://127.0.0.1:4021";
const AGENT_RUNTIME = process.env.AGENT_RUNTIME_URL ?? "http://127.0.0.1:4025";

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";

const children: ChildProcess[] = [];
let agentChild: ChildProcess | null = null;

interface OracleSnapshot {
  payloadHex: string;
  packageTimestampMs: number;
  isFresh: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function millisToLedgerTime(ms: number): string {
  return new Date(ms).toISOString();
}

function addDaysLedgerTime(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function partyId(orgId: string): string {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as {
    personas: Array<{ orgId: string; partyId?: string }>;
  };
  const entry = manifest.personas.find((p) => p.orgId === orgId);
  if (!entry?.partyId) throw new Error(`party missing: ${orgId}`);
  return entry.partyId;
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
  return { payloadHex, packageTimestampMs, isFresh: raw.isFresh ?? false };
}

function oraclePreflight(): OracleSnapshot {
  console.log("0. Oracle preflight...");
  const oracle = loadOracleSnapshot();
  assert.ok(oracle.isFresh, "oracle snapshot must be fresh — run: pnpm redstone:fetch");
  console.log(
    `   payload ${oracle.payloadHex.length} hex chars, ts=${oracle.packageTimestampMs} ✓`
  );
  return oracle;
}

function spawnService(
  name: string,
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>
): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
  children.push(child);
  return child;
}

function stopAgent(): void {
  if (agentChild && !agentChild.killed) {
    agentChild.kill();
    const idx = children.indexOf(agentChild);
    if (idx >= 0) children.splice(idx, 1);
    agentChild = null;
  }
}

function startAgent(extraEnv: Record<string, string> = {}): void {
  stopAgent();
  agentChild = spawnService("agent-runtime", join(ROOT, "services/agent-runtime"), ["dist/cli.js"], {
    AGENT_RUNTIME_PORT: "4025",
    AGENT_POLL_MS: "0",
    FINANCIER_INDEXER_URL: FINANCIER_INDEXER_A,
    ORACLE_RELAY_URL: ORACLE_RELAY,
    ...extraEnv,
  });
}

async function waitForHealth(url: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function pollUntil<T>(
  label: string,
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 120_000,
  intervalMs = 2000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (predicate(value)) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function grantDevNetRights(): Promise<void> {
  const { execSync } = await import("node:child_process");
  execSync("pnpm exec tsx scripts/grant-devnet-rights.ts", {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
}

function stopChildren(): void {
  stopAgent();
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

async function startStack(): Promise<void> {
  console.log("Starting Phase 6 stack services...");
  spawnService("registry-api", join(ROOT, "services/registry-api"), ["dist/index.js"], {
    REGISTRY_API_PORT: "4022",
  });
  spawnService(
    "indexer-supplier",
    join(ROOT, "services/indexer"),
    ["dist/cli.js", "../../infra/configs/indexer-supplier.yaml", "--rebuild", "--serve"],
    { MERIDIAN_INDEXER_POLL_MS: "2000" }
  );
  spawnService(
    "indexer-buyer",
    join(ROOT, "services/indexer"),
    ["dist/cli.js", "../../infra/configs/indexer-buyer.yaml", "--rebuild", "--serve"],
    { MERIDIAN_INDEXER_POLL_MS: "2000" }
  );
  spawnService(
    "indexer-financier-a",
    join(ROOT, "services/indexer"),
    ["dist/cli.js", "../../infra/configs/indexer-financier-a.yaml", "--rebuild", "--serve"],
    { MERIDIAN_INDEXER_POLL_MS: "2000" }
  );
  spawnService(
    "indexer-financier-b",
    join(ROOT, "services/indexer"),
    ["dist/cli.js", "../../infra/configs/indexer-financier-b.yaml", "--rebuild", "--serve"],
    { MERIDIAN_INDEXER_POLL_MS: "2000" }
  );
  spawnService("oracle-relay", join(ROOT, "services/oracle-relay"), ["dist/cli.js"], {
    ORACLE_RELAY_PORT: "4021",
  });
  spawnService("notifications", join(ROOT, "services/notifications"), ["dist/cli.js"], {
    NOTIFICATIONS_PORT: "4020",
  });
  startAgent({ AGENT_ADVERSARIAL: "0" });
  spawnService("portal-api", join(ROOT, "services/portal-api"), ["dist/index.js"], {
    ORACLE_RELAY_URL: ORACLE_RELAY,
    FINANCIER_INDEXER_URL: FINANCIER_INDEXER_A,
    AGENT_RUNTIME_URL: AGENT_RUNTIME,
  });

  await Promise.all([
    waitForHealth(`${SUPPLIER_INDEXER}/health`),
    waitForHealth(`${BUYER_INDEXER}/health`),
    waitForHealth(`${FINANCIER_INDEXER_A}/health`),
    waitForHealth(`${FINANCIER_INDEXER_B}/health`),
    waitForHealth(`${ORACLE_RELAY}/health`),
    waitForHealth(`${NOTIFICATIONS}/`),
    waitForHealth(`${PORTAL_API}/health`),
    waitForHealth(`${AGENT_RUNTIME}/health`),
  ]);
  console.log("All services healthy.");
}

async function issueReceivableViaPortal(ts: number): Promise<string> {
  const proposalId = `P6-STACK-${ts}`;
  const proposeRes = await fetch(`${PORTAL_API}/invoices/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proposalId,
      faceValue: "3200",
      currency: "USD",
      dueDate: "2026-12-31",
      consentGranted: true,
      lineItems: [{ description: "Phase 6 stack item", quantity: "1", unitPrice: "3200" }],
    }),
  });
  const proposeText = await proposeRes.text();
  assert.equal(proposeRes.status, 201, proposeText);
  const proposalCid = (JSON.parse(proposeText) as { contractId: string }).contractId;
  await pollUntil(
    "buyer pending proposal",
    async () => {
      const res = await fetch(`${PORTAL_API}/buyer/pending-proposals`);
      const body = (await res.json()) as { proposals: Array<{ contractId: string }> };
      return body.proposals ?? [];
    },
    (proposals) => proposals.some((p) => p.contractId === proposalCid)
  );
  const cosignRes = await fetch(
    `${PORTAL_API}/invoices/${encodeURIComponent(proposalCid)}/cosign`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  const cosignText = await cosignRes.text();
  assert.equal(cosignRes.status, 200, cosignText);
  const receivableContractId = (JSON.parse(cosignText) as { receivableContractId: string })
    .receivableContractId;
  assert.ok(receivableContractId);
  return receivableContractId;
}

async function openRound(
  receivableCid: string,
  requestId: string,
  oracle: OracleSnapshot,
  financierA: string
): Promise<string> {
  const supplier = partyId("meridian-supplier");
  const auth = DevNetAuthClient.fromEnv();
  const client = await auth.createAuthenticatedLedgerClient();
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);

  const postResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildPostForBidCommand(receivableCid)],
  });
  const postedCid = extractCreatedContractId(postResult);
  assert.ok(postedCid, "posted receivable missing");

  const factoryResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildCreateFinancingFactoryCommand({ supplier })],
  });
  const factoryCid = extractCreatedContractId(factoryResult);
  assert.ok(factoryCid, "factory missing");

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
  const requestCid = extractCreatedContractId(roundResult, "FinancingRequest");
  assert.ok(requestCid, "financing request missing");
  return requestCid;
}

async function main(): Promise<void> {
  if (!process.env.DEVNET_CLIENT_SECRET) {
    console.error("DEVNET_CLIENT_SECRET required");
    process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY required for Phase 6 stack E2E (real Groq, no mocks)");
    process.exit(1);
  }
  if (!existsSync(MANIFEST)) {
    console.error("manifest missing");
    process.exit(1);
  }

  const oracle = oraclePreflight();
  const financierA = partyId("meridian-financier-a");
  const financierB = partyId("meridian-financier-b");
  const ts = Date.now();

  process.on("SIGINT", () => {
    stopChildren();
    process.exit(130);
  });

  try {
    await grantDevNetRights();
    await startStack();

    console.log("1. Issue receivable via portal...");
    const receivableCid = await issueReceivableViaPortal(ts);

    console.log("2. Open financing round inviting financier A...");
    const requestId = `P6-STACK-ROUND-${ts}`;
    const requestCid = await openRound(receivableCid, requestId, oracle, financierA);

    await pollUntil(
      "financier invitation",
      async () => {
        const res = await fetch(`${PORTAL_API}/financier/invitations`);
        const body = (await res.json()) as { invitations: Array<{ requestId: string }> };
        return body.invitations ?? [];
      },
      (inv) => inv.some((i) => i.requestId === requestId)
    );
    console.log("   invitation indexed ✓");

    console.log("3. Create mandate via portal-api...");
    const mandateRes = await fetch(`${PORTAL_API}/financier/mandates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mandateId: `MANDATE-STACK-${ts}`,
        maxExposure: "2500",
        minSpread: "0.02",
        eligibleSuppliers: [partyId("meridian-supplier")],
        agentEnabled: true,
      }),
    });
    const mandateText = await mandateRes.text();
    assert.equal(mandateRes.status, 201, mandateText);
    const mandateBody = JSON.parse(mandateText) as { contractId: string };
    assert.ok(mandateBody.contractId);

    await pollUntil(
      "mandate projection",
      async () => {
        const res = await fetch(`${PORTAL_API}/financier/mandates`);
        const body = (await res.json()) as {
          mandates: Array<{ contractId: string; agentEnabled: boolean }>;
        };
        return body.mandates ?? [];
      },
      (mandates) => mandates.some((m) => m.contractId === mandateBody.contractId && m.agentEnabled)
    );
    console.log("   mandate indexed ✓");

    console.log("4. Trigger agent tick (real Groq)...");
    const tickRes = await fetch(`${PORTAL_API}/financier/agent/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const tickBody = (await tickRes.json()) as {
      decisions?: Array<{ requestId: string; submitted: boolean; ledgerError?: string }>;
      lastError?: string;
    };
    assert.equal(tickRes.status, 200, JSON.stringify(tickBody));
    const decision = tickBody.decisions?.find((d) => d.requestId === requestId);
    assert.ok(decision, "agent decision for round missing");
    if (!decision.submitted) {
      console.log("   agent chose not to bid:", decision);
    }

    await pollUntil(
      "agent bid in indexer",
      async () => {
        const res = await fetch(`${PORTAL_API}/financier/my-bids`);
        const body = (await res.json()) as {
          bids: Array<{ requestId: string; viaAgent?: boolean }>;
        };
        return body.bids ?? [];
      },
      (bids) => bids.some((b) => b.requestId === requestId && b.viaAgent),
      180_000
    );
    console.log("   agent bid visible in financier indexer ✓");

    console.log("5. Adversarial agent tick — ledger must reject...");
    const advTs = Date.now();
    const receivable2 = await issueReceivableViaPortal(advTs);
    const advRequestId = `P6-ADV-ROUND-${advTs}`;
    await openRound(receivable2, advRequestId, oracle, financierA);
    await pollUntil(
      "adversarial invitation",
      async () => {
        const res = await fetch(`${PORTAL_API}/financier/invitations`);
        const body = (await res.json()) as { invitations: Array<{ requestId: string }> };
        return body.invitations ?? [];
      },
      (inv) => inv.some((i) => i.requestId === advRequestId)
    );

    const bidsBeforeRes = await fetch(`${PORTAL_API}/financier/my-bids`);
    const bidsBefore = ((await bidsBeforeRes.json()) as { bids: Array<{ requestId: string }> })
      .bids;
    const countBefore = bidsBefore.filter((b) => b.requestId === advRequestId).length;

    startAgent({ AGENT_ADVERSARIAL: "1" });
    await waitForHealth(`${AGENT_RUNTIME}/health`);

    const advTickRes = await fetch(`${PORTAL_API}/financier/agent/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const advTickBody = (await advTickRes.json()) as {
      decisions?: Array<{ requestId: string; submitted: boolean; ledgerError?: string }>;
    };
    console.log("   adversarial tick response:", JSON.stringify(advTickBody, null, 2));
    const advDecision = advTickBody.decisions?.find((d) => d.requestId === advRequestId);
    assert.ok(advDecision, `adversarial decision missing (decisions: ${JSON.stringify(advTickBody.decisions)})`);
    assert.equal(advDecision.submitted, false, `adversarial bid must not submit (decision: ${JSON.stringify(advDecision)})`);
    assert.ok(advDecision.ledgerError, `expected ledger error on adversarial bid (decision: ${JSON.stringify(advDecision)})`);

    const bidsAfterRes = await fetch(`${PORTAL_API}/financier/my-bids`);
    const bidsAfter = ((await bidsAfterRes.json()) as { bids: Array<{ requestId: string }> }).bids;
    const countAfter = bidsAfter.filter((b) => b.requestId === advRequestId).length;
    assert.equal(countAfter, countBefore, "no new bid after adversarial rejection");
    console.log("   adversarial rejection confirmed ✓");

    console.log("6. Regression — financier B cannot see financier A bids...");
    // After the agent bid was submitted in step 4, Daml archived the original
    // FinancingRequest and created a new one with updated activeBids.  The
    // original requestCid is now archived, so getBidsForRequestContract would
    // return [].  Re-fetch the current active contract ID from the supplier
    // indexer before querying bids.
    const currentRoundsRes = await fetch(`${SUPPLIER_INDEXER}/supplier/financing-rounds`);
    const currentRoundsBody = (await currentRoundsRes.json()) as {
      rounds: Array<{ contractId: string; requestId: string }>;
    };
    const currentRound = currentRoundsBody.rounds.find((r) => r.requestId === requestId);
    const currentRequestCid = currentRound?.contractId ?? requestCid;
    console.log(
      `   current requestCid for round ${requestId}: ${currentRequestCid} (original: ${requestCid})`
    );

    const supplierBidsRes = await fetch(
      `${SUPPLIER_INDEXER}/supplier/bids/${encodeURIComponent(currentRequestCid)}`
    );
    const supplierBids = (await supplierBidsRes.json()) as { bids: unknown[] };
    console.log(`   supplier bids count: ${supplierBids.bids?.length ?? "undefined"}`);
    assert.ok(Array.isArray(supplierBids.bids) && supplierBids.bids.length >= 1);
    const finBBidsRes = await fetch(`${FINANCIER_INDEXER_B}/financier/my-bids`);
    const finBBids = (await finBBidsRes.json()) as { bids: Array<{ requestId: string }> };
    assert.ok(
      !finBBids.bids.some((b) => b.requestId === requestId),
      "financier B must not see financier A sealed bid"
    );
    console.log("   sealed bid privacy regression ✓");

    console.log("\nPhase 6 stack E2E: all checks passed.");
  } finally {
    stopChildren();
  }
}

main().catch((err) => {
  console.error(err);
  stopChildren();
  process.exit(1);
});
