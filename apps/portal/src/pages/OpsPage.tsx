import { useCallback, useEffect, useState } from "react";
import { Activity, Eye, Scale, ShieldCheck } from "lucide-react";
import type {
  OracleHealthStatus,
  RegulatorExposureRollup,
  RegulatorJurisdictionGrantSummary,
  SettlementFinalitySummary,
} from "@meridian/shared-types";
import { api } from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { Alert, InlineCode, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, Surface } from "../components/ui/Surface";
import { Field, FieldGroup, FieldLabel } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PageTabBar } from "../components/ui/PageTabBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/Table";

export function OpsPage() {
  const [tab, setTab] = usePageTab(["monitors", "regulator", "kyb"] as const, "monitors");
  const [settlement, setSettlement] = useState<SettlementFinalitySummary | null>(null);
  const [oracle, setOracle] = useState<OracleHealthStatus | null>(null);
  const [grants, setGrants] = useState<RegulatorJurisdictionGrantSummary[]>([]);
  const [rollups, setRollups] = useState<RegulatorExposureRollup[]>([]);
  const [error, setError] = useState("");
  const [grantForm, setGrantForm] = useState({
    grantId: `grant-${Date.now()}`,
    jurisdiction: "US",
  });
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
    <div className="space-y-6">
      <PageHeader
        title="Ops & Compliance Console"
        description="Platform-operator view: settlement finality, oracle health, and regulator administration. No per-bid pricing is exposed here."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <PageTabBar
        tabs={[
          { id: "monitors", label: "Monitors" },
          { id: "regulator", label: "Regulator Admin", count: grants.length },
          { id: "kyb", label: "KYB / AML" },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "monitors" && (
      <div className="grid gap-6 lg:grid-cols-2">
        <Surface title="Settlement-finality monitor">
          <div className="mb-3 flex items-center gap-2 text-primary">
            <Scale className="size-4" />
          </div>
          {settlement ? (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-muted-foreground">Atomic</span>
                <span className="font-medium">{settlement.atomic}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Reassignment-mediated</span>
                <span className="font-medium">{settlement.reassignmentMediated}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Escrow fallback</span>
                <span className="font-medium">{settlement.escrowFallback}</span>
              </li>
              <li className="flex justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Total</span>
                <span className="font-heading font-semibold">{settlement.total}</span>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </Surface>

        <Surface title="Oracle health monitor">
          <div className="mb-3 flex items-center gap-2 text-primary">
            <Activity className="size-4" />
          </div>
          {oracle ? (
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Service OK</span>
                <Badge variant={oracle.ok ? "success" : "destructive"}>
                  {oracle.ok ? "yes" : "no"}
                </Badge>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Feed fresh</span>
                <Badge variant={oracle.isFresh ? "success" : "destructive"}>
                  {oracle.isFresh ? "yes" : "no"}
                </Badge>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Cached</span>
                <span className="font-medium">{oracle.cached ? "yes" : "no"}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Last error</span>
                <span className="font-medium">{oracle.lastError ?? "none"}</span>
              </li>
              {oracle.referenceRate && (
                <li className="border-t border-border pt-2 text-muted-foreground">
                  SOFR: {oracle.referenceRate.value} (age {oracle.referenceRate.ageMs} ms)
                </li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </Surface>
      </div>
      )}

      {tab === "regulator" && (
      <Surface title="Regulator-view administration">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <ShieldCheck className="size-4" />
        </div>

        <form onSubmit={handleCreateGrant} className="mb-6">
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                value={grantForm.grantId}
                onChange={(e) => setGrantForm((f) => ({ ...f, grantId: e.target.value }))}
                placeholder="grant id"
              />
              <Input
                value={grantForm.jurisdiction}
                onChange={(e) => setGrantForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                placeholder="jurisdiction"
              />
              <Button type="submit">Create jurisdiction grant</Button>
            </div>
          </FieldGroup>
        </form>

        {grants.length > 0 && (
          <Card className="mb-6 p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grant</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((g) => (
                  <TableRow key={g.contractId}>
                    <TableCell>{g.grantId}</TableCell>
                    <TableCell>{g.jurisdiction}</TableCell>
                    <TableCell>
                      <Badge variant={g.active ? "success" : "muted"}>
                        {g.active ? "yes" : "no"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {g.active && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => api.revokeOpsRegulatorGrant(g.contractId).then(refresh)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        <form onSubmit={handleGrantObserver} className="mb-6">
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                value={observerForm.receivableContractId}
                onChange={(e) =>
                  setObserverForm((f) => ({ ...f, receivableContractId: e.target.value }))
                }
                placeholder="receivable contract id"
              />
              <Input
                value={observerForm.jurisdiction}
                onChange={(e) =>
                  setObserverForm((f) => ({ ...f, jurisdiction: e.target.value }))
                }
                placeholder="jurisdiction"
              />
              <Button type="submit">
                <Eye className="size-4" />
                Grant regulator observer
              </Button>
            </div>
          </FieldGroup>
        </form>

        {rollups.length > 0 && (
          <div>
            <h3 className="mb-3 font-heading text-sm font-semibold">Regulator exposure rollups</h3>
            <Card className="p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jurisdiction</TableHead>
                    <TableHead>Total exposure</TableHead>
                    <TableHead>Receivables</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollups.map((r) => (
                    <TableRow key={r.jurisdiction}>
                      <TableCell>{r.jurisdiction}</TableCell>
                      <TableCell>{r.totalExposure}</TableCell>
                      <TableCell>{r.receivableCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}
      </Surface>
      )}

      {tab === "kyb" && (
      <Surface title="KYB / AML gate">
        <form onSubmit={handleKybVerify}>
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel>Legal entity id</FieldLabel>
                <Input
                  value={kybForm.legalEntityId}
                  onChange={(e) =>
                    setKybForm((f) => ({ ...f, legalEntityId: e.target.value }))
                  }
                  placeholder="legal entity id"
                />
              </Field>
              <Field>
                <FieldLabel>Jurisdiction</FieldLabel>
                <Input
                  value={kybForm.jurisdiction}
                  onChange={(e) =>
                    setKybForm((f) => ({ ...f, jurisdiction: e.target.value }))
                  }
                  placeholder="jurisdiction"
                />
              </Field>
              <Field>
                <FieldLabel>Party hint (optional)</FieldLabel>
                <Input
                  value={kybForm.partyHint}
                  onChange={(e) => setKybForm((f) => ({ ...f, partyHint: e.target.value }))}
                  placeholder="party hint"
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full">
                  Start KYB verify
                </Button>
              </div>
            </div>
          </FieldGroup>
        </form>

        {kybVerificationId && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm">
            <span>
              Verification <InlineCode>{kybVerificationId}</InlineCode>
            </span>
            <Button type="button" size="sm" variant="success" onClick={() => handleKybComplete("APPROVED")}>
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => handleKybComplete("REJECTED")}
            >
              Reject
            </Button>
          </div>
        )}
      </Surface>
      )}
    </div>
  );
}
