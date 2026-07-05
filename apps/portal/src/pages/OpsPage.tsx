import { useCallback, useEffect, useState } from "react";
import type {
  OracleHealthStatus,
  RegulatorExposureRollup,
  RegulatorJurisdictionGrantSummary,
  SettlementFinalitySummary,
} from "@meridian/shared-types";
import { api } from "../api";

export function OpsPage() {
  const [settlement, setSettlement] = useState<SettlementFinalitySummary | null>(null);
  const [oracle, setOracle] = useState<OracleHealthStatus | null>(null);
  const [grants, setGrants] = useState<RegulatorJurisdictionGrantSummary[]>([]);
  const [rollups, setRollups] = useState<RegulatorExposureRollup[]>([]);
  const [error, setError] = useState("");
  const [grantForm, setGrantForm] = useState({ grantId: `grant-${Date.now()}`, jurisdiction: "US" });
  const [observerForm, setObserverForm] = useState({
    receivableContractId: "",
    jurisdiction: "US",
  });
  const [kybForm, setKybForm] = useState({
    legalEntityId: "",
    jurisdiction: "US",
    partyHint: "",
    role: "Supplier",
  });
  const [kybVerificationId, setKybVerificationId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [settleRes, oracleRes, grantsRes, exposureRes] = await Promise.all([
        api.getOpsSettlementFinality(),
        api.getOpsOracleHealth(),
        api.getOpsRegulatorGrants(),
        api.getRegulatorExposure().catch(() => ({ rollups: [] })),
      ]);
      setSettlement(settleRes.summary);
      setOracle(oracleRes);
      setGrants(grantsRes.grants);
      setRollups(exposureRes.rollups ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreateGrant(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createOpsRegulatorGrant({
        grantId: grantForm.grantId,
        jurisdiction: grantForm.jurisdiction,
      });
      setGrantForm((f) => ({ ...f, grantId: `grant-${Date.now()}` }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleGrantObserver(e: React.FormEvent) {
    e.preventDefault();
    if (!observerForm.receivableContractId.trim()) return;
    try {
      await api.grantRegulatorObserver(
        observerForm.receivableContractId.trim(),
        observerForm.jurisdiction
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleKybVerify(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await api.verifyKyb({
        legalEntityId: kybForm.legalEntityId,
        jurisdiction: kybForm.jurisdiction,
        requestedRoles: [kybForm.role],
      });
      setKybVerificationId(res.verificationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleKybComplete(decision: "APPROVED" | "REJECTED") {
    if (!kybVerificationId) return;
    try {
      await api.completeKyb(kybVerificationId, decision);
      if (decision === "APPROVED" && kybForm.partyHint) {
        await api.allocateParty({
          orgId: kybForm.partyHint,
          legalEntityId: kybForm.legalEntityId,
          partyHint: kybForm.partyHint,
          role: kybForm.role,
          jurisdiction: kybForm.jurisdiction,
          verificationId: kybVerificationId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="page">
      <h1>Ops &amp; Compliance Console</h1>
      <p className="muted">
        Platform-operator view: settlement finality, oracle health, and regulator administration.
        No per-bid pricing is exposed here.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Settlement-finality monitor</h2>
        {settlement ? (
          <ul>
            <li>Atomic: {settlement.atomic}</li>
            <li>Reassignment-mediated: {settlement.reassignmentMediated}</li>
            <li>Escrow fallback: {settlement.escrowFallback}</li>
            <li>Total: {settlement.total}</li>
          </ul>
        ) : (
          <p>Loading…</p>
        )}
      </section>

      <section className="card">
        <h2>Oracle health monitor</h2>
        {oracle ? (
          <ul>
            <li>Service OK: {oracle.ok ? "yes" : "no"}</li>
            <li>Feed fresh: {oracle.isFresh ? "yes" : "no"}</li>
            <li>Cached: {oracle.cached ? "yes" : "no"}</li>
            <li>Last error: {oracle.lastError ?? "none"}</li>
            {oracle.referenceRate && (
              <li>
                SOFR: {oracle.referenceRate.value} (age {oracle.referenceRate.ageMs} ms)
              </li>
            )}
          </ul>
        ) : (
          <p>Loading…</p>
        )}
      </section>

      <section className="card">
        <h2>Regulator-view administration</h2>
        <form onSubmit={handleCreateGrant} className="inline-form">
          <input
            value={grantForm.grantId}
            onChange={(e) => setGrantForm((f) => ({ ...f, grantId: e.target.value }))}
            placeholder="grant id"
          />
          <input
            value={grantForm.jurisdiction}
            onChange={(e) => setGrantForm((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="jurisdiction"
          />
          <button type="submit">Create jurisdiction grant</button>
        </form>
        {grants.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Grant</th>
                <th>Jurisdiction</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.contractId}>
                  <td>{g.grantId}</td>
                  <td>{g.jurisdiction}</td>
                  <td>{g.active ? "yes" : "no"}</td>
                  <td>
                    {g.active && (
                      <button type="button" onClick={() => api.revokeOpsRegulatorGrant(g.contractId).then(refresh)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={handleGrantObserver} className="inline-form">
          <input
            value={observerForm.receivableContractId}
            onChange={(e) =>
              setObserverForm((f) => ({ ...f, receivableContractId: e.target.value }))
            }
            placeholder="receivable contract id"
          />
          <input
            value={observerForm.jurisdiction}
            onChange={(e) => setObserverForm((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="jurisdiction"
          />
          <button type="submit">Grant regulator observer</button>
        </form>
        {rollups.length > 0 && (
          <>
            <h3>Regulator exposure rollups</h3>
            <table>
              <thead>
                <tr>
                  <th>Jurisdiction</th>
                  <th>Total exposure</th>
                  <th>Receivables</th>
                </tr>
              </thead>
              <tbody>
                {rollups.map((r) => (
                  <tr key={r.jurisdiction}>
                    <td>{r.jurisdiction}</td>
                    <td>{r.totalExposure}</td>
                    <td>{r.receivableCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card">
        <h2>KYB / AML gate</h2>
        <form onSubmit={handleKybVerify} className="inline-form">
          <input
            value={kybForm.legalEntityId}
            onChange={(e) => setKybForm((f) => ({ ...f, legalEntityId: e.target.value }))}
            placeholder="legal entity id"
          />
          <input
            value={kybForm.jurisdiction}
            onChange={(e) => setKybForm((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="jurisdiction"
          />
          <input
            value={kybForm.partyHint}
            onChange={(e) => setKybForm((f) => ({ ...f, partyHint: e.target.value }))}
            placeholder="party hint (optional)"
          />
          <button type="submit">Start KYB verify</button>
        </form>
        {kybVerificationId && (
          <p>
            Verification <code>{kybVerificationId}</code> —{" "}
            <button type="button" onClick={() => handleKybComplete("APPROVED")}>
              Approve
            </button>{" "}
            <button type="button" onClick={() => handleKybComplete("REJECTED")}>
              Reject
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
