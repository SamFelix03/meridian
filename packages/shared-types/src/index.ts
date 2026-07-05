/** Organizational roles matching on-ledger OrgRole (Phase 0). */
export type OrgRole =
  | "PlatformOperator"
  | "Supplier"
  | "Buyer"
  | "Financier"
  | "Registry"
  | "OracleProvider"
  | "Regulator";

export type KybStatus = "APPROVED" | "REJECTED" | "PENDING";

export interface KybVerifyRequest {
  legalEntityId: string;
  jurisdiction: string;
  requestedRoles: OrgRole[];
  /** Required when requesting Regulator role. */
  complianceProfile?: string;
}

export interface KybVerifyResponse {
  status: KybStatus;
  verificationId: string;
  verifiedAt?: string;
  reason?: string;
}

export interface PartyAllocationRequest {
  legalEntityId: string;
  partyHint: string;
  role: OrgRole;
  jurisdiction: string;
  verificationId: string;
  /** DevNet: shared Seaport validator (optional). */
  participantId?: string;
  /** LocalNet legacy — unused on DevNet. */
  synchronizerIds?: string[];
}

export interface PartyAllocationRecord {
  orgId: string;
  partyHint: string;
  partyId: string;
  role: OrgRole;
  verificationId: string;
  topologyTxId: string;
  participantId: string;
  synchronizerIds: string[];
  allocatedAt: string;
}

/** DevNet persona entry — single source of truth in parties.devnet.json. */
export interface DevNetPersonaEntry {
  orgId: string;
  role: OrgRole;
  partyHint: string;
  partyId: string;
  displayName: string;
  allocatedAt?: string;
}

export interface DevNetPartiesManifest {
  environment: "seaport-devnet";
  validatorId: string;
  ledgerApiUrl: string;
  generatedAt: string;
  personas: DevNetPersonaEntry[];
}

export interface DevNetConfig {
  ledgerApiUrl: string;
  ledgerWsUrl: string;
  authUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  scope: string;
}

export interface SeaportConfig {
  ledgerApiUrl: string;
  ledgerWsUrl: string;
  authUrl: string;
  clientId: string;
  audience: string;
  scope: string;
  validatorId: string;
}

/** @deprecated LocalNet-only manifest — use DevNetPartiesManifest on Seaport. */
export interface PersonaManifestEntry {
  role: OrgRole;
  partyHint: string;
  partyId: string;
  participantId: string;
  participantHost: string;
  ledgerApiPort: number;
  jsonApiPort: number;
  synchronizerIds: string[];
}

/** @deprecated LocalNet-only manifest. */
export interface PartiesManifest {
  generatedAt: string;
  synchronizers: { id: string; alias: string }[];
  personas: PersonaManifestEntry[];
}

export interface IndexerConfig {
  orgId: string;
  actingParty: string;
  role: "Supplier" | "Buyer" | "Financier" | "Regulator" | "PlatformOperator";
  jsonApiUrl: string;
  /** Auth loaded from env via devnet-auth when omitted. */
  ledgerHost?: string;
  ledgerPort?: number;
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  dataDir: string;
  rebuild: boolean;
  /** HTTP read API port when running in serve mode. */
  httpPort?: number;
  /** Poll interval ms for serve mode. */
  pollIntervalMs?: number;
}

export interface RawLedgerEvent {
  offset: string;
  updateId: string;
  recordTime: string;
  payload: unknown;
}

export interface IndexerCheckpoint {
  lastOffset: string;
  eventCount: number;
  lastEventHash: string;
  updatedAt: string;
}

/** Receivable lifecycle state (§8.2). */
export type ReceivableState =
  | "Issued"
  | "PostedForBid"
  | "Funded"
  | "PartiallySyndicated"
  | "Overdue"
  | "Repaid"
  | "Defaulted";

/** Buyer-scoped IBuyerView projection. */
export interface BuyerReceivableView {
  contractId: string;
  receivableId: string;
  payee: string;
  faceValue: string;
  currency: string;
  dueDate: string;
  state?: ReceivableState;
}

