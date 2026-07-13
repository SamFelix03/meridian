import Database from "better-sqlite3";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { RawLedgerEvent, IndexerCheckpoint } from "@meridian/shared-types";
import { JsonLedgerClient, LedgerClientError, hashEvents } from "@meridian/ledger-client";
import { ProjectionStore } from "./projection-store.js";
import {
  extractArchivedContractIds,
  extractCreatedEvents,
  isConsentPolicyTemplate,
  isReceivableProposalTemplate,
  isReceivableTemplate,
  projectBuyerView,
  projectConsentPolicy,
  projectProposal,
  projectSupplierView,
  projectRepaymentProof,
  isRepaymentProofTemplate,
  projectLeadFinancierView,
} from "./receivable-projector.js";
import {
  isBidTemplate,
  isFinancingRequestTemplate,
  projectBid,
  projectFinancingRequest,
} from "./financing-projector.js";
import {
  isBiddingMandateTemplate,
  projectBiddingMandate,
} from "./mandate-projector.js";
import { projectRegulatorView } from "./regulator-projector.js";
import {
  isSettlementAuditRecordTemplate,
  projectSettlementAuditRecord,
} from "./settlement-projector.js";
import {
  isRegulatorJurisdictionGrantTemplate,
  projectRegulatorJurisdictionGrant,
} from "./compliance-projector.js";
import {
  isParticipationInterestTemplate,
  isSyndicationBidTemplate,
  isSyndicationOfferingTemplate,
  projectParticipationInterest,
  projectSyndicationBid,
  projectSyndicationOffering,
} from "./syndication-projector.js";

/** Per-org isolated append-only event store — no cross-org shared DB. */
export class IndexerStore {
  private db: Database.Database;
  readonly projections: ProjectionStore;

