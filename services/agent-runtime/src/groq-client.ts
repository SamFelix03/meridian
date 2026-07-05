import type { FinancierInvitation, GroqBidProposal, BiddingMandateSummary } from "./types.js";
import { parseGroqBidProposal } from "./bid-decision.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqDecisionContext {
  invitation: FinancierInvitation;
  mandate: BiddingMandateSummary;
  sofrRate: number;
  oracleFresh: boolean;
}

export async function requestGroqBidDecision(params: {
  apiKey: string;
  model: string;
  context: GroqDecisionContext;
}): Promise<GroqBidProposal> {
  const { invitation, mandate, sofrRate, oracleFresh } = params.context;
  const systemPrompt = [
    "You are a financier bidding agent for invoice financing.",
    "Respond with strict JSON only — no markdown.",
    'Schema: {"advanceAmount":"decimal string","discountRate":"decimal string","shouldBid":boolean,"rationale":"string"}',
    "advanceAmount is the cash advance offered to the supplier.",
    "discountRate is the financier discount rate as a decimal (e.g. 0.05 for 5%).",
    "Only bid when economics are attractive within mandate limits.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    invitation: {
      requestId: invitation.requestId,
      supplier: invitation.supplier,
      deadline: invitation.deadline,
      pricingBandMin: invitation.pricingBandMin,
      pricingBandMax: invitation.pricingBandMax,
      roundState: invitation.roundState,
    },
    mandate: {
      mandateId: mandate.mandateId,
      maxExposure: mandate.maxExposure,
      minSpread: mandate.minSpread,
      eligibleSuppliers: mandate.eligibleSuppliers,
    },
    market: {
      sofrReferenceRate: sofrRate,
      oracleFresh,
    },
  });

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API ${res.status}: ${body}`);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq API returned empty content");
  }
  return parseGroqBidProposal(content);
}
