import { useEffect } from "react";
import type {
  AgentRunStatus,
  BidComparisonRow,
  BidPricingMode,
  BidSummary,
  BiddingMandateSummary,
  CapTableEntry,
  FinancingRequestSummary,
  OracleHealthStatus,
  ParticipationInterestSummary,
  RegulatorExposureRollup,
  RegulatorJurisdictionGrantSummary,
  RoundState,
  SettlementFinalitySummary,
  SyndicationBidSummary,
  SyndicationOfferingSummary,
} from "@meridian/shared-types";

const API = import.meta.env.VITE_API_URL ?? "/api";
const API_DEBUG =
  import.meta.env.DEV || import.meta.env.VITE_API_DEBUG === "1";

function apiDebugLog(message: string, detail?: unknown): void {
  if (!API_DEBUG) return;
  if (detail !== undefined) {
    console.log(`[meridian-api] ${message}`, detail);
  } else {
    console.log(`[meridian-api] ${message}`);
  }
}

function apiDebugError(message: string, detail?: unknown): void {
  if (!API_DEBUG) return;
  if (detail !== undefined) {
    console.error(`[meridian-api] ${message}`, detail);
  } else {
    console.error(`[meridian-api] ${message}`);
  }
}

if (API_DEBUG) {
  apiDebugLog(`API base URL: ${API}`);
}

/** Browser-console logging for agent runtime (dev / VITE_API_DEBUG=1). */
export function logAgent(message: string, detail?: unknown): void {
  if (!API_DEBUG) return;
  if (detail !== undefined) {
    console.log(`[meridian-agent] ${message}`, detail);
  } else {
    console.log(`[meridian-agent] ${message}`);
  }
}

export function logAgentError(message: string, detail?: unknown): void {
  if (!API_DEBUG) return;
  if (detail !== undefined) {
    console.error(`[meridian-agent] ${message}`, detail);
  } else {
    console.error(`[meridian-agent] ${message}`);
  }
}

export function logAgentStatus(label: string, status: AgentRunStatus | null): void {
  if (!API_DEBUG) return;
  if (!status) {
    logAgentError(`${label}: no status returned`);
    return;
  }
  const runtimeOnline = status.groqModel !== "unavailable";
  logAgent(`${label}`, {
    runtimeOnline,
    groqModel: status.groqModel,
    lastTickAt: status.lastTickAt,
    lastTickDurationMs: status.lastTickDurationMs,
    lastError: status.lastError,
    decisionCount: status.decisions.length,
  });
  if (status.lastError) {
    logAgentError("lastError", status.lastError);
  }
  if (status.decisions.length > 0) {
    console.table(
      status.decisions.map((d) => ({
        round: d.requestId,
        shouldBid: d.shouldBid,
        advance: d.advanceAmount,
        rate: d.discountRate,
        submitted: d.submitted,
        bidCid: d.bidContractId?.slice(0, 16) ?? "",
        error: d.ledgerError?.slice(0, 80) ?? "",
        rationale: d.rationale?.slice(0, 80) ?? "",
      }))
    );
  }
}

export function isAgentRuntimeOnline(status: AgentRunStatus | null): boolean {
  return status != null && status.groqModel !== "unavailable";
}

export interface BuyerObligation {
  contractId: string;
  receivableId: string;
  payee: string;
  faceValue: string;
  currency: string;
  dueDate: string;
  state?: string;
}

export interface ReceivableProposal {
  contractId: string;
  proposalId: string;
  supplier: string;
  buyer: string;
  faceValue: string;
  currency: string;
  dueDate: string;
}

export interface SupplierReceivable {
  contractId: string;
  receivableId: string;
  buyer: string;
  lineItems: Array<{ description: string; quantity: string; unitPrice: string }>;
  faceValue: string;
  currency: string;
  dueDate: string;
  state: string;
}

export interface FinancierInvitation {
  contractId: string;
  requestId: string;
  receivableCid?: string;
  supplier: string;
  deadline: string;
  pricingBandMin: string;
  pricingBandMax: string;
  roundState: RoundState;
  creditProfileStub: string;
  faceValue?: string;
  currency?: string;
}

