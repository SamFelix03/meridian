/**
 * Verify SetAgentEnabled on a v5 mandate uses the mandate's own package template id
 * (not v6 default — avoids INTERPRETATION_UPGRADE_ERROR).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildSetMandateAgentEnabledCommand,
  extractCreatedContractId,
  packageIdFromTemplateId,
  resolveBiddingMandateTemplateId,
  resolveMandateTemplateMap,
} from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const FINANCIER_INDEXER = process.env.FINANCIER_INDEXER_URL ?? "http://127.0.0.1:4013";
const V5_PACKAGE_HASH = "bdafdb3a3f6d73b85040b46de818b55a05ca49c1bbe469b3a1f2a277b41c05de";

loadDotenv({ path: join(ROOT, ".env") });

function party(manifest: DevNetPartiesManifest, orgId: string): string {
  const p = manifest.personas.find((x) => x.orgId === orgId);
  if (!p?.partyId) throw new Error(`party missing: ${orgId}`);
  return p.partyId;
}

async function main(): Promise<void> {
  console.log("=== test-mandate-set-agent-enabled ===\n");
  if (!process.env.DEVNET_CLIENT_SECRET) {
    console.error("DEVNET_CLIENT_SECRET required");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const financierA = party(manifest, "meridian-financier-a");

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();

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
  const templateMap = await resolveMandateTemplateMap(
    client,
    financierA,
    active.map((m) => m.contractId)
  );

  const v5Mandate = active.find((m) => {
    const tid = templateMap.get(m.contractId);
    return tid != null && packageIdFromTemplateId(tid).startsWith(V5_PACKAGE_HASH.slice(0, 8));
  });
  assert.ok(v5Mandate, "need at least one v5 mandate on DevNet");

  const mandateTemplateId = await resolveBiddingMandateTemplateId(
    client,
    [financierA],
    v5Mandate.contractId
  );
  const pkg = packageIdFromTemplateId(mandateTemplateId);
  console.log(`mandate=${v5Mandate.mandateId} pkg=${pkg.slice(0, 16)}… agent=${v5Mandate.agentEnabled}`);

  assert.ok(
    pkg.startsWith(V5_PACKAGE_HASH.slice(0, 8)),
    "resolved template must be v5 package, not v6 default"
  );

  const targetEnabled = !v5Mandate.agentEnabled;
  console.log(`\nSetAgentEnabled → ${targetEnabled}…`);
  const disableResult = await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildSetMandateAgentEnabledCommand({
        mandateContractId: v5Mandate.contractId,
        mandateTemplateId,
        enabled: targetEnabled,
      }),
    ],
  });
  const newMandateCid =
    extractCreatedContractId(disableResult, "BiddingMandate") ?? v5Mandate.contractId;
  console.log(`✓ succeeded (new cid=${newMandateCid.slice(0, 24)}…)`);

  const newTemplateId = await resolveBiddingMandateTemplateId(client, [financierA], newMandateCid);
  console.log(`\nRestore agentEnabled → ${v5Mandate.agentEnabled}…`);
  await client.submitAndWaitForTransaction({
    actAs: [financierA],
    commands: [
      buildSetMandateAgentEnabledCommand({
        mandateContractId: newMandateCid,
        mandateTemplateId: newTemplateId,
        enabled: v5Mandate.agentEnabled,
      }),
    ],
  });
  console.log("✓ restored");

  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exit(1);
});
