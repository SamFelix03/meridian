import type {
  AgentBidDecision,
  AgentRunStatus,
  BiddingMandateSummary,
  BidSummary,
} from "@meridian/shared-types";

export interface FinancierInvitation {
  contractId: string;
  requestId: string;
  supplier: string;
  deadline: string;
  pricingBandMin: string;
  pricingBandMax: string;
  roundState: string;
}

export interface GroqBidProposal {
  advanceAmount: string;
  discountRate: string;
  shouldBid: boolean;
  rationale: string;
}

export interface AgentLoopConfig {
  financierPartyId: string;
  financierIndexerUrl: string;
  oracleRelayUrl: string;
  groqApiKey: string;
  groqModel: string;
  adversarialMode: boolean;
}

export type { AgentBidDecision, AgentRunStatus, BiddingMandateSummary, BidSummary };