export type {
  FinancingRequestSummary,
  BidComparisonRow,
  BidSummary,
  BidPricingMode,
  RoundState,
  CapTableEntry,
  SyndicationOfferingSummary,
  SyndicationBidSummary,
  ParticipationInterestSummary,
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const url = `${API}${path}`;
  const started = performance.now();
  apiDebugLog(`→ ${method} ${path}`, init?.body ?? null);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch (err) {
    apiDebugError(
      `✗ ${method} ${path} network error (${Math.round(performance.now() - started)}ms)`,
      err
    );
    throw err;
  }

  const elapsed = Math.round(performance.now() - started);
  if (!res.ok) {
    const errText = await res.text();
    let parsed: unknown = errText;
    try {
      parsed = JSON.parse(errText);
    } catch {
      // keep raw text
    }
    apiDebugError(`✗ ${method} ${path} ${res.status} (${elapsed}ms)`, parsed);
    throw new Error(errText || res.statusText);
  }

  const data = (await res.json()) as T;
  apiDebugLog(`✓ ${method} ${path} ${res.status} (${elapsed}ms)`, data);
  return data;
}

export const api = {
  getParties: () =>
    fetchJson<{
      supplier: string;
      buyer: string;
      financierA: string;
      financierB: string;
    }>("/parties"),

  getBuyerObligations: () =>
    fetchJson<{ obligations: BuyerObligation[] }>("/buyer/obligations"),
  getBuyerRepayable: () =>
    fetchJson<{ obligations: BuyerObligation[] }>("/buyer/repayable-obligations"),
  repayObligation: (
    receivableContractId: string,
    body: { faceValue: string; payeePartyId?: string; settlementRef?: string }
  ) =>
    fetchJson<{ receivableContractId: string; proofContractId?: string }>(
      `/receivables/${encodeURIComponent(receivableContractId)}/repay`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  postReceivableForBid: (receivableContractId: string) =>
    fetchJson<{ receivableContractId: string; transaction?: string }>(
      `/receivables/${encodeURIComponent(receivableContractId)}/post-for-bid`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  getSupplierPortfolio: () =>
    fetchJson<{
      receivables: SupplierReceivable[];
      repaymentProofs: Array<{ receivableId: string; amount: string; settlementRef: string }>;
    }>("/supplier/portfolio"),
  getFinancierPositions: () =>
    fetchJson<{ positions: SupplierReceivable[] }>("/financier/positions"),
  getBuyerProposals: () =>
    fetchJson<{ proposals: ReceivableProposal[] }>("/buyer/pending-proposals"),
  getSupplierReceivables: () =>
    fetchJson<{ receivables: SupplierReceivable[] }>("/supplier/receivables"),
  getConsentPolicies: () =>
    fetchJson<{ policies: unknown[] }>("/supplier/consent-policies"),

  getFinancingRounds: () =>
    fetchJson<{ rounds: FinancingRequestSummary[] }>("/financing/rounds"),
  getFinancingBids: (requestContractId: string) =>
    fetchJson<{ bids: BidComparisonRow[] }>(
      `/financing/${encodeURIComponent(requestContractId)}/bids`
    ),
  openFinancingRound: (body: {
    receivableCid: string;
    requestId?: string;
    financiers?: string[];
    deadline: string;
    pricingBandMin: string;
    pricingBandMax: string;
    redstoneFeedId?: number[];
  }) =>
    fetchJson<{ contractId: string }>("/financing/open", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  awardFinancingBid: (
    requestContractId: string,
    winningBidCid: string,
    advanceAmount?: string,
    financierPartyId?: string
  ) =>
    fetchJson<{ receivableContractId: string; settlementAllocationCid?: string }>(
      `/financing/${encodeURIComponent(requestContractId)}/award`,
      {
        method: "POST",
        body: JSON.stringify({ winningBidCid, advanceAmount, financierPartyId }),
      }
    ),
  pauseFinancingRound: (requestContractId: string) =>
    fetchJson<{ contractId: string }>(
      `/financing/${encodeURIComponent(requestContractId)}/pause`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  staticFallbackFinancingRound: (requestContractId: string) =>
    fetchJson<{ contractId: string }>(
      `/financing/${encodeURIComponent(requestContractId)}/static-fallback`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  expireFinancingRound: (requestContractId: string) =>
    fetchJson<{ contractId: string }>(
      `/financing/${encodeURIComponent(requestContractId)}/expire`,
      { method: "POST", body: JSON.stringify({}) }
    ),

  getFinancierInvitations: () =>
    fetchJson<{ invitations: FinancierInvitation[] }>("/financier/invitations"),
  getFinancierMyBids: () =>
    fetchJson<{ bids: BidSummary[] }>("/financier/my-bids"),
  getFinancierMandates: () =>
    fetchJson<{ mandates: BiddingMandateSummary[] }>("/financier/mandates"),
  createFinancierMandate: (body: {
    mandateId: string;
    maxExposure: string;
    minSpread: string;
    eligibleSuppliers?: string[];
    agentEnabled?: boolean;
  }) =>
    fetchJson<{ contractId: string }>("/financier/mandates", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateFinancierMandate: (
    mandateContractId: string,
    body: {
      action?: "revoke" | "update" | "setAgentEnabled";
      maxExposure?: string;
      minSpread?: string;
      eligibleSuppliers?: string[];
      agentEnabled?: boolean;
    }
  ) =>
    fetchJson<{ contractId: string }>(
      `/financier/mandates/${encodeURIComponent(mandateContractId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  getAgentStatus: async () => {
    logAgent("fetching agent status…");
    const status = await fetchJson<AgentRunStatus>("/financier/agent/status");
    logAgentStatus("agent status", status);
    return status;
  },
  triggerAgentTick: async () => {
    logAgent("triggering agent tick (Groq + on-ledger bids)…");
    const started = performance.now();
    const status = await fetchJson<AgentRunStatus>("/financier/agent/tick", {
      method: "POST",
      body: "{}",
    });
    logAgent(`tick finished in ${Math.round(performance.now() - started)}ms`);
    logAgentStatus("tick result", status);
    return status;
  },
  submitFinancingBid: (
    requestContractId: string,
    body: { advanceAmount: string; discountRate: string; useStaticReference?: boolean }
  ) =>
    fetchJson<{ bidContractId: string; oracleFresh: boolean }>(
      `/financing/${encodeURIComponent(requestContractId)}/bid`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  replaceFinancingBid: (
    requestContractId: string,
    body: { advanceAmount: string; discountRate: string; useStaticReference?: boolean }
  ) =>
    fetchJson<{ bidContractId: string; oracleFresh: boolean }>(
      `/financing/${encodeURIComponent(requestContractId)}/replace-bid`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  proposeInvoice: (body: {
    proposalId?: string;
    faceValue: string;
    currency: string;
    dueDate: string;
    consentGranted: boolean;
  }) =>
    fetchJson<{ contractId: string }>("/invoices/propose", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cosignInvoice: (contractId: string) =>
    fetchJson<{ receivableContractId: string }>(
      `/invoices/${encodeURIComponent(contractId)}/cosign`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  createConsentPolicy: (body: { masterAgreementId: string; allowsAssignment: boolean }) =>
    fetchJson<{ contractId: string }>("/consent-policies", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getSyndicationOfferings: () =>
    fetchJson<{ offerings: SyndicationOfferingSummary[] }>("/financier/syndication/offerings"),
  getSyndicationInvitations: () =>
    fetchJson<{ invitations: SyndicationOfferingSummary[] }>("/financier/syndication/invitations"),
  getSyndicationInterests: (tab: "lead" | "participant") =>
    fetchJson<{ interests: ParticipationInterestSummary[] }>(
      `/financier/syndication/my-interests?tab=${tab}`
    ),
  getSyndicationCapTable: (receivableId: string) =>
    fetchJson<{ receivableId: string; capTable: CapTableEntry[]; syndicationState: string }>(
      `/financier/syndication/cap-table/${encodeURIComponent(receivableId)}`
    ),
  getSyndicationBids: (offeringContractId: string) =>
    fetchJson<{ bids: SyndicationBidSummary[] }>(
      `/financier/syndication/bids/${encodeURIComponent(offeringContractId)}`
    ),
  openSyndicationOffering: (body: {
    receivableCid: string;
    offeringId?: string;
    participants?: string[];
    deadline?: string;
    pricingBandMin?: string;
    pricingBandMax?: string;
  }) =>
    fetchJson<{ contractId: string }>("/syndication/open", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitSyndicationBid: (
    offeringContractId: string,
    body: { shareBps: number; discountRate: string; useStaticReference?: boolean }
  ) =>
    fetchJson<{ bidContractId: string }>(
      `/syndication/${encodeURIComponent(offeringContractId)}/bid`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  awardSyndicationBid: (
    offeringContractId: string,
    body: { winningBidCid: string }
  ) =>
    fetchJson<{ receivableContractId: string }>(
      `/syndication/${encodeURIComponent(offeringContractId)}/award`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  getOpsSettlementFinality: () =>
    fetchJson<{ summary: SettlementFinalitySummary }>("/ops/settlement-finality"),
  getOpsOracleHealth: () => fetchJson<OracleHealthStatus>("/ops/oracle-health"),
  getOpsRegulatorGrants: () =>
    fetchJson<{ grants: RegulatorJurisdictionGrantSummary[] }>("/ops/regulator-grants"),
  createOpsRegulatorGrant: (body: { grantId?: string; jurisdiction: string }) =>
    fetchJson<{ contractId: string }>("/ops/regulator-grants", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revokeOpsRegulatorGrant: (contractId: string) =>
    fetchJson<{ contractId: string }>(`/ops/regulator-grants/${encodeURIComponent(contractId)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "revoke" }),
    }),
  grantRegulatorObserver: (receivableContractId: string, jurisdiction: string) =>
    fetchJson<{ receivableContractId: string }>(
      `/ops/receivables/${encodeURIComponent(receivableContractId)}/grant-observer`,
      { method: "POST", body: JSON.stringify({ jurisdiction }) }
    ),
  getRegulatorExposure: (jurisdiction?: string) =>
    fetchJson<{ rollups: RegulatorExposureRollup[] }>(
      jurisdiction
        ? `/regulator/exposure?jurisdiction=${encodeURIComponent(jurisdiction)}`
        : "/regulator/exposure"
    ),
  verifyKyb: (body: {
    legalEntityId: string;
    jurisdiction: string;
    requestedRoles: string[];
    complianceProfile?: string;
  }) =>
    fetchJson<{ status: string; verificationId: string }>("/kyb/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  completeKyb: (verificationId: string, decision: "APPROVED" | "REJECTED", reason?: string) =>
    fetchJson<{ status: string; verificationId: string }>(
      `/kyb/verify/${encodeURIComponent(verificationId)}/complete`,
      { method: "POST", body: JSON.stringify({ decision, reason }) }
    ),
  allocateParty: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>("/parties/allocate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export function useNotifications(orgId: string, onEvent: () => void): void {
  const wsUrl = import.meta.env.VITE_NOTIFICATIONS_WS ?? "ws://127.0.0.1:4020";
  useEffect(() => {
    const wsTarget = `${wsUrl}/events?orgId=${encodeURIComponent(orgId)}`;
    apiDebugLog(`WebSocket connect ${wsTarget}`);
    const ws = new WebSocket(wsTarget);
    ws.onopen = () => apiDebugLog(`WebSocket open org=${orgId}`);
    ws.onmessage = () => {
      apiDebugLog(`WebSocket event org=${orgId}`);
      onEvent();
    };
    ws.onerror = (ev) => apiDebugError(`WebSocket error org=${orgId}`, ev);
    ws.onclose = (ev) =>
      apiDebugLog(`WebSocket closed org=${orgId} code=${ev.code} reason=${ev.reason || "(none)"}`);
    return () => ws.close();
  }, [orgId, onEvent]);
}
