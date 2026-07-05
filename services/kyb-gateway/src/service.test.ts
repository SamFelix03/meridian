import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KybAuditStore, KybGatewayService } from "./service.js";

describe("KybGatewayService", () => {
  let dir: string;
  let service: KybGatewayService;
  let store: KybAuditStore;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "kyb-test-"));
    store = new KybAuditStore(join(dir, "audit.db"));
    service = new KybGatewayService(store);
  });

  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates PENDING verification for valid requests", () => {
    const res = service.verify({
      legalEntityId: "acme-corp",
      jurisdiction: "US",
      requestedRoles: ["Supplier"],
    });
    assert.equal(res.status, "PENDING");
    assert.ok(res.verificationId);
    assert.equal(service.validateVerificationId(res.verificationId), false);
  });

  it("rejects blocked legal entities immediately", () => {
    const res = service.verify({
      legalEntityId: "BLOCKED-ACME",
      jurisdiction: "US",
      requestedRoles: ["Supplier"],
    });
    assert.equal(res.status, "REJECTED");
    assert.equal(service.validateVerificationId(res.verificationId), false);
  });

  it("approves only after explicit completion", () => {
    const res = service.verify({
      legalEntityId: "widget-inc",
      jurisdiction: "US",
      requestedRoles: ["Buyer"],
    });
    const completed = service.complete(res.verificationId, "APPROVED");
    assert.equal(completed.status, "APPROVED");
    assert.ok(service.validateVerificationId(res.verificationId));
  });

  it("rejects unknown verification IDs", () => {
    assert.equal(service.validateVerificationId("nonexistent"), false);
  });
});
