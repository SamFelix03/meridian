import type {
  BidPricingMode,
  BidSummary,
  FinancingRequestSummary,
  RoundState,
} from "@meridian/shared-types";

export function isFinancingRequestTemplate(templateId: string): boolean {
  return templateId.includes("FinancingRequest:FinancingRequest");
}

export function isBidTemplate(templateId: string): boolean {
  return (
    templateId.includes("Financing.Bid:Bid") ||
    (templateId.includes(":Bid:Bid") && templateId.includes("Financing"))
  );
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function parsePartyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => str(p));
}

function parseIntList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => Number(n));
}

function parseTextList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => str(t));
}

/** Parse Daml Map Party (ContractId Bid) from JSON API encoding. */
export function parseActiveBids(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (raw == null) return out;

  let entries: unknown[] | undefined;
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    entries =
      (obj.map as unknown[] | undefined) ?? (obj.entries as unknown[] | undefined);
  }

  if (!entries) return out;

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    out.set(str(entry[0]), str(entry[1]));
  }
  return out;
}

function parseBidPricingMode(raw: unknown): BidPricingMode {
  const mode = str(raw);
  return mode === "StaticReference" ? "StaticReference" : "OracleAnchored";
}

function parseRoundState(raw: unknown): RoundState {
  const state = str(raw);
  switch (state) {
    case "Paused":
      return "Paused";
    case "StaticReferenceFallback":
      return "StaticReferenceFallback";
    case "Awarded":
      return "Awarded";
    case "Expired":
      return "Expired";
    default:
      return "RoundOpen";
  }
}

export function projectFinancingRequest(
  contractId: string,
  payload: Record<string, unknown>
): FinancingRequestSummary {
  const activeBids = parseActiveBids(payload.activeBids);
  return {
    contractId,
    requestId: str(payload.requestId),
    receivableCid: str(payload.receivableCid),
    supplier: str(payload.supplier),
    invitedFinanciers: parsePartyList(payload.invitedFinanciers),
    deadline: str(payload.deadline),
    pricingBandMin: str(payload.pricingBandMin),
    pricingBandMax: str(payload.pricingBandMax),
    redstoneFeedId: parseIntList(payload.redstoneFeedId),
    roundState: parseRoundState(payload.roundState),
    activeBidCount: activeBids.size,
    bidHistory: parseTextList(payload.bidHistory),
  };
}

export function projectBid(
  contractId: string,
  payload: Record<string, unknown>
): BidSummary {
  const mandateIdRaw = payload.mandateId;
  let mandateId: string | null = null;
  if (mandateIdRaw != null && typeof mandateIdRaw === "object") {
    const tagged = mandateIdRaw as Record<string, unknown>;
    if (tagged.tag === "Some") mandateId = str(tagged.value);
  } else if (mandateIdRaw != null && mandateIdRaw !== "") {
    mandateId = str(mandateIdRaw);
  }
  return {
    contractId,
    requestId: str(payload.requestId),
    financier: str(payload.financier),
    supplier: str(payload.supplier),
    advanceAmount: str(payload.advanceAmount),
    discountRate: str(payload.discountRate),
    reportId: str(payload.reportId),
    mode: parseBidPricingMode(payload.mode),
    redstoneTimestampMs: Number(payload.redstoneTimestampMs ?? 0),
    ledgerTime: str(payload.ledgerTime),
    viaAgent: Boolean(payload.viaAgent),
    mandateId,
  };
}
