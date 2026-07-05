import type { BiddingMandateSummary } from "@meridian/shared-types";

export function isBiddingMandateTemplate(templateId: string): boolean {
  return templateId.includes("BiddingMandate:BiddingMandate");
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function parsePartyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => str(p));
}

export function projectBiddingMandate(
  contractId: string,
  payload: Record<string, unknown>
): BiddingMandateSummary {
  return {
    contractId,
    mandateId: str(payload.mandateId),
    financier: str(payload.financier),
    maxExposure: str(payload.maxExposure),
    minSpread: str(payload.minSpread),
    eligibleSuppliers: parsePartyList(payload.eligibleSuppliers),
    agentEnabled: Boolean(payload.agentEnabled),
    revoked: Boolean(payload.revoked),
  };
}