/** Supplier-scoped ISupplierView projection. */
export interface SupplierReceivableView {
  contractId: string;
  receivableId: string;
  buyer: string;
  lineItems: Array<{ description: string; quantity: string; unitPrice: string }>;
  faceValue: string;
  currency: string;
  dueDate: string;
  state: ReceivableState;
  assignmentConsentGranted: boolean;
  payeeOfRecord: { payee: string; payeeRole: string };
}

export interface ConsentPolicySummary {
  contractId: string;
  buyer: string;
  supplier: string;
  masterAgreementId: string;
  grantedAt: string;
  allowsAssignment: boolean;
}

export interface ReceivableProposalSummary {
  contractId: string;
  proposalId: string;
  supplier: string;
  buyer: string;
  faceValue: string;
  currency: string;
  dueDate: string;
}

/** Financing round lifecycle state (§8.2). */
export type RoundState =
  | "RoundOpen"
  | "Paused"
  | "StaticReferenceFallback"
  | "Awarded"
  | "Expired";

/** Bid pricing anchor mode — oracle-anchored or static reference fallback. */
export type BidPricingMode = "OracleAnchored" | "StaticReference";

/** Supplier-scoped financing round projection. */
export interface FinancingRequestSummary {
  contractId: string;
  requestId: string;
  receivableCid: string;
  supplier: string;
  invitedFinanciers: string[];
  deadline: string;
  pricingBandMin: string;
  pricingBandMax: string;
  redstoneFeedId: number[];
  roundState: RoundState;
  activeBidCount: number;
  bidHistory: string[];
}

/** Supplier or owning-financier bid projection. */
export interface BidSummary {
  contractId: string;
  requestId: string;
  financier: string;
  supplier: string;
  advanceAmount: string;
  discountRate: string;
  reportId: string;
  mode: BidPricingMode;
  redstoneTimestampMs: number;
  ledgerTime: string;
  viaAgent?: boolean;
  mandateId?: string | null;
}

/** On-ledger bidding mandate for agent-constrained bids. */
export interface BiddingMandateSummary {
  contractId: string;
  mandateId: string;
  financier: string;
  maxExposure: string;
  minSpread: string;
  eligibleSuppliers: string[];
  agentEnabled: boolean;
  revoked: boolean;
}

/** Agent runtime tick status (off-ledger observability). */
export interface AgentBidDecision {
  requestId: string;
  requestContractId: string;
  shouldBid: boolean;
  advanceAmount: string;
  discountRate: string;
  rationale: string;
  submitted: boolean;
  bidContractId?: string;
  ledgerError?: string;
}

export interface AgentRunStatus {
  lastTickAt: string | null;
  lastTickDurationMs: number | null;
  lastError: string | null;
  adversarialMode: boolean;
  decisions: AgentBidDecision[];
  groqModel: string;
}

/** Cap table entry for syndicated positions (§7.6). */
export interface CapTableEntry {
  participant: string;
  shareBps: number;
  entryRef: string;
}

/** Lead-financier syndication offering projection. */
export interface SyndicationOfferingSummary {
  contractId: string;
  offeringId: string;
  receivableCid: string;
  receivableId: string;
  leadFinancier: string;
  invitedParticipants: string[];
  deadline: string;
  pricingBandMin: string;
  pricingBandMax: string;
  roundState: RoundState;
  activeBidCount: number;
  faceValue: string;
  currency: string;
}

/** Sealed syndication interest bid. */
export interface SyndicationBidSummary {
  contractId: string;
  offeringId: string;
  participant: string;
  leadFinancier: string;
  shareBps: number;
  discountRate: string;
  reportId: string;
  mode: BidPricingMode;
}

