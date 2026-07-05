import type { MeridianNotificationEvent } from "@meridian/shared-types";

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function parseOptionalText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "object") {
    const tagged = raw as Record<string, unknown>;
    if (tagged.tag === "Some") return str(tagged.value);
    return null;
  }
  const text = str(raw);
  return text || null;
}

function activeBidCount(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const obj = raw as Record<string, unknown>;
  const entries = (obj.map as unknown[] | undefined) ?? (Array.isArray(raw) ? raw : undefined);
  return entries?.length ?? 0;
}

export function parseNotificationEvents(events: unknown[]): MeridianNotificationEvent[] {
  const out: MeridianNotificationEvent[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const obj = ev as Record<string, unknown>;

    const exercised =
      (obj.ExercisedEvent as Record<string, unknown> | undefined) ??
      (obj.exercisedEvent as Record<string, unknown> | undefined);
    if (exercised) {
      const choice = str(exercised.choice);
      if (choice.includes("MarkOverdue")) {
        out.push({
          type: "receivable.overdue",
          receivableId: str(exercised.contractId),
          contractId: str(exercised.contractId),
        });
      }
      if (choice.includes("RepayWithProof")) {
        out.push({
          type: "syndication.waterfall_distributed",
          receivableId: str(exercised.contractId),
          contractId: str(exercised.contractId),
        });
      }
    }

    const created =
      (obj.CreatedEvent as Record<string, unknown> | undefined) ??
      (obj.createdEvent as Record<string, unknown> | undefined);
    if (!created) continue;

    const templateId = String(created.templateId ?? "");
    const contractId = String(created.contractId ?? "");
    const args =
      (created.createArgument as Record<string, unknown> | undefined) ??
      (created.createArguments as Record<string, unknown> | undefined) ??
      {};

    if (templateId.includes("Receivable:Receivable") && !templateId.includes("Proposal")) {
      out.push({
        type: "receivable.issued",
        receivableId: String(args.receivableId ?? args.proposalId ?? ""),
        contractId,
      });
    }

    if (templateId.includes("ReceivableProposal")) {
      out.push({
        type: "receivable.proposed",
        proposalId: String(args.proposalId ?? ""),
        contractId,
      });
    }

    if (templateId.includes("AssignmentConsentPolicy")) {
      out.push({
        type: "consent.created",
        masterAgreementId: String(args.masterAgreementId ?? ""),
        contractId,
      });
    }

    if (templateId.includes("FinancingRequest:FinancingRequest")) {
      const requestId = str(args.requestId);
      const roundState = str(args.roundState);
      const bids = activeBidCount(args.activeBids);
      const bidHistory = Array.isArray(args.bidHistory) ? args.bidHistory : [];

      if (roundState === "RoundOpen" && bids === 0 && bidHistory.length === 0) {
        out.push({ type: "round.opened", requestId, contractId });
      } else if (roundState === "Paused" || roundState === "StaticReferenceFallback") {
        out.push({ type: "round.paused", requestId, contractId });
      } else if (roundState === "Awarded") {
        const historyEntry = bidHistory.length > 0 ? str(bidHistory[0]) : "";
        const winningBidCid = historyEntry.split(":")[2] ?? "";
        out.push({
          type: "round.awarded",
          requestId,
          contractId,
          winningBidCid,
        });
      }
    }

    if (
      templateId.includes("Financing.Bid:Bid") ||
      (templateId.includes(":Bid:Bid") && templateId.includes("Financing"))
    ) {
      const viaAgent = Boolean(args.viaAgent);
      const mandateId = parseOptionalText(args.mandateId);
      if (viaAgent && mandateId) {
        out.push({
          type: "agent.bid_submitted",
          requestId: str(args.requestId),
          bidContractId: contractId,
          financier: str(args.financier),
          mandateId,
        });
      } else {
        out.push({
          type: "bid.submitted",
          requestId: str(args.requestId),
          bidContractId: contractId,
          financier: str(args.financier),
        });
      }
    }

    if (templateId.includes("BiddingMandate:BiddingMandate")) {
      out.push({
        type: "mandate.created",
        mandateId: str(args.mandateId),
        contractId,
        financier: str(args.financier),
      });
    }
    if (templateId.includes("RepaymentProof")) {
      out.push({
        type: "receivable.repaid",
        receivableId: str(args.receivableId),
        contractId,
      });
    }

    if (templateId.includes("SyndicationOffering:SyndicationOffering")) {
      const offeringId = str(args.offeringId);
      const roundState = str(args.roundState);
      const bidHistory = Array.isArray(args.bidHistory) ? args.bidHistory : [];
      if (roundState === "RoundOpen" && bidHistory.length === 0) {
        out.push({ type: "syndication.opened", offeringId, contractId });
      } else if (roundState === "Awarded") {
        const historyEntry = bidHistory.length > 0 ? str(bidHistory[0]) : "";
        const winningBidCid = historyEntry.split(":")[2] ?? "";
        out.push({ type: "syndication.awarded", offeringId, contractId, winningBidCid });
      }
    }

    if (templateId.includes("SyndicationBid:SyndicationBid")) {
      out.push({
        type: "syndication.bid_submitted",
        offeringId: str(args.offeringId),
        bidContractId: contractId,
        participant: str(args.participant),
      });
    }
  }
  return out;
}
