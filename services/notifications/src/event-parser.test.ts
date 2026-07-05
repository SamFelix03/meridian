import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNotificationEvents } from "./event-parser.js";

describe("event-parser", () => {
  it("detects receivable issued events", () => {
    const events = [
      {
        CreatedEvent: {
          contractId: "cid-1",
          templateId: "#com-meridian-receivable-v6:Meridian.Receivable.Receivable:Receivable",
          createArgument: { receivableId: "INV-1" },
        },
      },
    ];
    const parsed = parseNotificationEvents(events);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.type, "receivable.issued");
  });

  it("detects proposal events", () => {
    const events = [
      {
        CreatedEvent: {
          contractId: "cid-2",
          templateId: "#com-meridian-receivable-v6:Meridian.Receivable.ReceivableProposal:ReceivableProposal",
          createArgument: { proposalId: "PROP-1" },
        },
      },
    ];
    const parsed = parseNotificationEvents(events);
    assert.equal(parsed[0]!.type, "receivable.proposed");
  });

  it("detects financing round opened events", () => {
    const events = [
      {
        CreatedEvent: {
          contractId: "req-1",
          templateId:
            "#com-meridian-receivable-v6:Meridian.Financing.FinancingRequest:FinancingRequest",
          createArgument: {
            requestId: "ROUND-1",
            roundState: "RoundOpen",
            activeBids: { map: [] },
            bidHistory: [],
          },
        },
      },
    ];
    const parsed = parseNotificationEvents(events);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.type, "round.opened");
  });

  it("detects bid submitted events", () => {
    const events = [
      {
        CreatedEvent: {
          contractId: "bid-1",
          templateId: "#com-meridian-receivable-v6:Meridian.Financing.Bid:Bid",
          createArgument: {
            requestId: "ROUND-1",
            financier: "fin-a::abc",
          },
        },
      },
    ];
    const parsed = parseNotificationEvents(events);
    assert.equal(parsed[0]!.type, "bid.submitted");
  });
});
