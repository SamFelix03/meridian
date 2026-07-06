/**
 * Pause all open financing rounds so the agent has nothing to bid on,
 * then verify the financier invitation list is cleared of active rounds.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildPauseRoundCommand,
  resolveFinancingRequestTemplateId,
  type JsonLedgerClient,
} from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");
const FINANCIER_INDEXER = process.env.FINANCIER_INDEXER_URL ?? "http://127.0.0.1:4013";
const PORTAL_API = process.env.PORTAL_API_URL ?? "http://127.0.0.1:4000";

loadDotenv({ path: join(ROOT, ".env") });

type Invitation = {
  contractId: string;
  requestId: string;
  supplier: string;
  roundState: string;
};

const ACTIVE_STATES = new Set(["RoundOpen", "StaticReferenceFallback"]);

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function pauseRound(
  client: JsonLedgerClient,
  supplier: string,
  financier: string,
  inv: Invitation
): Promise<boolean> {
  try {
    const requestTemplateId = await resolveFinancingRequestTemplateId(
      client,
      [supplier, financier],
      inv.contractId
    );
    await client.submitAndWaitForTransaction({
      actAs: [supplier],
      commands: [buildPauseRoundCommand(inv.contractId, requestTemplateId)],
    });
    console.log(`   paused ${inv.requestId}`);
    return true;
  } catch (err) {
    console.warn(`   skip ${inv.requestId}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function main(): Promise<void> {
  if (!process.env.DEVNET_CLIENT_SECRET) {
    console.error("DEVNET_CLIENT_SECRET required");
    process.exit(1);
  }

  console.log("=== clear-agent-rounds ===\n");

  let invitations: Invitation[];
  try {
    const data = await fetchJson<{ invitations: Invitation[] }>(
      `${FINANCIER_INDEXER}/financier/invitations`
    );
    invitations = data.invitations ?? [];
  } catch (err) {
    console.error(`Financier indexer unreachable (${FINANCIER_INDEXER}). Start: pnpm indexer:financier-a`);
    throw err;
  }

  const active = invitations.filter((i) => ACTIVE_STATES.has(i.roundState));
  console.log(`Found ${invitations.length} invitation(s), ${active.length} active (RoundOpen / StaticReferenceFallback)\n`);

  if (active.length === 0) {
    console.log("No active rounds to pause.");
  } else {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
    const supplier = manifest.personas.find((p) => p.orgId === "meridian-supplier")?.partyId;
    const financier = manifest.personas.find((p) => p.orgId === "meridian-financier-a")?.partyId;
    if (!supplier || !financier) throw new Error("parties missing from manifest");

    const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
    const client = await auth.createAuthenticatedLedgerClient();

    let paused = 0;
    for (const inv of active) {
      if (await pauseRound(client, supplier, financier, inv)) paused++;
    }
    console.log(`\nPaused ${paused}/${active.length} round(s). Waiting for indexer…`);
    await new Promise((r) => setTimeout(r, 8000));

    const after = await fetchJson<{ invitations: Invitation[] }>(
      `${FINANCIER_INDEXER}/financier/invitations`
    );
    const stillActive = (after.invitations ?? []).filter((i) => ACTIVE_STATES.has(i.roundState));
    console.log(`Active rounds remaining: ${stillActive.length}`);
  }

  try {
    await fetch(`${PORTAL_API}/financier/agent/tick`, { method: "OPTIONS", signal: AbortSignal.timeout(3000) });
  } catch {
    /* portal-api optional for this script */
  }

  console.log("\nDone. Restart agent-runtime to clear the Agent bidding tick table.");
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exit(1);
});
