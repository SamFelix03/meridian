import type { FetchResult } from "@meridian/shared-types";
import {
  buildSubmitBidCommand,
  extractCreatedContractId,
  LedgerClientError,
  oracleAnchoredMode,
  type JsonLedgerClient,
} from "@meridian/ledger-client";
import { requestGroqBidDecision } from "./groq-client.js";
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

    try {
      const [{ invitations }, { mandates }, oracle] = await Promise.all([
        fetchJson<{ invitations: FinancierInvitation[] }>(
          `${this.config.financierIndexerUrl}/financier/invitations`
        ),
        fetchJson<{ mandates: BiddingMandateSummary[] }>(
          `${this.config.financierIndexerUrl}/financier/mandates`
        ),
        fetchJson<FetchResult>(`${this.config.oracleRelayUrl}/feeds/latest`),
      ]);

      const mandate = pickActiveMandate(mandates);
      if (!mandate) {
        throw new Error("no active agent-enabled bidding mandate found");
      }

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
          let proposal: GroqBidProposal;
          if (this.config.adversarialMode) {
            proposal = {
              shouldBid: true,
              advanceAmount: mandate.maxExposure,
              discountRate: mandate.minSpread,
              rationale: "adversarial mode: deliberate out-of-mandate bid",
            };
          } else {
            proposal = await requestGroqBidDecision({
              apiKey: this.config.groqApiKey,
              model: this.config.groqModel,
              context: {
                invitation: inv,
                mandate,
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
            decisions.push(decision);
            continue;
          }

          let advanceAmount = proposal.advanceAmount;
          if (this.config.adversarialMode) {
            advanceAmount = inflateForAdversarial(advanceAmount, mandate.maxExposure);
            decision.advanceAmount = advanceAmount;
            decision.rationale = `${proposal.rationale} [adversarial: inflated advance]`;
          }

          const cmd = buildSubmitBidCommand({
            requestContractId: inv.contractId,
            financier: this.config.financierPartyId,
            advanceAmount,
            discountRate: proposal.discountRate,
            redstonePayload: oracle.canton.payloadHex,
            redstoneTimestampMs: oracle.packageTimestampMs,
            mode,
            ledgerTime,
            viaAgent: true,
            mandateContractId: mandate.contractId,
          });

          const result = await client.submitAndWaitForTransaction({
            actAs: [this.config.financierPartyId],
            commands: [cmd],
          });

          decision.submitted = true;
          decision.bidContractId = extractCreatedContractId(result, "Bid") ?? undefined;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          decision.ledgerError = message;
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