  constructor(dbPath: string, rebuild: boolean) {
    if (rebuild && existsSync(dbPath)) {
      rmSync(dbPath, { force: true });
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raw_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offset TEXT NOT NULL,
        update_id TEXT NOT NULL,
        record_time TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoint (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_offset TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        last_event_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.projections = new ProjectionStore(this.db);
  }

  appendEvent(event: RawLedgerEvent): void {
    this.db
      .prepare(
        `INSERT INTO raw_events (offset, update_id, record_time, payload)
         VALUES (?, ?, ?, ?)`
      )
      .run(event.offset, event.updateId, event.recordTime, JSON.stringify(event.payload));
  }

  getAllEvents(): RawLedgerEvent[] {
    const rows = this.db
      .prepare(`SELECT offset, update_id, record_time, payload FROM raw_events ORDER BY id`)
      .all() as Array<{
      offset: string;
      update_id: string;
      record_time: string;
      payload: string;
    }>;
    return rows.map((r) => ({
      offset: r.offset,
      updateId: r.update_id,
      recordTime: r.record_time,
      payload: JSON.parse(r.payload),
    }));
  }

  saveCheckpoint(checkpoint: IndexerCheckpoint): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoint (id, last_offset, event_count, last_event_hash, updated_at)
         VALUES (1, ?, ?, ?, ?)`
      )
      .run(
        checkpoint.lastOffset,
        checkpoint.eventCount,
        checkpoint.lastEventHash,
        checkpoint.updatedAt
      );
  }

  getCheckpoint(): IndexerCheckpoint | null {
    const row = this.db
      .prepare(`SELECT last_offset, event_count, last_event_hash, updated_at FROM checkpoint WHERE id = 1`)
      .get() as
      | { last_offset: string; event_count: number; last_event_hash: string; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      lastOffset: row.last_offset,
      eventCount: row.event_count,
      lastEventHash: row.last_event_hash,
      updatedAt: row.updated_at,
    };
  }

  close(): void {
    this.db.close();
  }
}

export class ReplayIndexer {
  private store: IndexerStore;
  private client: JsonLedgerClient;
  private rebuildRecoveryAttempted = false;

  constructor(
    private config: {
      orgId: string;
      actingParty: string;
      role: "Supplier" | "Buyer" | "Financier" | "Regulator" | "PlatformOperator";
      jsonApiUrl: string;
      dataDir: string;
      rebuild: boolean;
      bearerToken?: string;
    }
  ) {
    const dbPath = `${config.dataDir}/${config.orgId}/indexer.db`;
    this.store = new IndexerStore(dbPath, config.rebuild);
    this.client = new JsonLedgerClient({
      baseUrl: config.jsonApiUrl,
      bearerToken: config.bearerToken,
      actingParty: config.actingParty,
    });
  }

  /** DevNet JSON API caps ACS responses at 200 contracts per party. */
  private async safeGetActiveContracts(): Promise<
    Awaited<ReturnType<JsonLedgerClient["getActiveContracts"]>>
  > {
    try {
      return await this.client.getActiveContracts(this.config.actingParty);
    } catch (err) {
      if (err instanceof LedgerClientError && err.code === "GET_ACS_FAILED") {
        console.warn(
          `ACS fetch skipped for ${this.config.orgId}: party exceeds ledger API list limit`
        );
        return [];
      }
      throw err;
    }
  }

  /** Detect first-run poison: ACS empty (200-contract cap) + cursor jumped to ledger end. */
  private isPoisonedCheckpoint(): boolean {
    const cp = this.store.getCheckpoint();
    if (!cp || cp.eventCount > 0) return false;

    const hasLedgerTransactions = this.store.getAllEvents().some((e) => {
      const payload = e.payload;
      if (payload == null || typeof payload !== "object") return true;
      return (payload as Record<string, unknown>).type !== "ACS_BOOTSTRAP";
    });
    if (hasLedgerTransactions) return false;

    switch (this.config.role) {
      case "Supplier":
        return (
          this.store.projections.getSupplierReceivables().length === 0 &&
          this.store.projections.getFinancingRounds().length === 0 &&
          this.store.projections.getPendingProposals().length === 0 &&
          this.store.projections.getConsentPolicies().length === 0
        );
      case "Buyer":
        return (
          this.store.projections.getBuyerObligations().length === 0 &&
          this.store.projections.getPendingProposals().length === 0
        );
      case "Financier":
        return (
          this.store.projections.getFinancierInvitations().length === 0 &&
          this.store.projections.getFinancierMyBids(this.config.actingParty).length === 0 &&
          this.store.projections.getFinancierMandates(this.config.actingParty).length === 0
        );
      case "PlatformOperator":
        return this.store.projections.getSettlementAudits().length === 0;
      case "Regulator":
        return this.store.projections.getRegulatorExposureRows().length === 0;
      default:
        return false;
    }
  }

  async runOnce(): Promise<IndexerCheckpoint> {
    if (this.isPoisonedCheckpoint()) {
      if (this.rebuildRecoveryAttempted) {
        console.warn(
          `[${this.config.orgId}] projections still empty after rebuild recovery — manual re-index may be required`
        );
      } else {
        this.rebuildRecoveryAttempted = true;
        console.warn(
          `[${this.config.orgId}] empty projections with no ledger history — rebuilding index`
        );
        return this.rebuild();
      }
    }

    const existing = this.store.getCheckpoint();
    let acsBootstrapped = 0;

    // Bootstrap ACS on first run
    if (!existing) {
      const contracts = await this.safeGetActiveContracts();
      acsBootstrapped = contracts.length;
      for (const c of contracts) {
        this.store.appendEvent({
          offset: "0",
          updateId: `acs-${c.contractId}`,
          recordTime: new Date().toISOString(),
          payload: { type: "ACS_BOOTSTRAP", contract: c },
        });
        this.projectContractCreate(c.templateId, c.contractId, c.payload as Record<string, unknown>, "0");
      }
      if (acsBootstrapped === 0) {
        console.warn(
          `[${this.config.orgId}] ACS bootstrap returned 0 contracts — replaying update stream from genesis`
        );
      }
    }

    const replayFromGenesis = !existing && acsBootstrapped === 0;
    let cursor: string | undefined =
      existing?.lastOffset && existing.lastOffset !== ""
        ? existing.lastOffset
        : replayFromGenesis
          ? "0"
          : undefined;

    const maxBatches = replayFromGenesis ? 100 : 1;
    let endOffset = cursor ?? "0";

    for (let batch = 0; batch < maxBatches; batch++) {
      const { updates, endOffset: batchEnd } = await this.client.getUpdates({
        party: this.config.actingParty,
        beginExclusive: cursor,
      });
      endOffset = batchEnd;

      for (const u of updates) {
        this.store.appendEvent({
          offset: u.offset,
          updateId: u.updateId,
          recordTime: u.recordTime,
          payload: u.events,
        });
        this.processTransactionEvents(u.events, u.offset, u.recordTime);
      }

      if (!replayFromGenesis || updates.length === 0 || batchEnd === cursor) {
        break;
      }
      cursor = batchEnd;
    }

    await this.reconcileActiveContracts();

    const allEvents = this.store.getAllEvents();
    const checkpoint: IndexerCheckpoint = {
      lastOffset: String(endOffset),
      eventCount: allEvents.length,
      lastEventHash: hashEvents(allEvents),
      updatedAt: new Date().toISOString(),
    };
    this.store.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  /** Backfill projections from ACS when the update stream skips visible contracts. */
  private async reconcileActiveContracts(): Promise<void> {
    const contracts = await this.safeGetActiveContracts();
    for (const c of contracts) {
      this.projectContractCreate(
        c.templateId,
        c.contractId,
        c.payload as Record<string, unknown>,
        "acs-reconcile"
      );
    }
  }

  async rebuild(): Promise<IndexerCheckpoint> {
    this.store.close();
    this.store = new IndexerStore(
      `${this.config.dataDir}/${this.config.orgId}/indexer.db`,
      true
    );
    return this.runOnce();
  }

  setBearerToken(token: string): void {
    this.client = new JsonLedgerClient({
      baseUrl: this.config.jsonApiUrl,
      bearerToken: token,
      actingParty: this.config.actingParty,
    });
  }

  getEventLogHash(): string {
    return hashEvents(this.store.getAllEvents());
  }

  getProjectionStore(): ProjectionStore {
    return this.store.projections;
  }

  private processTransactionEvents(events: unknown[], offset: string, recordTime?: string): void {
    for (const created of extractCreatedEvents(events)) {
      this.projectContractCreate(
        created.templateId,
        created.contractId,
        created.payload,
        offset,
        recordTime
      );
    }
    const archived = extractArchivedContractIds(events);
    this.store.projections.archiveProjections(archived);
    this.store.projections.archiveProposals(archived);
    this.store.projections.archiveFinancingRequests(archived);
    this.store.projections.archiveBids(archived);
    this.store.projections.archiveSyndicationOfferings(archived);
    this.store.projections.archiveSyndicationBids(archived);
    this.store.projections.archiveParticipationInterests(archived);
    this.store.projections.archiveMandates(archived);
    this.store.projections.archiveRegulatorExposure(archived);
    this.store.projections.archiveSettlementAudits(archived);
    this.store.projections.archiveRegulatorGrants(archived);
  }

  private projectContractCreate(
    templateId: string,
    contractId: string,
    payload: Record<string, unknown>,
    offset: string,
    recordTime?: string
  ): void {
    const party = this.config.actingParty;

    if (isReceivableTemplate(templateId)) {
      if (this.config.role === "Buyer") {
        const view = projectBuyerView(contractId, payload);
        this.store.projections.upsertProjection({
          contractId,
          interfaceName: "IBuyerView",
          party,
          viewJson: view,
          offset,
          archived: false,
        });
      }
      if (this.config.role === "Supplier" || this.config.role === "Financier") {
        const view = projectSupplierView(contractId, payload);
        this.store.projections.upsertProjection({
          contractId,
          interfaceName: "ISupplierView",
          party,
          viewJson: view,
          offset,
          archived: false,
        });
      }
      if (this.config.role === "Financier") {
        const payeeOfRecord = payload.payeeOfRecord as Record<string, unknown> | undefined;
        const payee = String(payeeOfRecord?.payee ?? "");
        if (payee === party) {
          const leadView = projectLeadFinancierView(contractId, payload);
          this.store.projections.upsertProjection({
            contractId,
            interfaceName: "ILeadFinancierView",
            party,
            viewJson: leadView,
            offset,
            archived: false,
          });
        }
      }
      if (this.config.role === "Regulator") {
        const view = projectRegulatorView(contractId, payload);
        this.store.projections.upsertRegulatorExposure(view, offset);
        this.store.projections.upsertProjection({
          contractId,
          interfaceName: "IRegulatorView",
          party,
          viewJson: view,
          offset,
          archived: false,
        });
      }
    }

    if (isReceivableProposalTemplate(templateId)) {
      const proposal = projectProposal(contractId, payload);
      this.store.projections.upsertProposal(proposal, offset, recordTime);
    }

    if (isConsentPolicyTemplate(templateId)) {
      const policy = projectConsentPolicy(contractId, payload);
      this.store.projections.upsertConsentPolicy(policy, offset);
    }

    if (isFinancingRequestTemplate(templateId)) {
      const request = projectFinancingRequest(contractId, payload);
      this.store.projections.upsertFinancingRequest(request, offset);
    }

    if (isBidTemplate(templateId)) {
      const bid = projectBid(contractId, payload);
      this.store.projections.upsertBid(bid, offset);
    }

    if (isRepaymentProofTemplate(templateId) && this.config.role === "Supplier") {
      const proof = projectRepaymentProof(contractId, payload);
      this.store.projections.upsertRepaymentProof(proof, offset);
    }

    if (isSyndicationOfferingTemplate(templateId) && this.config.role === "Financier") {
      const offering = projectSyndicationOffering(contractId, payload);
      this.store.projections.upsertSyndicationOffering(offering, offset);
    }

    if (isSyndicationBidTemplate(templateId) && this.config.role === "Financier") {
      const bid = projectSyndicationBid(contractId, payload);
      this.store.projections.upsertSyndicationBid(bid, offset);
    }

    if (isParticipationInterestTemplate(templateId) && this.config.role === "Financier") {
      const interest = projectParticipationInterest(contractId, payload);
      this.store.projections.upsertParticipationInterest(interest, offset);
    }

    if (isBiddingMandateTemplate(templateId) && this.config.role === "Financier") {
      const mandate = projectBiddingMandate(contractId, payload);
      this.store.projections.upsertBiddingMandate(mandate, offset);
    }

    if (isSettlementAuditRecordTemplate(templateId) && this.config.role === "PlatformOperator") {
      const audit = projectSettlementAuditRecord(contractId, payload);
      this.store.projections.upsertSettlementAudit(audit, offset);
    }

    if (
      isRegulatorJurisdictionGrantTemplate(templateId) &&
      this.config.role === "PlatformOperator"
    ) {
      const grant = projectRegulatorJurisdictionGrant(contractId, payload);
      this.store.projections.upsertRegulatorGrant(grant, offset);
    }
  }

  close(): void {
    this.store.close();
  }
}
