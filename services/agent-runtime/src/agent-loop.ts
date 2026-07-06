import type { FetchResult } from "@meridian/shared-types";
import {
  buildSubmitBidCommand,
  extractCreatedContractId,
  LedgerClientError,
  oracleAnchoredMode,
  packageIdFromTemplateId,
  pickMandateForRequestPackage,
  resolveFinancingRequestTemplateId,
  resolveMandateTemplateMap,
  isLegacyFinancingRequestPackage,
  type JsonLedgerClient,
} from "@meridian/ledger-client";
import { requestGroqBidDecision } from "./groq-client.js";
import { capAdvanceAmount } from "./bid-sizing.js";
import type {
  AgentBidDecision,
  AgentLoopConfig,
  AgentRunStatus,
  BiddingMandateSummary,
  BidSummary,
  FinancierInvitation,
  GroqBidProposal,
} from "./types.js";

function inflateForAdversarial(advance: string, maxExposure: string): string {
  const max = Number(maxExposure);
  const inflated = Math.max(max * 2, Number(advance) * 3, max + 1000);
  return String(inflated);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function pickActiveMandate(mandates: BiddingMandateSummary[]): BiddingMandateSummary | null {
  return (
    mandates.find((m) => m.agentEnabled && !m.revoked) ??
    mandates.find((m) => !m.revoked) ??
    null
  );
}

function invitationOpen(inv: FinancierInvitation): boolean {
  return inv.roundState === "RoundOpen" || inv.roundState === "StaticReferenceFallback";
}

export class AgentLoop {
  private status: AgentRunStatus;
  private ticking = false;

  constructor(private config: AgentLoopConfig) {
    this.status = {
      lastTickAt: null,
      lastTickDurationMs: null,
      lastError: null,
      adversarialMode: config.adversarialMode,
      decisions: [],
      groqModel: config.groqModel,
    };
  }

  getStatus(): AgentRunStatus {
    return this.status;
  }

  async runTick(client: JsonLedgerClient): Promise<AgentRunStatus> {
    if (this.ticking) {
      throw new Error("agent tick already in progress");
    }
    this.ticking = true;
    const started = Date.now();
    const decisions: AgentBidDecision[] = [];
    console.log("[agent-runtime] tick start");

    try {
      const [{ invitations: rawInvitations }, { mandates }, oracle, { receivables }] =
        await Promise.all([
        fetchJson<{ invitations: FinancierInvitation[] }>(
          `${this.config.financierIndexerUrl}/financier/invitations`
        ),
        fetchJson<{ mandates: BiddingMandateSummary[] }>(
          `${this.config.financierIndexerUrl}/financier/mandates`
        ),
        fetchJson<FetchResult>(`${this.config.oracleRelayUrl}/feeds/latest`),
        fetchJson<{ receivables: Array<{ contractId: string; faceValue: string; currency: string }> }>(
          `${this.config.supplierIndexerUrl}/supplier/receivables`
        ),
      ]);

      const receivableByCid = new Map(receivables.map((r) => [r.contractId, r]));
      const invitations = rawInvitations.map((inv) => {
        const recv = inv.receivableCid ? receivableByCid.get(inv.receivableCid) : undefined;
        return {
          ...inv,
          faceValue: recv?.faceValue ?? inv.faceValue ?? "",
          currency: recv?.currency ?? inv.currency ?? "USD",
        };
      });

      const activeMandates = mandates.filter((m) => !m.revoked);
      if (activeMandates.length === 0) {
        throw new Error("no bidding mandate found — create one on Financier tab");
      }

      const mandateTemplateByCid = await resolveMandateTemplateMap(
        client,
        this.config.financierPartyId,
        activeMandates.map((m) => m.contractId)
      );

      const defaultMandate = pickActiveMandate(mandates);
      if (!defaultMandate) {
        throw new Error("no active agent-enabled bidding mandate found");
      }
      console.log(
        `[agent-runtime] defaultMandate=${defaultMandate.mandateId} maxExposure=${defaultMandate.maxExposure} invitations=${invitations.length} oracleFresh=${oracle.isFresh}`
      );

      const { bids: myBids } = await fetchJson<{ bids: BidSummary[] }>(
        `${this.config.financierIndexerUrl}/financier/my-bids`
      );
      const bidRequestIds = new Set(myBids.map((b) => b.requestId));

      const sofrRate =
        oracle.referenceRate != null ? oracle.referenceRate.value / 100 : 0.0366;
      const mode = oracleAnchoredMode();
      const ledgerTime = new Date(oracle.packageTimestampMs).toISOString();

      for (const inv of invitations) {
        if (!invitationOpen(inv)) continue;
        if (bidRequestIds.has(inv.requestId)) continue;

        console.log(`[agent-runtime] evaluating ${inv.requestId} (${inv.roundState})`);

        const decision: AgentBidDecision = {
          requestId: inv.requestId,
          requestContractId: inv.contractId,
          shouldBid: false,
          advanceAmount: "0",
          discountRate: "0",
          rationale: "",
          submitted: false,
        };

        try {
          const requestTemplateId = await resolveFinancingRequestTemplateId(
            client,
            [this.config.financierPartyId, inv.supplier],
            inv.contractId
          );
          const legacy = isLegacyFinancingRequestPackage(requestTemplateId);
          const requestPkg = packageIdFromTemplateId(requestTemplateId);

          let mandateForBid = defaultMandate;
          if (!legacy) {
            const matched = pickMandateForRequestPackage(
              activeMandates,
              mandateTemplateByCid,
              requestTemplateId
            );
            if (!matched) {
              decision.ledgerError = `no mandate matching round package ${requestPkg.slice(0, 12)}… — create a new mandate on Financier tab (old v5 mandates cannot agent-bid on v6 rounds)`;
              console.warn(`[agent-runtime] ${inv.requestId} skipped: ${decision.ledgerError}`);
              decisions.push(decision);
              continue;
            }
            mandateForBid =
              activeMandates.find((m) => m.contractId === matched.mandate.contractId) ??
              defaultMandate;
            console.log(
              `[agent-runtime] ${inv.requestId} using mandate ${mandateForBid.mandateId} package=${requestPkg.slice(0, 12)}…`
            );
          }

          let proposal: GroqBidProposal;
          if (this.config.adversarialMode) {
            proposal = {
              shouldBid: true,
              advanceAmount: mandateForBid.maxExposure,
              discountRate: mandateForBid.minSpread,
              rationale: "adversarial mode: deliberate out-of-mandate bid",
            };
          } else {
            proposal = await requestGroqBidDecision({
              apiKey: this.config.groqApiKey,
              model: this.config.groqModel,
              context: {
                invitation: inv,
                mandate: mandateForBid,
                sofrRate,
                oracleFresh: oracle.isFresh,
              },
            });
          }

          decision.shouldBid = proposal.shouldBid;
          decision.advanceAmount = proposal.advanceAmount;
          decision.discountRate = proposal.discountRate;
          decision.rationale = proposal.rationale;

          if (!proposal.shouldBid) {
            console.log(`[agent-runtime] ${inv.requestId} Groq: no bid — ${proposal.rationale}`);
            decisions.push(decision);
            continue;
          }

          let advanceAmount = capAdvanceAmount(
            proposal.advanceAmount,
            inv.faceValue,
            mandateForBid.maxExposure
          );
          if (advanceAmount !== proposal.advanceAmount) {
            decision.rationale = `${proposal.rationale} [capped advance ${proposal.advanceAmount} → ${advanceAmount} vs face ${inv.faceValue}]`;
          }

          if (this.config.adversarialMode) {
            advanceAmount = inflateForAdversarial(advanceAmount, mandateForBid.maxExposure);
            decision.advanceAmount = advanceAmount;
            decision.rationale = `${decision.rationale || proposal.rationale} [adversarial: inflated advance]`;
          } else {
            decision.advanceAmount = advanceAmount;
          }

          const cmd = buildSubmitBidCommand({
            requestContractId: inv.contractId,
            requestTemplateId,
            financier: this.config.financierPartyId,
            advanceAmount,
            discountRate: proposal.discountRate,
            redstonePayload: oracle.canton.payloadHex,
            redstoneTimestampMs: oracle.packageTimestampMs,
            mode,
            ledgerTime,
            viaAgent: !legacy,
            mandateContractId: legacy ? null : mandateForBid.contractId,
          });

          const result = await client.submitAndWaitForTransaction({
            actAs: [this.config.financierPartyId],
            commands: [cmd],
          });

          decision.submitted = true;
          decision.bidContractId = extractCreatedContractId(result, "Bid") ?? undefined;
          console.log(
            `[agent-runtime] ${inv.requestId} bid submitted advance=${advanceAmount} rate=${proposal.discountRate} cid=${decision.bidContractId?.slice(0, 16) ?? "?"}…`
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          decision.ledgerError = message;
          console.error(`[agent-runtime] ${inv.requestId} submit failed:`, message);
          if (!(err instanceof LedgerClientError)) {
            decision.rationale = decision.rationale || message;
          }
        }

        decisions.push(decision);
      }

      this.status = {
        ...this.status,
        lastTickAt: new Date().toISOString(),
        lastTickDurationMs: Date.now() - started,
        lastError: null,
        decisions,
      };
      const submitted = decisions.filter((d) => d.submitted).length;
      console.log(
        `[agent-runtime] tick done ${Date.now() - started}ms decisions=${decisions.length} submitted=${submitted}`
      );
      return this.status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = {
        ...this.status,
        lastTickAt: new Date().toISOString(),
        lastTickDurationMs: Date.now() - started,
        lastError: message,
        decisions,
      };
      throw err;
    } finally {
      this.ticking = false;
    }
  }
}
