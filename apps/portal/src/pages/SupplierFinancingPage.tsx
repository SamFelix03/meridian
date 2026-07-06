import { useCallback, useEffect, useState } from "react";
import {
  api,
  useNotifications,
  type BidComparisonRow,
  type FinancingRequestSummary,
  type SupplierReceivable,
} from "../api";

function defaultDeadline(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

export function SupplierFinancingPage() {
  const [receivables, setReceivables] = useState<SupplierReceivable[]>([]);
  const [rounds, setRounds] = useState<FinancingRequestSummary[]>([]);
  const [bidMap, setBidMap] = useState<Record<string, BidComparisonRow[]>>({});
  const [parties, setParties] = useState<{ financierA: string; financierB: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [selectedReceivable, setSelectedReceivable] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [pricingMin, setPricingMin] = useState("0.01");
  const [pricingMax, setPricingMax] = useState("0.15");
  const [inviteA, setInviteA] = useState(true);
  const [inviteB, setInviteB] = useState(true);

  const [awardMsg, setAwardMsg] = useState("");
  const [postingId, setPostingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, roundsRes, p] = await Promise.all([
        api.getSupplierReceivables(),
        api.getFinancingRounds(),
        api.getParties(),
      ]);
      setReceivables(r.receivables);
      setRounds(roundsRes.rounds);
      setParties({ financierA: p.financierA, financierB: p.financierB });
      setError("");

      const openRounds = roundsRes.rounds.filter(
        (round) => round.roundState === "RoundOpen" || round.activeBidCount > 0
      );
      const bidEntries = await Promise.all(
        openRounds.map(async (round) => {
          try {
            const res = await api.getFinancingBids(round.contractId);
            return [round.contractId, res.bids] as const;
          } catch {
            return [round.contractId, []] as const;
          }
        })
      );
      setBidMap(Object.fromEntries(bidEntries));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useNotifications("meridian-supplier", refresh);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const issued = receivables.filter((r) => r.state === "Issued");
  const posted = receivables.filter((r) => r.state === "PostedForBid");

  async function handlePostForBid(contractId: string) {
    setPostingId(contractId);
    try {
      await api.postReceivableForBid(contractId);
      await refresh();
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setPostingId(null);
    }
  }

  async function handleOpenRound(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedReceivable || !parties) return;
    const financiers: string[] = [];
    if (inviteA) financiers.push(parties.financierA);
    if (inviteB) financiers.push(parties.financierB);
    if (financiers.length === 0) {
      setError("Select at least one financier");
      return;
    }
    try {
      await api.openFinancingRound({
        receivableCid: selectedReceivable,
        financiers,
        deadline: new Date(deadline).toISOString(),
        pricingBandMin: pricingMin,
        pricingBandMax: pricingMax,
      });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleAward(
    requestId: string,
    bidContractId: string,
    advanceAmount: string,
    financierPartyId: string
  ) {
    try {
      setAwardMsg("");
      await api.awardFinancingBid(requestId, bidContractId, advanceAmount, financierPartyId);
      setAwardMsg(
        `Award confirmed with atomic DvP — MUSD advance (${advanceAmount}) settled to supplier.`
      );
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handlePause(requestId: string) {
    try {
      await api.pauseFinancingRound(requestId);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleStaticFallback(requestId: string) {
    try {
      await api.staticFallbackFinancingRound(requestId);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleExpire(requestId: string) {
    try {
      await api.expireFinancingRound(requestId);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div>
      <h1>Supplier Financing</h1>
      <p>Configure sealed-bid rounds, compare oracle-anchored bids, and award atomically.</p>
      {error && <p className="error">{error}</p>}
      {awardMsg && <p className="success">{awardMsg}</p>}

      {issued.length > 0 && (
        <>
          <h2>Ready to post ({issued.length})</h2>
          <p>After buyer co-sign, post receivables for bid before opening a financing round.</p>
          {issued.map((r) => (
            <div key={r.contractId} className="card">
              <strong>{r.receivableId}</strong>{" "}
              <span className="badge">{r.state}</span>
              <p>
                {r.faceValue} {r.currency} · due {r.dueDate}
              </p>
              <button
                type="button"
                onClick={() => handlePostForBid(r.contractId)}
                disabled={postingId === r.contractId}
              >
                {postingId === r.contractId ? "Posting…" : "Post for bid"}
              </button>
            </div>
          ))}
        </>
      )}

      <h2>Open Financing Round</h2>
      <form onSubmit={handleOpenRound}>
        <label>
          Receivable (PostedForBid)
          <select
            value={selectedReceivable}
            onChange={(e) => setSelectedReceivable(e.target.value)}
            required
          >
            <option value="">Select receivable…</option>
            {posted.map((r) => (
              <option key={r.contractId} value={r.contractId}>
                {r.receivableId} — {r.faceValue} {r.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Deadline
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        <label>
          Pricing band min (decimal rate)
          <input value={pricingMin} onChange={(e) => setPricingMin(e.target.value)} />
        </label>
        <label>
          Pricing band max (decimal rate)
          <input value={pricingMax} onChange={(e) => setPricingMax(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={inviteA} onChange={(e) => setInviteA(e.target.checked)} />
          Invite Financier A
        </label>
        <label>
          <input type="checkbox" checked={inviteB} onChange={(e) => setInviteB(e.target.checked)} />
          Invite Financier B
        </label>
        <button type="submit" disabled={posted.length === 0}>
          Open Round
        </button>
      </form>
      {posted.length === 0 && (
        <p className="error">No receivables in PostedForBid state — issue and post one first.</p>
      )}

      <h2>Financing Rounds ({rounds.length})</h2>
      {rounds.map((round) => (
        <div key={round.contractId} className="card">
          <strong>{round.requestId}</strong>{" "}
          <span className="badge">{round.roundState}</span>
          <p>
            Deadline: {round.deadline} · Band {round.pricingBandMin}–{round.pricingBandMax} ·{" "}
            {round.activeBidCount} active bid(s)
          </p>
          <p>Receivable: {round.receivableCid.slice(0, 28)}…</p>

          {(round.roundState === "RoundOpen" ||
            round.roundState === "StaticReferenceFallback" ||
            round.roundState === "Paused") && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {round.roundState === "RoundOpen" && (
                <>
                  <button type="button" className="secondary" onClick={() => handlePause(round.contractId)}>
                    Pause Round
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleStaticFallback(round.contractId)}
                  >
                    Enter Static Reference Fallback
                  </button>
                </>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => handleExpire(round.contractId)}
              >
                Expire Round (post-deadline)
              </button>
            </div>
          )}

          <h3>Bid Comparison</h3>
          {(bidMap[round.contractId] ?? []).length === 0 ? (
            <p>No bids yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Financier</th>
                  <th>Advance</th>
                  <th>Discount</th>
                  <th>Effective Rate</th>
                  <th>Mode</th>
                  <th>Oracle</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(bidMap[round.contractId] ?? []).map((bid) => (
                  <tr key={bid.bidContractId}>
                    <td>{bid.rank}</td>
                    <td>{bid.financier.slice(0, 18)}…</td>
                    <td>{bid.advanceAmount}</td>
                    <td>{bid.discountRate}</td>
                    <td>{bid.effectiveRate}</td>
                    <td>{bid.mode}</td>
                    <td>{bid.oracleFresh ? "fresh" : "stale"}</td>
                    <td>
                      {round.roundState === "RoundOpen" ||
                      round.roundState === "StaticReferenceFallback" ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleAward(
                              round.contractId,
                              bid.bidContractId,
                              bid.advanceAmount,
                              bid.financier
                            )
                          }
                        >
                          Award (DvP)
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
