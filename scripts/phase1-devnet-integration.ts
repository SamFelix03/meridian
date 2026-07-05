/** Phase 1 live Seaport visibility-matrix integration tests. */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import assert from "node:assert/strict";
import type { DevNetPartiesManifest } from "@meridian/shared-types";
import { DevNetAuthClient, loadDevNetConfigFromEnv } from "@meridian/devnet-auth";
import {
  buildCoSignAndIssueCommand,
  buildCreateReceivableProposalCommand,
  INTERFACE_IDS,
  TEMPLATE_IDS,
} from "@meridian/ledger-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFEST = join(ROOT, "infra/manifests/parties.devnet.json");

loadDotenv({ path: join(ROOT, ".env") });

function party(manifest: DevNetPartiesManifest, orgId: string): string {
  const p = manifest.personas.find((x) => x.orgId === orgId);
  if (!p?.partyId) throw new Error(`party missing: ${orgId}`);
  return p.partyId;
}

function extractCreatedContractId(result: {
  transaction?: { events?: unknown[] };
}): string | null {
  for (const ev of result.transaction?.events ?? []) {
    if (!ev || typeof ev !== "object") continue;
    const obj = ev as Record<string, unknown>;
    const created =
      (obj.CreatedEvent as Record<string, unknown> | undefined) ??
      (obj.createdEvent as Record<string, unknown> | undefined);
    if (created?.contractId) return String(created.contractId);
  }
  return null;
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

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as DevNetPartiesManifest;
  const supplier = party(manifest, "meridian-supplier");
  const buyer = party(manifest, "meridian-buyer");
  const financierA = party(manifest, "meridian-financier-a");
  const financierB = party(manifest, "meridian-financier-b");
  const platformOperator = party(manifest, "meridian-platform");

  const auth = new DevNetAuthClient(loadDevNetConfigFromEnv());
  const client = await auth.createAuthenticatedLedgerClient();

  const proposalId = `PHASE1-${Date.now()}`;
  console.log(`1. Proposing receivable ${proposalId}...`);

  const proposeResult = await client.submitAndWaitForTransaction({
    actAs: [supplier],
    commands: [
      buildCreateReceivableProposalCommand({
        proposalId,
        supplier,
        buyer,
        lineItems: [
          { description: "Integration test item", quantity: "1", unitPrice: "2500" },
        ],
        faceValue: "2500",
        currency: "USD",
        dueDate: "2026-12-31",
        consentSource: { tag: "InlineConsent", value: true },
      }),
    ],
  });

  const proposalCid = extractCreatedContractId(proposeResult);
  assert.ok(proposalCid, "proposal contract id missing");
  console.log(`   proposal cid: ${proposalCid}`);

  console.log("2. Buyer co-signing...");
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
  console.log(`   receivable cid: ${receivableCid}`);

  console.log("3. Visibility matrix — financier A (negative)...");
  const financierContracts = await client.getActiveContractsByTemplate(
    financierA,
    TEMPLATE_IDS.receivable
  );
  assert.equal(
    financierContracts.length,
    0,
    "financier A must not see Receivable pre-invitation"
  );
  console.log("   financier A ACS: empty ✓");

  console.log("4. Visibility matrix — financier B (negative)...");
  const financierBContracts = await client.getActiveContractsByTemplate(
    financierB,
    TEMPLATE_IDS.receivable
  );
  assert.equal(financierBContracts.length, 0, "financier B must not see Receivable");
  console.log("   financier B ACS: empty ✓");

  console.log("5. Visibility matrix — supplier (positive: line items)...");
  const supplierContracts = await client.getActiveContractsByTemplate(
    supplier,
    TEMPLATE_IDS.receivable
  );
  assert.ok(supplierContracts.length > 0, "supplier must see receivable");
  const supplierPayload = supplierContracts.find((c) => c.contractId === receivableCid)?.payload as
    | Record<string, unknown>
    | undefined;
  assert.ok(supplierPayload, "supplier receivable payload missing");
  const lineItems = supplierPayload.lineItems as unknown[] | undefined;
  assert.ok(Array.isArray(lineItems) && lineItems.length > 0, "supplier must see line items");
  assert.equal(String(supplierPayload.buyer), buyer, "supplier sees buyer identity");
  console.log("   supplier sees line items + buyer identity ✓");

  console.log("6. Visibility matrix — buyer IBuyerView (positive, limited)...");
  const buyerViews = await client.getActiveContractsByInterface(
    buyer,
    INTERFACE_IDS.buyerView
  );
  assert.ok(buyerViews.length > 0, "buyer must see IBuyerView");
  const buyerEntry = buyerViews.find((c) => c.contractId === receivableCid);
  assert.ok(buyerEntry, "buyer view for receivable missing");
  const view = buyerEntry.interfaceViews.find((v) =>
    v.interfaceId.includes("IBuyerView")
  )?.viewValue as Record<string, unknown> | undefined;
  assert.ok(view, "buyer interface view value missing");
  assert.ok(view.faceValue, "buyer sees face value");
  assert.ok(view.dueDate, "buyer sees due date");
  assert.ok(view.payee, "buyer sees payee");
  assert.ok(!("lineItems" in view), "buyer view must not include line items");
  assert.ok(!("buyer" in view), "buyer view must not expose buyer identity field");
  console.log("   buyer IBuyerView: payee/amount/dueDate only ✓");

  console.log("\nPhase 1 DevNet integration: ALL PASSED");
}

main().catch((err) => {
  console.error("\nPhase 1 DevNet integration FAILED:", err);
  process.exit(1);
});