/** Pass-through participation interest (§7.6). */
export interface ParticipationInterestSummary {
  contractId: string;
  receivableId: string;
  leadFinancier: string;
  participant: string;
  shareBps: number;
  faceValue: string;
  currency: string;
  legalNature: string;
  instrumentClass: string;
  entryRef: string;
}

/** Lead financier cap table view. */
export interface LeadCapTableView {
  receivableId: string;
  faceValue: string;
  currency: string;
  capTable: CapTableEntry[];
  syndicationState: ReceivableState;
}

/** Supplier bid-comparison row with oracle-normalized effective rate (§9.1). */
export interface BidComparisonRow {
  bidContractId: string;
  financier: string;
  advanceAmount: string;
  discountRate: string;
  effectiveRate: string;
  reportId: string;
  mode: BidPricingMode;
  oracleFresh: boolean;
  rank: number;
}

/** Notification events pushed to portal subscribers. */
export type MeridianNotificationEvent =
  | { type: "receivable.issued"; receivableId: string; contractId: string }
  | { type: "receivable.proposed"; proposalId: string; contractId: string }
  | { type: "consent.created"; masterAgreementId: string; contractId: string }
  | { type: "round.opened"; requestId: string; contractId: string }
  | { type: "bid.submitted"; requestId: string; bidContractId: string; financier: string }
  | {
      type: "agent.bid_submitted";
      requestId: string;
      bidContractId: string;
      financier: string;
      mandateId: string;
    }
  | {
      type: "agent.bid_rejected";
      requestId: string;
      financier: string;
      mandateId: string;
      reason: string;
    }
  | { type: "mandate.created"; mandateId: string; contractId: string; financier: string }
  | {
      type: "round.awarded";
      requestId: string;
      contractId: string;
      winningBidCid: string;
    }
  | { type: "round.paused"; requestId: string; contractId: string }
  | { type: "receivable.repaid"; receivableId: string; contractId: string }
  | { type: "receivable.overdue"; receivableId: string; contractId: string }
  | { type: "syndication.opened"; offeringId: string; contractId: string }
  | {
      type: "syndication.bid_submitted";
      offeringId: string;
      bidContractId: string;
      participant: string;
    }
  | {
      type: "syndication.awarded";
      offeringId: string;
      contractId: string;
      winningBidCid: string;
    }
  | { type: "syndication.waterfall_distributed"; receivableId: string; contractId: string }
  | {
      type: "settlement.recorded";
      recordId: string;
      receivableId: string;
      requestId: string;
      finality: SettlementFinality;
    }
  | {
      type: "regulator.grant_created";
      grantId: string;
      contractId: string;
      jurisdiction: string;
    };

export type SettlementFinality = "Atomic" | "ReassignmentMediated" | "EscrowFallback";

export interface SettlementFinalitySummary {
  atomic: number;
  reassignmentMediated: number;
  escrowFallback: number;
  total: number;
}

export interface SettlementAuditSummary {
  contractId: string;
  recordId: string;
  receivableId: string;
  requestId: string;
  finality: SettlementFinality;
  settledAt: string;
}

export interface RegulatorExposureRow {
  contractId: string;
  receivableId: string;
  jurisdiction: string | null;
  aggregateExposure: string;
}

export interface RegulatorExposureRollup {
  jurisdiction: string;
  totalExposure: string;
  receivableCount: number;
}

export interface RegulatorJurisdictionGrantSummary {
  contractId: string;
  grantId: string;
  regulator: string;
  jurisdiction: string;
  active: boolean;
}

export interface OracleHealthStatus {
  ok: boolean;
  service: string;
  isFresh: boolean;
  cached: boolean;
  lastError: string | null;
  fault: string | null;
  referenceRate?: { feedId: string; value: number; ageMs: number } | null;
}

export interface InterfaceProjection {
  contractId: string;
  interfaceName: string;
  party: string;
  viewJson: unknown;
  offset: string;
  archived: boolean;
}

export type {
  OracleRelayConfig,
  FeedSnapshot,
  FetchResult,
} from "@meridian/oracle-feeds";
