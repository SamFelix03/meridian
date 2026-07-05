import type { RegulatorJurisdictionGrantSummary } from "@meridian/shared-types";

export function isRegulatorJurisdictionGrantTemplate(templateId: string): boolean {
  return templateId.includes("RegulatorJurisdictionGrant:RegulatorJurisdictionGrant");
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function projectRegulatorJurisdictionGrant(
  contractId: string,
  payload: Record<string, unknown>
): RegulatorJurisdictionGrantSummary {
  return {
    contractId,
    grantId: str(payload.grantId),
    regulator: str(payload.regulator),
    jurisdiction: str(payload.jurisdiction),
    active: Boolean(payload.active),
  };
}
