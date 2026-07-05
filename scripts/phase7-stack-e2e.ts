/**
 * Phase 7 full stack E2E: ops console, regulator indexer, settlement audit, KYB gate.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import { DevNetAuthClient } from "@meridian/devnet-auth";
import {
  buildCreateFinancingFactoryCommand,
  buildOpenFinancingRoundCommand,
  buildPostForBidCommand,
  buildSubmitBidCommand,
  extractCreatedContractId,
  oracleAnchoredMode,
  TEMPLATE_IDS,
} from "@meridian/ledger-client";
import { awardWithDvP, loadCashManifest } from "./cash-devnet-helpers.js";

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
const REGULATOR_INDEXER = process.env.REGULATOR_INDEXER_URL ?? "http://127.0.0.1:4015";
const PLATFORM_INDEXER = process.env.PLATFORM_INDEXER_URL ?? "http://127.0.0.1:4016";
const NOTIFICATIONS = process.env.NOTIFICATIONS_URL ?? "http://127.0.0.1:4020";
const ORACLE_RELAY = process.env.ORACLE_RELAY_URL ?? "http://127.0.0.1:4021";
const KYB_GATEWAY = process.env.KYB_GATEWAY_URL ?? "http://127.0.0.1:8090";
const PARTY_PROVISIONER = process.env.PARTY_PROVISIONER_URL ?? "http://127.0.0.1:8091";

const SOFR_FEED_ID_ASCII = [83, 79, 70, 82];
const PRICING_BAND_MIN = "0.01";
const PRICING_BAND_MAX = "0.15";
const ADVANCE = "1500.0";

const children: ChildProcess[] = [];

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
  children.push(child);
  return child;
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
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

async function startStack(): Promise<void> {
  console.log("Starting Phase 7 stack services...");
  const kybData = join(ROOT, ".data/stack-kyb");
  const provData = join(ROOT, ".data/stack-prov");
  mkdirSync(kybData, { recursive: true });
  mkdirSync(provData, { recursive: true });

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
  spawnService(
    "indexer-regulator",
    join(ROOT, "services/indexer"),
    ["dist/cli.js", "../../infra/configs/indexer-regulator.yaml", "--rebuild", "--serve"],
    { MERIDIAN_INDEXER_POLL_MS: "2000" }
  );
  spawnService(
    "indexer-platform",
    join(ROOT, "services/indexer"),
    ["dist/cli.js", "../../infra/configs/indexer-platform.yaml", "--rebuild", "--serve"],
    { MERIDIAN_INDEXER_POLL_MS: "2000" }
  );
  spawnService("oracle-relay", join(ROOT, "services/oracle-relay"), ["dist/cli.js"], {
    ORACLE_RELAY_PORT: "4021",
  });
  spawnService("notifications", join(ROOT, "services/notifications"), ["dist/cli.js"], {
    NOTIFICATIONS_PORT: "4020",
  });
  spawnService("kyb-gateway", join(ROOT, "services/kyb-gateway"), ["dist/index.js"], {
    KYB_GATEWAY_PORT: "8090",
    KYB_DATA_DIR: kybData,
  });
  spawnService("party-provisioner", join(ROOT, "services/party-provisioner"), ["dist/index.js"], {
    PROVISIONER_PORT: "8091",
    PROVISIONER_DATA_DIR: provData,
    KYB_GATEWAY_URL: KYB_GATEWAY,
  });
  spawnService("portal-api", join(ROOT, "services/portal-api"), ["dist/index.js"], {
    ORACLE_RELAY_URL: ORACLE_RELAY,
    FINANCIER_INDEXER_URL: FINANCIER_INDEXER_A,
    REGULATOR_INDEXER_URL: REGULATOR_INDEXER,
    PLATFORM_INDEXER_URL: PLATFORM_INDEXER,
    KYB_GATEWAY_URL: KYB_GATEWAY,
    PARTY_PROVISIONER_URL: PARTY_PROVISIONER,
  });

  await Promise.all([
    waitForHealth(`${SUPPLIER_INDEXER}/health`),
    waitForHealth(`${BUYER_INDEXER}/health`),
    waitForHealth(`${FINANCIER_INDEXER_A}/health`),
    waitForHealth(`${FINANCIER_INDEXER_B}/health`),
    waitForHealth(`${REGULATOR_INDEXER}/health`),
    waitForHealth(`${PLATFORM_INDEXER}/health`),
    waitForHealth(`${ORACLE_RELAY}/health`),
    waitForHealth(`${NOTIFICATIONS}/`),
    waitForHealth(`${KYB_GATEWAY}/health`),
    waitForHealth(`${PARTY_PROVISIONER}/health`),
    waitForHealth(`${PORTAL_API}/health`),
  ]);
  console.log("All services healthy.");
}

async function issueReceivableViaPortal(ts: number): Promise<string> {
  const proposalId = `P7-STACK-${ts}`;
  const proposeRes = await fetch(`${PORTAL_API}/invoices/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proposalId,
      faceValue: "3200",
      currency: "USD",
      dueDate: "2026-12-31",
      consentGranted: true,
      lineItems: [{ description: "Phase 7 stack item", quantity: "1", unitPrice: "3200" }],
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
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jurisdiction: "US" }),
    }
  );
  const cosignText = await cosignRes.text();
  assert.equal(cosignRes.status, 200, cosignText);
  const receivableContractId = (JSON.parse(cosignText) as { receivableContractId: string })
    .receivableContractId;
  assert.ok(receivableContractId);
  return receivableContractId;
}

async function fundReceivableOnLedger(
  receivableCid: string,
  requestId: string,
  oracle: OracleSnapshot
): Promise<string> {
  const supplier = partyId("meridian-supplier");
  const financierA = partyId("meridian-financier-a");
  const auth = DevNetAuthClient.fromEnv();
  const client = await auth.createAuthenticatedLedgerClient();
  const ledgerTime = millisToLedgerTime(oracle.packageTimestampMs);
  const cash = loadCashManifest(ROOT);

  const postResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [buildPostForBidCommand(receivableCid)],
  });
  const postedCid = extractCreatedContractId(postResult, "Receivable");
  assert.ok(postedCid);

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
  const requestCid = extractCreatedContractId(roundResult, "FinancingRequest");
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
  const bid = bids.find(
    (b) => String((b.payload as Record<string, unknown>).requestId) === requestId
  );
  assert.ok(bid);

  const updatedRequests = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.financingRequest
  );
  const updatedRequest = updatedRequests.find(
    (r) => String((r.payload as Record<string, unknown>).requestId) === requestId
  );
  assert.ok(updatedRequest);

  const supplierBidsPreAward = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.bid
  );
  assert.ok(
    supplierBidsPreAward.some(
      (b) => String((b.payload as Record<string, unknown>).requestId) === requestId
    ),
    "supplier must see bids before award"
  );

  const { fundedReceivableCid } = await awardWithDvP(client, cash, {
    supplier,
    financier: financierA,
    requestCid: updatedRequest.contractId,
    bidCid: bid.contractId,
    advanceAmount: ADVANCE,
  });
  return fundedReceivableCid;
}

async function main(): Promise<void> {
  if (!process.env.DEVNET_CLIENT_SECRET) {
    console.error("DEVNET_CLIENT_SECRET required");
    process.exit(1);
  }
  if (!existsSync(MANIFEST)) {
    console.error("manifest missing");
    process.exit(1);
  }
  if (!existsSync(join(ROOT, "infra/manifests/cash.devnet.json"))) {
    console.error("cash manifest missing — run: pnpm bootstrap:cash:devnet");
    process.exit(1);
  }

  const oracle = oraclePreflight();
  const ts = Date.now();

  process.on("SIGINT", () => {
    stopChildren();
    process.exit(130);
  });

  try {
    await grantDevNetRights();
    await startStack();

    console.log("1. Issue receivable via portal (jurisdiction US)...");
    const receivableCid = await issueReceivableViaPortal(ts);

    console.log("2. Fund receivable on-ledger (creates settlement audit)...");
    const requestId = `P7-STACK-ROUND-${ts}`;
    const fundedReceivableCid = await fundReceivableOnLedger(receivableCid, requestId, oracle);
    console.log(`   funded ${fundedReceivableCid.slice(0, 24)}… ✓`);

    console.log("3. Ops API — settlement finality shows atomic >= 1...");
    await pollUntil(
      "settlement finality",
      async () => {
        const res = await fetch(`${PORTAL_API}/ops/settlement-finality`);
        const body = (await res.json()) as {
          summary?: { atomic?: number; total?: number };
        };
        return body.summary ?? { atomic: 0, total: 0 };
      },
      (summary) => (summary.atomic ?? 0) >= 1
    );
    const settleRes = await fetch(`${PORTAL_API}/ops/settlement-finality`);
    const settleBody = (await settleRes.json()) as {
      summary: Record<string, number>;
      audits: Array<Record<string, unknown>>;
    };
    assert.equal(settleBody.audits[0]?.discountRate, undefined);
    assert.equal(settleBody.audits[0]?.advanceAmount, undefined);
    console.log("   settlement monitor OK ✓");

    console.log("4. Ops API — oracle health fresh...");
    const oracleRes = await fetch(`${PORTAL_API}/ops/oracle-health`);
    const oracleBody = (await oracleRes.json()) as { ok?: boolean; isFresh?: boolean };
    assert.equal(oracleRes.status, 200);
    assert.equal(oracleBody.ok, true);
    assert.equal(oracleBody.isFresh, true);
    console.log("   oracle health OK ✓");

    console.log("5. Ops API — regulator grant + observer...");
    const grantRes = await fetch(`${PORTAL_API}/ops/regulator-grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId: `GRANT-P7-STACK-${ts}`, jurisdiction: "US" }),
    });
    assert.equal(grantRes.status, 201, await grantRes.text());

    const observerRes = await fetch(
      `${PORTAL_API}/ops/receivables/${encodeURIComponent(fundedReceivableCid)}/grant-observer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jurisdiction: "US" }),
      }
    );
    assert.equal(observerRes.status, 200, await observerRes.text());
    console.log("   grants + observer OK ✓");

    console.log("6. Regulator indexer — exposure rollup...");
    await pollUntil(
      "regulator exposure",
      async () => {
        const res = await fetch(`${PORTAL_API}/regulator/exposure?jurisdiction=US`);
        const body = (await res.json()) as {
          rollups: Array<{ jurisdiction: string; totalExposure: string }>;
        };
        return body.rollups ?? [];
      },
      (rollups) => rollups.some((r) => r.jurisdiction === "US" && Number(r.totalExposure) > 0)
    );
    const exposureRes = await fetch(`${PORTAL_API}/regulator/exposure?jurisdiction=US`);
    const exposureBody = (await exposureRes.json()) as {
      rows: Array<Record<string, unknown>>;
    };
    for (const row of exposureBody.rows) {
      assert.equal(row.discountRate, undefined);
      assert.equal(row.lineItems, undefined);
    }
    console.log("   regulator exposure OK ✓");

    console.log("7. KYB gate via portal-api...");
    const badAlloc = await fetch(`${PORTAL_API}/parties/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: `org-p7-bad-${ts}`,
        legalEntityId: "LE-P7-BAD",
        partyHint: `p7-bad-${ts}`,
        role: "Supplier",
        jurisdiction: "US",
        verificationId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    assert.notEqual(badAlloc.status, 200);

    const verifyRes = await fetch(`${PORTAL_API}/kyb/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalEntityId: "LE-P7-STACK",
        jurisdiction: "US",
        requestedRoles: ["Supplier"],
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = (await verifyRes.json()) as { verificationId: string; status: string };
    assert.equal(verifyBody.status, "PENDING");

    const pendingAlloc = await fetch(`${PORTAL_API}/parties/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: `org-p7-pending-${ts}`,
        legalEntityId: "LE-P7-STACK",
        partyHint: `p7-pending-${ts}`,
        role: "Supplier",
        jurisdiction: "US",
        verificationId: verifyBody.verificationId,
      }),
    });
    assert.notEqual(pendingAlloc.status, 200);

    const completeRes = await fetch(
      `${PORTAL_API}/kyb/verify/${encodeURIComponent(verifyBody.verificationId)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      }
    );
    assert.equal(completeRes.status, 200);

    const okAlloc = await fetch(`${PORTAL_API}/parties/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: `org-p7-ok-${ts}`,
        legalEntityId: "LE-P7-STACK",
        partyHint: `p7-ok-${ts}`,
        role: "Supplier",
        jurisdiction: "US",
        verificationId: verifyBody.verificationId,
      }),
    });
    assert.equal(okAlloc.status, 200, await okAlloc.text());
    console.log("   KYB gate OK ✓");

    console.log("8. Regression — sealed bid privacy + ops no pricing...");
    const auth = DevNetAuthClient.fromEnv();
    const ledger = await auth.createAuthenticatedLedgerClient();
    const financierB = partyId("meridian-financier-b");

    const bBids = await ledger.getActiveContractsByTemplate(financierB, TEMPLATE_IDS.bid);
    assert.equal(
      bBids.some((b) => String((b.payload as Record<string, unknown>).requestId) === requestId),
      false,
      "financier B must not see A's sealed bid"
    );

    const opsSettle = await fetch(`${PORTAL_API}/ops/settlement-finality`);
    const opsText = await opsSettle.text();
    assert.ok(!opsText.includes("discountRate"));
    assert.ok(!opsText.includes("advanceAmount"));
    console.log("   regression OK ✓");

    console.log("\nPhase 7 stack E2E passed.");
  } finally {
    stopChildren();
  }
}

main().catch((err) => {
  console.error(err);
  stopChildren();
  process.exit(1);
});
