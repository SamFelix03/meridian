import { useCallback, useEffect, useState } from "react";
import type { AgentRunStatus, BiddingMandateSummary } from "@meridian/shared-types";
import {
  api,
  useNotifications,
  type BidSummary,
  type FinancierInvitation,
} from "../api";

export function FinancierPage() {
  const [invitations, setInvitations] = useState<FinancierInvitation[]>([]);
  const [myBids, setMyBids] = useState<BidSummary[]>([]);
  const [mandates, setMandates] = useState<BiddingMandateSummary[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentRunStatus | null>(null);
  const [positions, setPositions] = useState<
    Array<{ receivableId: string; state: string; faceValue: string }>
  >([]);
  const [error, setError] = useState("");
  const [advanceByRound, setAdvanceByRound] = useState<Record<string, string>>({});
  const [discountByRound, setDiscountByRound] = useState<Record<string, string>>({});
  const [mandateForm, setMandateForm] = useState({
    mandateId: `mandate-${Date.now()}`,
    maxExposure: "2000",
    minSpread: "0.03",
    eligibleSuppliers: "",
    agentEnabled: true,
  });

  const refresh = useCallback(async () => {
    try {
      const [inv, bids, pos, mandateRes, agentRes] = await Promise.all([
        api.getFinancierInvitations(),
        api.getFinancierMyBids(),
        api.getFinancierPositions().catch(() => ({ positions: [] })),
        api.getFinancierMandates().catch(() => ({ mandates: [] })),
        api.getAgentStatus().catch(() => null),
      ]);
      setInvitations(inv.invitations);
      setMyBids(bids.bids);
      setMandates(mandateRes.mandates);
      setAgentStatus(agentRes);
      setPositions(
        (pos.positions ?? []).map((p) => ({
          receivableId: p.receivableId,
          state: p.state,
          faceValue: p.faceValue,
        }))
      );
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useNotifications("meridian-financier-a", refresh);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSubmitBid(
    requestContractId: string,
    requestId: string,
    useStaticReference: boolean
  ) {
    const advanceAmount = advanceByRound[requestContractId] ?? "1000";
    const discountRate = discountByRound[requestContractId] ?? "0.05";
    const hasBid = myBids.some((b) => b.requestId === requestId);
    try {
      const submit = hasBid ? api.replaceFinancingBid : api.submitFinancingBid;
      const result = await submit(requestContractId, {
        advanceAmount,
        discountRate,
        useStaticReference,
      });
      if (!result.oracleFresh) {
        setError("Warning: oracle feed was stale — bid may be rejected on-ledger.");
      } else {
        setError("");
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateMandate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createFinancierMandate({
        mandateId: mandateForm.mandateId,
        maxExposure: mandateForm.maxExposure,
        minSpread: mandateForm.minSpread,
        eligibleSuppliers: mandateForm.eligibleSuppliers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        agentEnabled: mandateForm.agentEnabled,
      });
      setMandateForm((f) => ({ ...f, mandateId: `mandate-${Date.now()}` }));
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleAgentTick() {
    try {
      const status = await api.triggerAgentTick();
      setAgentStatus(status);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleAgentEnabled(mandate: BiddingMandateSummary) {
    try {
      await api.updateFinancierMandate(mandate.contractId, {
        action: "setAgentEnabled",
        agentEnabled: !mandate.agentEnabled,
      });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const activeMandate = mandates.find((m) => m.agentEnabled && !m.revoked);

  return (
    <div>
      <h1>Financier Desk</h1>
      <p>Sealed-bid deal flow — invitations visible only to invited financiers.</p>
      {error && <p className="error">{error}</p>}

      <h2>Agent bidding</h2>
      <div className="card">
        <p>
          Mandate-constrained agent uses Groq <code>openai/gpt-oss-120b</code>; the ledger enforces
          limits on <code>viaAgent</code> bids.
        </p>
        <p>
          Active mandate:{" "}
          {activeMandate
            ? `${activeMandate.mandateId} (max ${activeMandate.maxExposure}, min spread ${activeMandate.minSpread})`
            : "none"}
        </p>
        <button type="button" onClick={handleAgentTick}>
          Trigger agent tick
        </button>
        {agentStatus && (
          <div>
            <p>
              Last tick: {agentStatus.lastTickAt ?? "never"}
              {agentStatus.lastTickDurationMs != null
                ? ` (${agentStatus.lastTickDurationMs} ms)`
                : ""}
            </p>
            {agentStatus.lastError && (
              <p className="error">Agent error: {agentStatus.lastError}</p>
            )}
            {agentStatus.decisions.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Bid?</th>
                    <th>Advance</th>
                    <th>Rate</th>
                    <th>Submitted</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {agentStatus.decisions.map((d) => (
                    <tr key={d.requestContractId}>
                      <td>{d.requestId}</td>
                      <td>{d.shouldBid ? "yes" : "no"}</td>
                      <td>{d.advanceAmount}</td>
                      <td>{d.discountRate}</td>
                      <td>{d.submitted ? d.bidContractId?.slice(0, 12) ?? "yes" : "no"}</td>
                      <td>{d.ledgerError ?? d.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <h2>Bidding mandates ({mandates.length})</h2>
      <form className="card" onSubmit={handleCreateMandate}>
        <label>
          Mandate ID
          <input
            value={mandateForm.mandateId}
            onChange={(e) => setMandateForm((f) => ({ ...f, mandateId: e.target.value }))}
          />
        </label>
        <label>
          Max exposure
          <input
            value={mandateForm.maxExposure}
            onChange={(e) => setMandateForm((f) => ({ ...f, maxExposure: e.target.value }))}
          />
        </label>
        <label>
          Min spread (decimal)
          <input
            value={mandateForm.minSpread}
            onChange={(e) => setMandateForm((f) => ({ ...f, minSpread: e.target.value }))}
          />
        </label>
        <label>
          Eligible suppliers (comma-separated party ids, empty = any)
          <input
            value={mandateForm.eligibleSuppliers}
            onChange={(e) =>
              setMandateForm((f) => ({ ...f, eligibleSuppliers: e.target.value }))
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={mandateForm.agentEnabled}
            onChange={(e) =>
              setMandateForm((f) => ({ ...f, agentEnabled: e.target.checked }))
            }
          />{" "}
          Enable agent
        </label>
        <button type="submit">Create mandate on-ledger</button>
      </form>
      {mandates.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Max exposure</th>
              <th>Min spread</th>
              <th>Agent</th>
              <th>Revoked</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mandates.map((m) => (
              <tr key={m.contractId}>
                <td>{m.mandateId}</td>
                <td>{m.maxExposure}</td>
                <td>{m.minSpread}</td>
                <td>{m.agentEnabled ? "on" : "off"}</td>
                <td>{m.revoked ? "yes" : "no"}</td>
                <td>
                  {!m.revoked && (
                    <button type="button" onClick={() => toggleAgentEnabled(m)}>
                      {m.agentEnabled ? "Disable agent" : "Enable agent"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Invitations ({invitations.length})</h2>
      {invitations.length === 0 && <p>No open invitations.</p>}
      {invitations.map((inv) => (
        <div key={inv.contractId} className="card">
          <strong>{inv.requestId}</strong>{" "}
          <span className="badge">{inv.roundState}</span>
          <p>
            Supplier: {inv.supplier.slice(0, 24)}… · Deadline {inv.deadline}
          </p>
          <p>
            Pricing band {inv.pricingBandMin}–{inv.pricingBandMax}
          </p>
          <p>Credit profile: {inv.creditProfileStub}</p>

          {(inv.roundState === "RoundOpen" || inv.roundState === "StaticReferenceFallback") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmitBid(
                  inv.contractId,
                  inv.requestId,
                  inv.roundState === "StaticReferenceFallback"
                );
              }}
            >
              <label>
                Advance amount
                <input
                  value={advanceByRound[inv.contractId] ?? "1000"}
                  onChange={(e) =>
                    setAdvanceByRound((m) => ({ ...m, [inv.contractId]: e.target.value }))
                  }
                />
              </label>
              <label>
                Discount rate (decimal)
                <input
                  value={discountByRound[inv.contractId] ?? "0.05"}
                  onChange={(e) =>
                    setDiscountByRound((m) => ({ ...m, [inv.contractId]: e.target.value }))
                  }
                />
              </label>
              <button type="submit">
                {myBids.some((b) => b.requestId === inv.requestId)
                  ? inv.roundState === "StaticReferenceFallback"
                    ? "Replace Static Reference Bid"
                    : "Replace Oracle-Anchored Bid"
                  : inv.roundState === "StaticReferenceFallback"
                    ? "Submit Static Reference Bid"
                    : "Submit Oracle-Anchored Bid"}
              </button>
            </form>
          )}
        </div>
      ))}

      <h2>My Bids ({myBids.length})</h2>
      {myBids.length === 0 ? (
        <p>No active bids.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Round</th>
              <th>Advance</th>
              <th>Discount</th>
              <th>Mode</th>
              <th>Agent</th>
              <th>Report</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {myBids.map((bid) => (
              <tr key={bid.contractId}>
                <td>{bid.requestId}</td>
                <td>{bid.advanceAmount}</td>
                <td>{bid.discountRate}</td>
                <td>{bid.mode}</td>
                <td>{bid.viaAgent ? bid.mandateId ?? "yes" : "manual"}</td>
                <td>{bid.reportId.slice(0, 16)}…</td>
                <td>{bid.ledgerTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Funded positions ({positions.length})</h2>
      {positions.length === 0 ? (
        <p>No funded positions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Receivable</th>
              <th>Face value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.receivableId}>
                <td>{p.receivableId}</td>
                <td>{p.faceValue}</td>
                <td>{p.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
