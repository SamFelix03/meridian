import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PartyProvisionerService,
  ProvisionerAuditStore,
  ProvisionerError,
} from "./service.js";

describe("PartyProvisionerService", () => {
  let dir: string;
  let service: PartyProvisionerService;
  let store: ProvisionerAuditStore;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "prov-test-"));
    store = new ProvisionerAuditStore(join(dir, "audit.db"));
    service = new PartyProvisionerService(
      store,
      {
        async validateVerificationId(id) {
          return id === "valid-kyb-id";
        },
      },
      {
        async allocateParty({ partyHint, displayName }) {
          return {
            partyId: `${partyHint}::abc123`,
            topologyTxId: `tx-${partyHint}`,
          };
        },
      }
    );
  });

  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects allocation without verificationId", async () => {
    await assert.rejects(
      () =>
        service.allocate({
          orgId: "org1",
          legalEntityId: "le1",
          partyHint: "meridian-supplier-1",
          role: "Supplier",
          jurisdiction: "US",
          verificationId: "",
        }),
      (err: Error) => err instanceof ProvisionerError && err.code === "MISSING_VERIFICATION"
    );
  });

  it("rejects allocation with pending KYB verification", async () => {
    await assert.rejects(
      () =>
        service.allocate({
          orgId: "org1",
          legalEntityId: "le1",
          partyHint: "meridian-supplier-1",
          role: "Supplier",
          jurisdiction: "US",
          verificationId: "pending-kyb-id",
        }),
      (err: Error) => err instanceof ProvisionerError && err.code === "KYB_NOT_APPROVED"
    );
  });

  it("rejects allocation with invalid KYB verification", async () => {
    await assert.rejects(
      () =>
        service.allocate({
          orgId: "org1",
          legalEntityId: "le1",
          partyHint: "meridian-supplier-1",
          role: "Supplier",
          jurisdiction: "US",
          verificationId: "invalid",
        }),
      (err: Error) => err instanceof ProvisionerError && err.code === "KYB_NOT_APPROVED"
    );
  });

  it("allocates party when KYB is approved", async () => {
    const record = await service.allocate({
      orgId: "acme-supplier",
      legalEntityId: "le1",
      partyHint: "meridian-supplier-1",
      role: "Supplier",
      jurisdiction: "US",
      verificationId: "valid-kyb-id",
      displayName: "Meridian Supplier",
    });
    assert.equal(record.partyId, "meridian-supplier-1::abc123");
    assert.equal(record.participantId, "seaport-devnet");
    assert.equal(record.verificationId, "valid-kyb-id");
  });
});
