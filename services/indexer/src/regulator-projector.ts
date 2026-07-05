import type { RegulatorExposureRow } from "@meridian/shared-types";

const FUNDED_STATES = new Set([
  "Funded",
  "PartiallySyndicated",
  "Repaid",
  "Overdue",
]);

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "tag" in v) {
    return String((v as { tag: unknown }).tag);
  }
  return String(v);
}

function parseOptionalText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "tag" in raw) {
    const tagged = raw as { tag: string; value?: unknown };
    if (tagged.tag === "None") return null;
    if (tagged.tag === "Some") return str(tagged.value);
  }
  return str(raw) || null;
}

function regulatorExposure(state: string, faceValue: string): string {
  return FUNDED_STATES.has(state) ? faceValue : "0";
}

export function projectRegulatorView(
  contractId: string,
  payload: Record<string, unknown>
): RegulatorExposureRow {
  const state = str(payload.state);
  const faceValue = str(payload.faceValue);
  return {
    contractId,
    receivableId: str(payload.receivableId),
    jurisdiction: parseOptionalText(payload.jurisdiction),
    aggregateExposure: regulatorExposure(state, faceValue),
  };
}
