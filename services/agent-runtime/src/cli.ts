import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient } from "@meridian/devnet-auth";
import { AgentLoop } from "./agent-loop.js";
import { startAgentHttpServer } from "./http-server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");

loadDotenv({ path: join(ROOT, ".env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function resolveFinancierPartyId(): string {
  const orgId = process.env.FINANCIER_PARTY_ORG_ID ?? "meridian-financier-a";
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const persona = manifest.personas.find((p) => p.orgId === orgId);
  if (!persona?.partyId) {
    throw new Error(`financier party missing in manifest: ${orgId}`);
  }
  return persona.partyId;
}

async function main(): Promise<void> {
  const groqApiKey = requireEnv("GROQ_API_KEY");
  const port = Number(process.env.AGENT_RUNTIME_PORT ?? 4025);
  const pollMs = Number(process.env.AGENT_POLL_MS ?? 0);
  const financierIndexerUrl =
    process.env.FINANCIER_INDEXER_URL ?? "http://127.0.0.1:4013";
  const supplierIndexerUrl =
    process.env.SUPPLIER_INDEXER_URL ?? "http://127.0.0.1:4011";
  const oracleRelayUrl = process.env.ORACLE_RELAY_URL ?? "http://127.0.0.1:4021";
  const groqModel = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  const adversarialMode = process.env.AGENT_ADVERSARIAL === "1";

  const auth = DevNetAuthClient.fromEnv();
  const loop = new AgentLoop({
    financierPartyId: resolveFinancierPartyId(),
    financierIndexerUrl,
    supplierIndexerUrl,
    oracleRelayUrl,
    groqApiKey,
    groqModel,
    adversarialMode,
  });

  const getClient = async () => auth.createAuthenticatedLedgerClient();

  startAgentHttpServer({ port, loop, getClient });

  if (pollMs > 0) {
    const poll = async () => {
      try {
        const client = await getClient();
        await loop.runTick(client);
      } catch (err) {
        console.error("agent poll tick failed:", err);
      }
    };
    setInterval(() => {
      void poll();
    }, pollMs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
