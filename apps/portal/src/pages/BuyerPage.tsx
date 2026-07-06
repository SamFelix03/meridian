import { useCallback, useEffect, useState } from "react";
import { api, useNotifications, type BuyerObligation, type ReceivableProposal } from "../api";

export function BuyerPage() {
  const [obligations, setObligations] = useState<BuyerObligation[]>([]);
  const [proposals, setProposals] = useState<ReceivableProposal[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([
        api.getBuyerRepayable().catch(() => api.getBuyerObligations()),
        api.getBuyerProposals(),
      ]);
      setObligations(o.obligations);
      setProposals(p.proposals);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useNotifications("meridian-buyer", refresh);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function cosign(contractId: string) {
    try {
      await api.cosignInvoice(contractId);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function repay(o: BuyerObligation) {
    try {
      await api.repayObligation(o.contractId, {
        faceValue: o.faceValue,
        payeePartyId: o.payee,
        settlementRef: `portal-${o.receivableId}-${Date.now()}`,
      });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div>
      <h1>Buyer Portal</h1>
      <p>IBuyerView only — payee, amount, due date. No line items or supplier economics.</p>
      {error && <p className="error">{error}</p>}

      <h2>Pending Co-Signature ({proposals.length})</h2>
      {proposals.map((p) => (
        <div key={p.contractId} className="card">
          <strong>{p.proposalId}</strong>
          <p>
            {p.faceValue} {p.currency} · due {p.dueDate}
          </p>
          <button onClick={() => cosign(p.contractId)}>Co-Sign &amp; Issue</button>
        </div>
      ))}

      <h2>Obligations Dashboard ({obligations.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Payee</th>
            <th>Amount</th>
            <th>Due Date</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {obligations.map((o) => (
            <tr key={o.contractId}>
              <td>{o.receivableId}</td>
              <td>{o.payee.slice(0, 20)}…</td>
              <td>
                {o.faceValue} {o.currency}
              </td>
              <td>{o.dueDate}</td>
              <td>
                {(o.state === "Funded" ||
                  o.state === "PartiallySyndicated" ||
                  o.state === "Overdue" ||
                  !o.state) && (
                  <button onClick={() => repay(o)}>Repay obligation</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
