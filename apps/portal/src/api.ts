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
  supplier: string;
  deadline: string;
  pricingBandMin: string;
  pricingBandMax: string;
  roundState: RoundState;
  creditProfileStub: string;
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
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json() as Promise<T>;
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
  getAgentStatus: () => fetchJson<AgentRunStatus>("/financier/agent/status"),
  triggerAgentTick: () =>
    fetchJson<AgentRunStatus>("/financier/agent/tick", { method: "POST", body: "{}" }),
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
    const ws = new WebSocket(`${wsUrl}/events?orgId=${encodeURIComponent(orgId)}`);
    ws.onmessage = () => onEvent();
    return () => ws.close();
  }, [orgId, onEvent]);
}
