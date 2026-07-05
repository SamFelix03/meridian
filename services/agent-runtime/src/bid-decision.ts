import type { GroqBidProposal } from "./types.js";

export function parseGroqBidProposal(raw: string): GroqBidProposal {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const shouldBid = Boolean(parsed.shouldBid);
  const advanceAmount = String(parsed.advanceAmount ?? "0");
  const discountRate = String(parsed.discountRate ?? "0");
  const rationale = String(parsed.rationale ?? "");
  if (!advanceAmount || !discountRate) {
    throw new Error("Groq response missing advanceAmount or discountRate");
  }
  return { advanceAmount, discountRate, shouldBid, rationale };
}
