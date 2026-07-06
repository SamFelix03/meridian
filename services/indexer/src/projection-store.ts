import Database from "better-sqlite3";
import type {
  BidComparisonRow,
  BidSummary,
  BiddingMandateSummary,
  BuyerReceivableView,
  ConsentPolicySummary,
  FinancingRequestSummary,
  InterfaceProjection,
  LeadCapTableView,
  ParticipationInterestSummary,
  ReceivableProposalSummary,
  RegulatorExposureRow,
  RegulatorExposureRollup,
  RegulatorJurisdictionGrantSummary,
  RoundState,
  SettlementAuditSummary,
  SettlementFinalitySummary,
  SupplierReceivableView,
  SyndicationBidSummary,
  SyndicationOfferingSummary,
} from "@meridian/shared-types";
import { rankBids, type BidComparisonOptions } from "./bid-comparison.js";

/** Extended per-org store with interface-view projections. */
export class ProjectionStore {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interface_projections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        interface_name TEXT NOT NULL,
        party TEXT NOT NULL,
        view_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        UNIQUE(contract_id, interface_name, party)
      );
      CREATE TABLE IF NOT EXISTS receivable_proposals (
        contract_id TEXT PRIMARY KEY,
        proposal_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS consent_policies (
        contract_id TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS financing_requests (
        contract_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS bids (
        contract_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        bid_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_bids_request_id ON bids(request_id);
      CREATE TABLE IF NOT EXISTS repayment_proofs (
        contract_id TEXT PRIMARY KEY,
        receivable_id TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS syndication_offerings (
        contract_id TEXT PRIMARY KEY,
        offering_id TEXT NOT NULL,
        offering_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS syndication_bids (
        contract_id TEXT PRIMARY KEY,
        offering_id TEXT NOT NULL,
        bid_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS participation_interests (
        contract_id TEXT PRIMARY KEY,
        receivable_id TEXT NOT NULL,
        interest_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS bidding_mandates (
        contract_id TEXT PRIMARY KEY,
        mandate_id TEXT NOT NULL,
        mandate_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_bidding_mandates_mandate_id ON bidding_mandates(mandate_id);
      CREATE TABLE IF NOT EXISTS regulator_exposure (
        contract_id TEXT PRIMARY KEY,
        receivable_id TEXT NOT NULL,
        jurisdiction TEXT,
        exposure_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settlement_audits (
        contract_id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        audit_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS regulator_grants (
        contract_id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        grant_json TEXT NOT NULL,
        offset TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  upsertProjection(
    projection: InterfaceProjection
  ): void {
    this.db
      .prepare(
        `INSERT INTO interface_projections (contract_id, interface_name, party, view_json, offset, archived)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(contract_id, interface_name, party) DO UPDATE SET
           view_json = excluded.view_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(
        projection.contractId,
        projection.interfaceName,
        projection.party,
        JSON.stringify(projection.viewJson),
        projection.offset
      );
  }

  archiveProjections(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE interface_projections SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  upsertProposal(proposal: ReceivableProposalSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO receivable_proposals (contract_id, proposal_json, offset, archived)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           proposal_json = excluded.proposal_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(proposal.contractId, JSON.stringify(proposal), offset);
  }

  archiveProposals(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE receivable_proposals SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  upsertConsentPolicy(policy: ConsentPolicySummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO consent_policies (contract_id, policy_json, offset, archived)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           policy_json = excluded.policy_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(policy.contractId, JSON.stringify(policy), offset);
  }

  getBuyerObligations(): BuyerReceivableView[] {
    const rows = this.db
      .prepare(
        `SELECT view_json FROM interface_projections
         WHERE interface_name = 'IBuyerView' AND archived = 0`
      )
      .all() as Array<{ view_json: string }>;
    return rows.map((r) => JSON.parse(r.view_json) as BuyerReceivableView);
  }

  getSupplierReceivables(): SupplierReceivableView[] {
    const rows = this.db
      .prepare(
        `SELECT view_json FROM interface_projections
         WHERE interface_name = 'ISupplierView' AND archived = 0`
      )
      .all() as Array<{ view_json: string }>;
    return rows.map((r) => JSON.parse(r.view_json) as SupplierReceivableView);
  }

  getPendingProposals(): ReceivableProposalSummary[] {
    const rows = this.db
      .prepare(`SELECT proposal_json FROM receivable_proposals WHERE archived = 0`)
      .all() as Array<{ proposal_json: string }>;
    return rows.map((r) => JSON.parse(r.proposal_json) as ReceivableProposalSummary);
  }

  getConsentPolicies(): ConsentPolicySummary[] {
    const rows = this.db
      .prepare(`SELECT policy_json FROM consent_policies WHERE archived = 0`)
      .all() as Array<{ policy_json: string }>;
    return rows.map((r) => JSON.parse(r.policy_json) as ConsentPolicySummary);
  }

  upsertFinancingRequest(request: FinancingRequestSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO financing_requests (contract_id, request_id, request_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           request_id = excluded.request_id,
           request_json = excluded.request_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(request.contractId, request.requestId, JSON.stringify(request), offset);
  }

  archiveFinancingRequests(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE financing_requests SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  upsertBid(bid: BidSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO bids (contract_id, request_id, bid_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           request_id = excluded.request_id,
           bid_json = excluded.bid_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(bid.contractId, bid.requestId, JSON.stringify(bid), offset);
  }

  archiveBids(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(`UPDATE bids SET archived = 1 WHERE contract_id = ?`);
    for (const id of contractIds) stmt.run(id);
  }

  getFinancingRounds(): FinancingRequestSummary[] {
    const rows = this.db
      .prepare(`SELECT request_json FROM financing_requests WHERE archived = 0`)
      .all() as Array<{ request_json: string }>;
    return rows.map((r) => JSON.parse(r.request_json) as FinancingRequestSummary);
  }

  getFinancingRequestByContractId(contractId: string): FinancingRequestSummary | null {
    const row = this.db
      .prepare(`SELECT request_json FROM financing_requests WHERE contract_id = ? AND archived = 0`)
      .get(contractId) as { request_json: string } | undefined;
    return row ? (JSON.parse(row.request_json) as FinancingRequestSummary) : null;
  }

  getBidsForRequestContract(requestContractId: string): BidSummary[] {
    const request = this.getFinancingRequestByContractId(requestContractId);
    if (!request) return [];
    return this.getBidsByRequestId(request.requestId);
  }

  getBidsByRequestId(requestId: string): BidSummary[] {
    const rows = this.db
      .prepare(`SELECT bid_json FROM bids WHERE request_id = ? AND archived = 0`)
      .all(requestId) as Array<{ bid_json: string }>;
    return rows.map((r) => JSON.parse(r.bid_json) as BidSummary);
  }

  getBidComparison(
    requestContractId: string,
    options: BidComparisonOptions
  ): BidComparisonRow[] {
    const bids = this.getBidsForRequestContract(requestContractId);
    return rankBids(bids, options);
  }

  getFinancierInvitations(): Array<{
    contractId: string;
    requestId: string;
    receivableCid: string;
    supplier: string;
    deadline: string;
    pricingBandMin: string;
    pricingBandMax: string;
    roundState: RoundState;
    creditProfileStub: string;
    faceValue: string;
    currency: string;
  }> {
    const receivableByCid = new Map(
      this.getSupplierReceivables().map((r) => [r.contractId, r])
    );
    return this.getFinancingRounds().map((round) => {
      const receivable = receivableByCid.get(round.receivableCid);
      return {
        contractId: round.contractId,
        requestId: round.requestId,
        receivableCid: round.receivableCid,
        supplier: round.supplier,
        deadline: round.deadline,
        pricingBandMin: round.pricingBandMin,
        pricingBandMax: round.pricingBandMax,
        roundState: round.roundState,
        creditProfileStub: `buyer-tier-${round.requestId.slice(-6).toLowerCase()}`,
        faceValue: receivable?.faceValue ?? "",
        currency: receivable?.currency ?? "USD",
      };
    });
  }

  getFinancierMyBids(actingParty: string): BidSummary[] {
    const rows = this.db
      .prepare(`SELECT bid_json FROM bids WHERE archived = 0`)
      .all() as Array<{ bid_json: string }>;
    return rows
      .map((r) => JSON.parse(r.bid_json) as BidSummary)
      .filter((bid) => bid.financier === actingParty);
  }

  upsertRepaymentProof(
    proof: {
      contractId: string;
      receivableId: string;
      payer: string;
      payee: string;
      amount: string;
      currency: string;
      paidAt: string;
      settlementRef: string;
    },
    offset: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO repayment_proofs (contract_id, receivable_id, proof_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           receivable_id = excluded.receivable_id,
           proof_json = excluded.proof_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(proof.contractId, proof.receivableId, JSON.stringify(proof), offset);
  }

  getRepaymentProofs(): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare(`SELECT proof_json FROM repayment_proofs WHERE archived = 0`)
      .all() as Array<{ proof_json: string }>;
    return rows.map((r) => JSON.parse(r.proof_json) as Record<string, unknown>);
  }

  getSupplierPortfolio(): {
    receivables: SupplierReceivableView[];
    repaymentProofs: Array<Record<string, unknown>>;
  } {
    return {
      receivables: this.getSupplierReceivables(),
      repaymentProofs: this.getRepaymentProofs(),
    };
  }

  getBuyerRepayableObligations(): BuyerReceivableView[] {
    return this.getBuyerObligations().filter((o) =>
      ["Funded", "Overdue", "PartiallySyndicated"].includes(String(o.state ?? ""))
    );
  }

  getFinancierPositions(actingParty: string): SupplierReceivableView[] {
    return this.getSupplierReceivables().filter(
      (r) => r.payeeOfRecord?.payee === actingParty
    );
  }

  upsertSyndicationOffering(offering: SyndicationOfferingSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO syndication_offerings (contract_id, offering_id, offering_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           offering_id = excluded.offering_id,
           offering_json = excluded.offering_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(offering.contractId, offering.offeringId, JSON.stringify(offering), offset);
  }

  archiveSyndicationOfferings(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE syndication_offerings SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  upsertSyndicationBid(bid: SyndicationBidSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO syndication_bids (contract_id, offering_id, bid_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           offering_id = excluded.offering_id,
           bid_json = excluded.bid_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(bid.contractId, bid.offeringId, JSON.stringify(bid), offset);
  }

  archiveSyndicationBids(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(`UPDATE syndication_bids SET archived = 1 WHERE contract_id = ?`);
    for (const id of contractIds) stmt.run(id);
  }

  upsertParticipationInterest(interest: ParticipationInterestSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO participation_interests (contract_id, receivable_id, interest_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           receivable_id = excluded.receivable_id,
           interest_json = excluded.interest_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(interest.contractId, interest.receivableId, JSON.stringify(interest), offset);
  }

  archiveParticipationInterests(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE participation_interests SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  getSyndicationOfferings(): SyndicationOfferingSummary[] {
    const rows = this.db
      .prepare(`SELECT offering_json FROM syndication_offerings WHERE archived = 0`)
      .all() as Array<{ offering_json: string }>;
    return rows.map((r) => JSON.parse(r.offering_json) as SyndicationOfferingSummary);
  }

  getSyndicationInvitations(actingParty: string): SyndicationOfferingSummary[] {
    return this.getSyndicationOfferings().filter((o) =>
      o.invitedParticipants.includes(actingParty)
    );
  }

  getSyndicationBidsForOffering(offeringContractId: string): SyndicationBidSummary[] {
    const offering = this.getSyndicationOfferings().find((o) => o.contractId === offeringContractId);
    if (!offering) return [];
    const rows = this.db
      .prepare(`SELECT bid_json FROM syndication_bids WHERE offering_id = ? AND archived = 0`)
      .all(offering.offeringId) as Array<{ bid_json: string }>;
    return rows.map((r) => JSON.parse(r.bid_json) as SyndicationBidSummary);
  }

  getParticipationInterests(actingParty: string): ParticipationInterestSummary[] {
    const rows = this.db
      .prepare(`SELECT interest_json FROM participation_interests WHERE archived = 0`)
      .all() as Array<{ interest_json: string }>;
    return rows
      .map((r) => JSON.parse(r.interest_json) as ParticipationInterestSummary)
      .filter(
        (i) => i.participant === actingParty || i.leadFinancier === actingParty
      );
  }

  getLeadCapTable(receivableId: string): LeadCapTableView | null {
    const rows = this.db
      .prepare(
        `SELECT view_json, offset FROM interface_projections
         WHERE interface_name = 'ILeadFinancierView' AND archived = 0
         ORDER BY offset DESC`
      )
      .all() as Array<{ view_json: string; offset: string }>;
    for (const row of rows) {
      const view = JSON.parse(row.view_json) as LeadCapTableView;
      if (view.receivableId === receivableId && (view.capTable?.length ?? 0) > 0) {
        return view;
      }
    }

    const interestRows = this.db
      .prepare(`SELECT interest_json FROM participation_interests WHERE receivable_id = ? AND archived = 0`)
      .all(receivableId) as Array<{ interest_json: string }>;
    if (interestRows.length === 0) return null;

    const interests = interestRows.map(
      (r) => JSON.parse(r.interest_json) as ParticipationInterestSummary
    );
    const sample = interests[0]!;
    return {
      receivableId,
      faceValue: sample.faceValue,
      currency: sample.currency,
      capTable: interests.map((i) => ({
        participant: i.participant,
        shareBps: i.shareBps,
        entryRef: i.entryRef,
      })),
      syndicationState: "PartiallySyndicated",
    };
  }

  upsertBiddingMandate(mandate: BiddingMandateSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO bidding_mandates (contract_id, mandate_id, mandate_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           mandate_id = excluded.mandate_id,
           mandate_json = excluded.mandate_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(mandate.contractId, mandate.mandateId, JSON.stringify(mandate), offset);
  }

  archiveMandates(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE bidding_mandates SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  getFinancierMandates(actingParty: string): BiddingMandateSummary[] {
    const rows = this.db
      .prepare(`SELECT mandate_json FROM bidding_mandates WHERE archived = 0`)
      .all() as Array<{ mandate_json: string }>;
    return rows
      .map((r) => JSON.parse(r.mandate_json) as BiddingMandateSummary)
      .filter((m) => m.financier === actingParty);
  }

  upsertRegulatorExposure(row: RegulatorExposureRow, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO regulator_exposure (contract_id, receivable_id, jurisdiction, exposure_json, offset, archived)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           receivable_id = excluded.receivable_id,
           jurisdiction = excluded.jurisdiction,
           exposure_json = excluded.exposure_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(
        row.contractId,
        row.receivableId,
        row.jurisdiction,
        JSON.stringify(row),
        offset
      );
  }

  archiveRegulatorExposure(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE regulator_exposure SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  getRegulatorExposureRows(jurisdiction?: string): RegulatorExposureRow[] {
    const rows = this.db
      .prepare(`SELECT exposure_json FROM regulator_exposure WHERE archived = 0`)
      .all() as Array<{ exposure_json: string }>;
    const parsed = rows.map((r) => JSON.parse(r.exposure_json) as RegulatorExposureRow);
    if (!jurisdiction) return parsed;
    return parsed.filter((r) => r.jurisdiction === jurisdiction);
  }

  getRegulatorExposureRollups(jurisdiction?: string): RegulatorExposureRollup[] {
    const rows = this.getRegulatorExposureRows(jurisdiction);
    const byJurisdiction = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const key = row.jurisdiction ?? "UNKNOWN";
      const current = byJurisdiction.get(key) ?? { total: 0, count: 0 };
      current.total += Number(row.aggregateExposure);
      current.count += 1;
      byJurisdiction.set(key, current);
    }
    return [...byJurisdiction.entries()].map(([j, stats]) => ({
      jurisdiction: j,
      totalExposure: String(stats.total),
      receivableCount: stats.count,
    }));
  }

  upsertSettlementAudit(audit: SettlementAuditSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO settlement_audits (contract_id, record_id, audit_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           record_id = excluded.record_id,
           audit_json = excluded.audit_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(audit.contractId, audit.recordId, JSON.stringify(audit), offset);
  }

  archiveSettlementAudits(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE settlement_audits SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  getSettlementFinalitySummary(): SettlementFinalitySummary {
    const rows = this.db
      .prepare(`SELECT audit_json FROM settlement_audits WHERE archived = 0`)
      .all() as Array<{ audit_json: string }>;
    const summary: SettlementFinalitySummary = {
      atomic: 0,
      reassignmentMediated: 0,
      escrowFallback: 0,
      total: 0,
    };
    for (const row of rows) {
      const audit = JSON.parse(row.audit_json) as SettlementAuditSummary;
      summary.total += 1;
      if (audit.finality === "ReassignmentMediated") {
        summary.reassignmentMediated += 1;
      } else if (audit.finality === "EscrowFallback") {
        summary.escrowFallback += 1;
      } else {
        summary.atomic += 1;
      }
    }
    return summary;
  }

  getSettlementAudits(): SettlementAuditSummary[] {
    const rows = this.db
      .prepare(`SELECT audit_json FROM settlement_audits WHERE archived = 0`)
      .all() as Array<{ audit_json: string }>;
    return rows.map((r) => JSON.parse(r.audit_json) as SettlementAuditSummary);
  }

  upsertRegulatorGrant(grant: RegulatorJurisdictionGrantSummary, offset: string): void {
    this.db
      .prepare(
        `INSERT INTO regulator_grants (contract_id, grant_id, grant_json, offset, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(contract_id) DO UPDATE SET
           grant_id = excluded.grant_id,
           grant_json = excluded.grant_json,
           offset = excluded.offset,
           archived = 0`
      )
      .run(grant.contractId, grant.grantId, JSON.stringify(grant), offset);
  }

  archiveRegulatorGrants(contractIds: string[]): void {
    if (contractIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE regulator_grants SET archived = 1 WHERE contract_id = ?`
    );
    for (const id of contractIds) stmt.run(id);
  }

  getRegulatorGrants(): RegulatorJurisdictionGrantSummary[] {
    const rows = this.db
      .prepare(`SELECT grant_json FROM regulator_grants WHERE archived = 0`)
      .all() as Array<{ grant_json: string }>;
    return rows.map((r) => JSON.parse(r.grant_json) as RegulatorJurisdictionGrantSummary);
  }
}
