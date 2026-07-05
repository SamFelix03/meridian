import type { SettlementAuditSummary, SettlementFinality } from "@meridian/shared-types";

export function isSettlementAuditRecordTemplate(templateId: string): boolean {
  return templateId.includes("SettlementAuditRecord:SettlementAuditRecord");
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function parseFinality(raw: unknown): SettlementFinality {
  const tag = str(raw);
  if (tag === "ReassignmentMediated") return "ReassignmentMediated";
  if (tag === "EscrowFallback") return "EscrowFallback";
  return "Atomic";
}

export function projectSettlementAuditRecord(
  contractId: string,
  payload: Record<string, unknown>
): SettlementAuditSummary {
  return {
    contractId,
    recordId: str(payload.recordId),
    receivableId: str(payload.receivableId),
    requestId: str(payload.requestId),
    finality: parseFinality(payload.finality),
    settledAt: str(payload.settledAt),
  };
}
