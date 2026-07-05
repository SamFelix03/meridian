import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { KybVerifyRequest, KybVerifyResponse, KybStatus } from "@meridian/shared-types";

export interface AuditRecord {
  id: string;
  legalEntityId: string;
  jurisdiction: string;
  requestedRoles: string;
  status: string;
  verificationId: string;
  verifiedAt: string | null;
  reason: string | null;
  createdAt: string;
}

const AML_BLOCKED = new Set(["SANCTIONED-ENTITY", "BLOCKED-ACME"]);

export class KybAuditStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kyb_audit (
        id TEXT PRIMARY KEY,
        legal_entity_id TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        requested_roles TEXT NOT NULL,
        status TEXT NOT NULL,
        verification_id TEXT NOT NULL UNIQUE,
        verified_at TEXT,
        reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_verification_id ON kyb_audit(verification_id);
    `);
  }

  insert(record: AuditRecord): void {
    this.db
      .prepare(
        `INSERT INTO kyb_audit
         (id, legal_entity_id, jurisdiction, requested_roles, status, verification_id, verified_at, reason, created_at)
         VALUES (@id, @legalEntityId, @jurisdiction, @requestedRoles, @status, @verificationId, @verifiedAt, @reason, @createdAt)`
      )
      .run(record);
  }

  updateStatus(verificationId: string, status: KybStatus, verifiedAt: string | null, reason: string | null): void {
    this.db
      .prepare(
        `UPDATE kyb_audit SET status = ?, verified_at = ?, reason = ? WHERE verification_id = ?`
      )
      .run(status, verifiedAt, reason, verificationId);
  }

  getByVerificationId(verificationId: string): AuditRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM kyb_audit WHERE verification_id = ?`)
      .get(verificationId) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return {
      id: row.id!,
      legalEntityId: row.legal_entity_id!,
      jurisdiction: row.jurisdiction!,
      requestedRoles: row.requested_roles!,
      status: row.status!,
      verificationId: row.verification_id!,
      verifiedAt: row.verified_at,
      reason: row.reason,
      createdAt: row.created_at!,
    };
  }

  close(): void {
    this.db.close();
  }
}

export type KybDecision = "APPROVED" | "REJECTED";

export class KybGatewayService {
  constructor(private store: KybAuditStore) {}

  private validateRequest(request: KybVerifyRequest): string | null {
    if (!request.jurisdiction.trim()) {
      return "jurisdiction is required";
    }
    if (request.legalEntityId.startsWith("BLOCKED-")) {
      return "legal entity blocked by policy";
    }
    if (AML_BLOCKED.has(request.legalEntityId)) {
      return "entity on AML sanctions list";
    }
    if (
      request.requestedRoles.includes("Regulator") &&
      !request.complianceProfile?.trim()
    ) {
      return "Regulator role requires complianceProfile";
    }
    return null;
  }

  verify(request: KybVerifyRequest): KybVerifyResponse {
    const verificationId = randomUUID();
    const now = new Date().toISOString();
    const rejectReason = this.validateRequest(request);

    if (rejectReason) {
      const response: KybVerifyResponse = {
        status: "REJECTED",
        verificationId,
        verifiedAt: now,
        reason: rejectReason,
      };
      this.store.insert({
        id: randomUUID(),
        legalEntityId: request.legalEntityId,
        jurisdiction: request.jurisdiction,
        requestedRoles: JSON.stringify(request.requestedRoles),
        status: response.status,
        verificationId,
        verifiedAt: now,
        reason: rejectReason,
        createdAt: now,
      });
      return response;
    }

    const response: KybVerifyResponse = {
      status: "PENDING",
      verificationId,
    };

    this.store.insert({
      id: randomUUID(),
      legalEntityId: request.legalEntityId,
      jurisdiction: request.jurisdiction,
      requestedRoles: JSON.stringify(request.requestedRoles),
      status: response.status,
      verificationId,
      verifiedAt: null,
      reason: null,
      createdAt: now,
    });

    return response;
  }

  complete(verificationId: string, decision: KybDecision, reason?: string): KybVerifyResponse {
    const record = this.store.getByVerificationId(verificationId);
    if (!record) {
      throw new KybGatewayError("NOT_FOUND", `verification ${verificationId} not found`);
    }
    if (record.status !== "PENDING") {
      throw new KybGatewayError(
        "INVALID_STATE",
        `verification ${verificationId} is ${record.status}, expected PENDING`
      );
    }
    const now = new Date().toISOString();
    const status: KybStatus = decision;
    this.store.updateStatus(verificationId, status, now, reason ?? null);
    return {
      status,
      verificationId,
      verifiedAt: now,
      reason: reason ?? undefined,
    };
  }

  getStatus(verificationId: string): KybVerifyResponse | null {
    const record = this.store.getByVerificationId(verificationId);
    if (!record) return null;
    return {
      status: record.status as KybStatus,
      verificationId: record.verificationId,
      verifiedAt: record.verifiedAt ?? undefined,
      reason: record.reason ?? undefined,
    };
  }

  validateVerificationId(verificationId: string): boolean {
    const record = this.store.getByVerificationId(verificationId);
    return record?.status === "APPROVED";
  }
}

export class KybGatewayError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "KybGatewayError";
  }
}

export function createDefaultService(dataDir: string): KybGatewayService {
  const dbPath = join(dataDir, "kyb-audit.db");
  return new KybGatewayService(new KybAuditStore(dbPath));
}
