import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import { SeaportTopologyClient } from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

loadDotenv({ path: join(ROOT, ".env") });

const DAR_DIRS = [
  join(ROOT, "daml/vendor/redstone/dist"),
  join(ROOT, "daml/vendor/splice/dist"),
  join(ROOT, "daml/packages/meridian-cash/.daml/dist"),
  join(ROOT, "daml/packages/meridian-core/.daml/dist"),
];

const REQUIRED_DARS = [
  join(ROOT, "daml/packages/meridian-receivable/.daml/dist/com-meridian-receivable-v6-0.1.0.dar"),
  join(ROOT, "daml/packages/meridian-cash/.daml/dist/com-meridian-cash-0.1.0.dar"),
];

// Skip old pre-v2 naming and old v2/v3 naming that has already been replaced
const SKIP_DAR_PATTERNS = [
  /com-meridian-receivable-0\.[12]\.0\.dar$/,
  /com-meridian-receivable-v2-/,
  /com-meridian-receivable-v3-/,
  /com-meridian-receivable-v4-/,
  /com-meridian-receivable-v5-/,
];

function collectDars(): string[] {
  const paths = new Set<string>();

  for (const darPath of REQUIRED_DARS) {
    if (existsSync(darPath)) paths.add(darPath);
  }

  for (const dir of DAR_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".dar")) continue;
      if (SKIP_DAR_PATTERNS.some((re) => re.test(file))) continue;
      paths.add(join(dir, file));
    }
  }

  return [...paths].sort();
}

async function main(): Promise<void> {
  const explicit = process.argv.slice(2);
  const darPaths = explicit.length > 0 ? explicit : collectDars();

  if (darPaths.length === 0) {
    console.error("No DAR files found. Run: make build-daml");
    console.error("RedStone DARs: bash infra/scripts/build-redstone-dars.sh (via WSL on Windows)");
    process.exit(1);
  }

  const missingRequired = REQUIRED_DARS.filter((p) => !existsSync(p));
  if (missingRequired.length > 0 && explicit.length === 0) {
    console.warn("Warning: expected receivable DAR missing (build meridian-receivable first):");
    for (const p of missingRequired) console.warn(`  ${p}`);
  }

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();
  const topology = SeaportTopologyClient.create(client);

  for (const darPath of darPaths) {
    if (!existsSync(darPath)) {
      console.error(`DAR not found: ${darPath}`);
      process.exit(1);
    }
    console.log(`Uploading DAR to Seaport DevNet: ${darPath}`);
    await topology.uploadDarFromFile(darPath);
  }

  const packages = await topology.listPackages();
  console.log(`Packages on ledger: ${packages.length}`);
  console.log("DAR upload complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
