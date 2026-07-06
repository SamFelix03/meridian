import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Eye,
  Globe2,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type {
  OracleHealthStatus,
  RegulatorExposureRollup,
  RegulatorJurisdictionGrantSummary,
  SettlementFinalitySummary,
} from "@meridian/shared-types";
import { api } from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { Alert, EmptyState, InlineCode, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { Dialog } from "../components/ui/Dialog";
import { Card, Surface } from "../components/ui/Surface";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PageTabBar } from "../components/ui/PageTabBar";
import { cn } from "../lib/utils";

function SettlementFinalityPanel({
  settlement,
  loading,
  error,
}: {
  settlement: SettlementFinalitySummary | null;
  loading: boolean;
  error?: string;
}) {
  if (loading && !settlement) {
    return <p className="text-sm text-muted-foreground">Loading settlement metrics…</p>;
  }
  if (error) {
    return (
      <Alert variant="destructive" className="text-xs">
        {error}
      </Alert>
    );
  }
  if (!settlement || settlement.total === 0) {
    return (
      <EmptyState>
        No settled trades indexed yet. Metrics appear after atomic DvP awards complete on-ledger.
      </EmptyState>
    );
  }

  const segments = [
    { key: "atomic", label: "Atomic", value: settlement.atomic, tone: "bg-primary" },
    {
      key: "reassignment",
      label: "Reassignment-mediated",
      value: settlement.reassignmentMediated,
      tone: "bg-amber-500/80",
    },
    {
      key: "escrow",
      label: "Escrow fallback",
      value: settlement.escrowFallback,
      tone: "bg-destructive/80",
    },
  ] as const;

  const fallbackShare = Math.round((settlement.escrowFallback / settlement.total) * 100);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        How funded receivables actually settled. Rising escrow-fallback share may signal
        cross-synchronizer path issues worth investigating.
      </p>

      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted/60">
        {segments.map((seg) => {
          const width = (seg.value / settlement.total) * 100;
          if (width <= 0) return null;
          return (
            <div
              key={seg.key}
              className={cn("h-full transition-[width]", seg.tone)}
              style={{ width: `${width}%` }}
              title={`${seg.label}: ${seg.value}`}
            />
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="rounded-2xl border border-border/70 bg-muted/20 px-3.5 py-3"
          >
            <p className="text-xs text-muted-foreground">{seg.label}</p>
            <p className="mt-1 font-heading text-xl font-semibold tabular-nums text-foreground">
              {seg.value}
            </p>
          </div>
        ))}
        <div className="rounded-2xl border border-primary/25 bg-primary/5 px-3.5 py-3 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Total classified settlements</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <p className="font-heading text-2xl font-semibold tabular-nums text-foreground">
              {settlement.total}
            </p>
            {fallbackShare > 0 && (
              <Badge variant={fallbackShare > 15 ? "destructive" : "secondary"}>
                {fallbackShare}% escrow fallback
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OracleHealthPanel({
  oracle,
  loading,
  error,
}: {
  oracle: OracleHealthStatus | null;
  loading: boolean;
  error?: string;
}) {
  if (loading && !oracle) {
    return <p className="text-sm text-muted-foreground">Loading oracle status…</p>;
  }
  if (error) {
    return (
      <Alert variant="destructive" className="text-xs">
        {error}
      </Alert>
    );
  }
  if (!oracle) {
    return <EmptyState>Oracle relay status unavailable.</EmptyState>;
  }

  const healthy = oracle.ok && oracle.isFresh;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        SOFR reference-rate feed used to anchor sealed bids. Stale or faulted feeds can cause
        on-ledger bid rejection during financing rounds.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={healthy ? "success" : "destructive"}>
          {healthy ? "Healthy" : "Degraded"}
        </Badge>
        <Badge variant={oracle.cached ? "secondary" : "outline"}>
          {oracle.cached ? "Cached feed" : "Live fetch"}
        </Badge>
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Service</dt>
          <dd className="font-medium">{oracle.service}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Feed fresh</dt>
          <dd>
            <Badge variant={oracle.isFresh ? "success" : "destructive"}>
              {oracle.isFresh ? "yes" : "no"}
            </Badge>
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Last error</dt>
          <dd className="max-w-[14rem] truncate text-right font-medium">
            {oracle.lastError ?? "none"}
          </dd>
        </div>
        {oracle.referenceRate && (
          <div className="rounded-2xl border border-border/70 bg-muted/20 px-3.5 py-3">
            <p className="text-xs text-muted-foreground">Reference rate</p>
            <p className="mt-1 font-heading text-lg font-semibold tabular-nums">
              {oracle.referenceRate.feedId} {oracle.referenceRate.value}%
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Age {oracle.referenceRate.ageMs.toLocaleString()} ms
            </p>
          </div>
        )}
      </dl>
    </div>
  );
}

export function OpsPage() {
  const [tab, setTab] = usePageTab(["monitors", "regulator", "kyb"] as const, "monitors");
  const [settlement, setSettlement] = useState<SettlementFinalitySummary | null>(null);
  const [oracle, setOracle] = useState<OracleHealthStatus | null>(null);
  const [grants, setGrants] = useState<RegulatorJurisdictionGrantSummary[]>([]);
  const [rollups, setRollups] = useState<RegulatorExposureRollup[]>([]);
  const [loadingMonitors, setLoadingMonitors] = useState(true);
  const [loadingRegulator, setLoadingRegulator] = useState(true);
  const [settlementError, setSettlementError] = useState("");
  const [oracleError, setOracleError] = useState("");
  const [regulatorError, setRegulatorError] = useState("");
  const [actionError, setActionError] = useState("");
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
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
  const [submittingGrant, setSubmittingGrant] = useState(false);
  const [submittingObserver, setSubmittingObserver] = useState(false);

  const refreshMonitors = useCallback(async () => {
    setLoadingMonitors(true);
    setSettlementError("");
    setOracleError("");

    const [settleResult, oracleResult] = await Promise.allSettled([
      api.getOpsSettlementFinality(),
      api.getOpsOracleHealth(),
    ]);

    if (settleResult.status === "fulfilled") {
      setSettlement(settleResult.value.summary);
    } else {
      setSettlement(null);
      setSettlementError(
        settleResult.reason instanceof Error
          ? settleResult.reason.message
          : String(settleResult.reason)
      );
    }

    if (oracleResult.status === "fulfilled") {
      setOracle(oracleResult.value);
    } else {
      setOracle(null);
      setOracleError(
        oracleResult.reason instanceof Error
          ? oracleResult.reason.message
          : String(oracleResult.reason)
      );
    }

    setLoadingMonitors(false);
  }, []);

  const refreshRegulator = useCallback(async () => {
    setLoadingRegulator(true);
    setRegulatorError("");

    try {
      const [grantsRes, exposureRes] = await Promise.all([
        api.getOpsRegulatorGrants(),
        api.getRegulatorExposure().catch(() => ({ rollups: [] })),
      ]);
      setGrants(grantsRes.grants);
      setRollups(exposureRes.rollups ?? []);
    } catch (e) {
      setRegulatorError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRegulator(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshMonitors(), refreshRegulator()]);
  }, [refreshMonitors, refreshRegulator]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function handleCreateGrant(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingGrant(true);
    setActionError("");
    try {
      await api.createOpsRegulatorGrant({
        grantId: grantForm.grantId,
        jurisdiction: grantForm.jurisdiction,
      });
      setGrantForm((f) => ({ ...f, grantId: `grant-${Date.now()}` }));
      setGrantDialogOpen(false);
      await refreshRegulator();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingGrant(false);
    }
  }

  async function handleGrantObserver(e: React.FormEvent) {
    e.preventDefault();
    if (!observerForm.receivableContractId.trim()) return;
    setSubmittingObserver(true);
    setActionError("");
    try {
      await api.grantRegulatorObserver(
        observerForm.receivableContractId.trim(),
        observerForm.jurisdiction
      );
      setObserverForm((f) => ({ ...f, receivableContractId: "" }));
      await refreshRegulator();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingObserver(false);
    }
  }

  async function handleKybVerify(e: React.FormEvent) {
    e.preventDefault();
    setActionError("");
    try {
      const res = await api.verifyKyb({
        legalEntityId: kybForm.legalEntityId,
        jurisdiction: kybForm.jurisdiction,
        requestedRoles: [kybForm.role],
      });
      setKybVerificationId(res.verificationId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleKybComplete(decision: "APPROVED" | "REJECTED") {
    if (!kybVerificationId) return;
    setActionError("");
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
      if (decision === "APPROVED") {
        setKybVerificationId("");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const activeGrants = grants.filter((g) => g.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ops & Compliance Console"
        description="Platform-operator view: monitor settlement paths and oracle health, administer scoped regulator visibility, and gate new parties through KYB before topology allocation."
      >
        <Button type="button" variant="outline" size="sm" onClick={() => void refreshAll()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </PageHeader>

      {actionError && <Alert variant="destructive">{actionError}</Alert>}

      <PageTabBar
        tabs={[
          { id: "monitors", label: "Monitors" },
          { id: "regulator", label: "Regulator Admin", count: activeGrants || undefined },
          { id: "kyb", label: "KYB / AML" },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "monitors" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="gap-2 border-primary/20 bg-primary/5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Settlement mix
              </p>
              <p className="font-heading text-2xl font-semibold tabular-nums">
                {settlement?.total ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">Classified on-ledger settlements</p>
            </Card>
            <Card className="gap-2 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Oracle relay
              </p>
              <p className="font-heading text-2xl font-semibold">
                {oracle ? (
                  oracle.ok && oracle.isFresh ? (
                    <span className="text-primary">Online</span>
                  ) : (
                    <span className="text-destructive">Degraded</span>
                  )
                ) : (
                  "—"
                )}
              </p>
              <p className="text-xs text-muted-foreground">SOFR feed for bid anchoring</p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Surface title="Settlement-finality monitor">
              <div className="mb-3 flex items-center gap-2 text-primary">
                <Scale className="size-4" />
              </div>
              <SettlementFinalityPanel
                settlement={settlement}
                loading={loadingMonitors}
                error={settlementError}
              />
            </Surface>

            <Surface title="Oracle health monitor">
              <div className="mb-3 flex items-center gap-2 text-primary">
                <Activity className="size-4" />
              </div>
              <OracleHealthPanel
                oracle={oracle}
                loading={loadingMonitors}
                error={oracleError}
              />
            </Surface>
          </div>
        </div>
      )}

      {tab === "regulator" && (
        <div className="space-y-6">
          <Card className="flex gap-3 border-primary/20 bg-primary/5">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Scoped regulator visibility</p>
              <p>
                Regulators receive read-only aggregate exposure for their jurisdiction — never
                sealed-bid pricing or commercial terms. Grants are on-ledger observer rights, not
                controller authority over financing choices.
              </p>
            </div>
          </Card>

          {regulatorError && <Alert variant="destructive">{regulatorError}</Alert>}

          <Surface
            title="Jurisdiction grants"
            action={
              <Button type="button" size="sm" onClick={() => setGrantDialogOpen(true)}>
                <Plus className="size-4" />
                Create grant
              </Button>
            }
          >
            <p className="mb-4 text-sm text-muted-foreground">
              Standing grants let a regulator party observe compliance interface views for all
              receivables tagged under a jurisdiction (e.g. US, EU).
            </p>
            {loadingRegulator && grants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading grants…</p>
            ) : grants.length === 0 ? (
              <EmptyState>
                No jurisdiction grants on ledger. Create one to authorize regulator read access for
                a geography.
              </EmptyState>
            ) : (
              <DataTable
                data={grants}
                rowKey={(g) => g.contractId}
                emptyMessage="No jurisdiction grants."
                detailTitle={(g) => g.grantId}
                detailDescription={(g) => g.jurisdiction}
                detailFields={(g) => [
                  { label: "Grant ID", value: g.grantId },
                  { label: "Jurisdiction", value: g.jurisdiction },
                  { label: "Regulator party", value: g.regulator, mono: true },
                  { label: "Active", value: g.active ? "Yes" : "No" },
                  { label: "Contract ID", value: g.contractId, mono: true },
                ]}
                columns={[
                  {
                    id: "grant",
                    header: "Grant",
                    cell: (g) => (
                      <span className="block max-w-[12rem] truncate font-medium font-mono text-xs">
                        {g.grantId}
                      </span>
                    ),
                  },
                  {
                    id: "jurisdiction",
                    header: "Jurisdiction",
                    cell: (g) => (
                      <Badge variant="outline" className="gap-1">
                        <Globe2 className="size-3" />
                        {g.jurisdiction}
                      </Badge>
                    ),
                  },
                  {
                    id: "active",
                    header: "Status",
                    cell: (g) => (
                      <Badge variant={g.active ? "success" : "muted"}>
                        {g.active ? "Active" : "Revoked"}
                      </Badge>
                    ),
                  },
                  {
                    id: "action",
                    header: "",
                    isAction: true,
                    align: "right",
                    cell: (g) =>
                      g.active ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            api.revokeOpsRegulatorGrant(g.contractId).then(refreshRegulator)
                          }
                        >
                          Revoke
                        </Button>
                      ) : null,
                  },
                ]}
              />
            )}
          </Surface>

          <Surface title="Per-receivable observer">
            <p className="mb-4 text-sm text-muted-foreground">
              Grant a regulator observer rights on a specific funded receivable contract when
              jurisdiction-wide access is not sufficient for a case review.
            </p>
            <form onSubmit={handleGrantObserver}>
              <FieldGroup>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="receivableCid">Receivable contract ID</FieldLabel>
                    <Input
                      id="receivableCid"
                      value={observerForm.receivableContractId}
                      onChange={(e) =>
                        setObserverForm((f) => ({
                          ...f,
                          receivableContractId: e.target.value,
                        }))
                      }
                      placeholder="00abc…contract id"
                      className="font-mono text-xs"
                    />
                    <FieldDescription>
                      On-ledger CID of the receivable to expose via the compliance interface view.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="observerJurisdiction">Jurisdiction</FieldLabel>
                    <Input
                      id="observerJurisdiction"
                      value={observerForm.jurisdiction}
                      onChange={(e) =>
                        setObserverForm((f) => ({ ...f, jurisdiction: e.target.value }))
                      }
                      placeholder="US"
                    />
                    <FieldDescription>
                      Must match the regulator grant remit for this oversight action.
                    </FieldDescription>
                  </Field>
                </div>
                <div>
                  <Button type="submit" size="sm" disabled={submittingObserver}>
                    <Eye className="size-4" />
                    {submittingObserver ? "Granting…" : "Grant observer on receivable"}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </Surface>

          {rollups.length > 0 && (
            <Surface title="Aggregate exposure by jurisdiction">
              <p className="mb-4 text-sm text-muted-foreground">
                Read-only rollups visible to regulators — total funded exposure and receivable count
                per jurisdiction, without bid-level economics.
              </p>
              <DataTable
                data={rollups}
                rowKey={(r) => r.jurisdiction}
                emptyMessage="No exposure rollups."
                detailTitle={(r) => r.jurisdiction}
                detailFields={(r) => [
                  { label: "Jurisdiction", value: r.jurisdiction },
                  { label: "Total exposure", value: r.totalExposure },
                  { label: "Receivables", value: String(r.receivableCount) },
                ]}
                columns={[
                  {
                    id: "jurisdiction",
                    header: "Jurisdiction",
                    cell: (r) => <span className="font-medium">{r.jurisdiction}</span>,
                  },
                  {
                    id: "exposure",
                    header: "Total exposure",
                    cell: (r) => r.totalExposure,
                  },
                  {
                    id: "receivables",
                    header: "Receivables",
                    cell: (r) => r.receivableCount,
                  },
                ]}
              />
            </Surface>
          )}
        </div>
      )}

      {tab === "kyb" && (
        <div className="space-y-6">
          <Card className="flex gap-3">
            <UserCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Off-ledger KYB gate</p>
              <p>
                Identity verification runs off-ledger before any new party is allocated on Canton
                topology. Approval is required prior to submitting participant provisioning
                transactions.
              </p>
            </div>
          </Card>

          <Surface title="Start verification" emphasis>
            <form onSubmit={handleKybVerify}>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="legalEntityId">Legal entity ID</FieldLabel>
                    <Input
                      id="legalEntityId"
                      value={kybForm.legalEntityId}
                      onChange={(e) =>
                        setKybForm((f) => ({ ...f, legalEntityId: e.target.value }))
                      }
                      placeholder="e.g. acme-corp-001"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="kybJurisdiction">Jurisdiction</FieldLabel>
                    <Input
                      id="kybJurisdiction"
                      value={kybForm.jurisdiction}
                      onChange={(e) =>
                        setKybForm((f) => ({ ...f, jurisdiction: e.target.value }))
                      }
                      placeholder="US"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="partyHint">Party hint (optional)</FieldLabel>
                    <Input
                      id="partyHint"
                      value={kybForm.partyHint}
                      onChange={(e) => setKybForm((f) => ({ ...f, partyHint: e.target.value }))}
                      placeholder="meridian-supplier"
                    />
                    <FieldDescription>
                      If provided, an approved verification can trigger party allocation for this
                      org.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="kybRole">Requested role</FieldLabel>
                    <Input
                      id="kybRole"
                      value={kybForm.role}
                      onChange={(e) => setKybForm((f) => ({ ...f, role: e.target.value }))}
                      placeholder="Supplier"
                    />
                  </Field>
                </div>
                <Button type="submit" size="sm">
                  Start KYB verification
                </Button>
              </FieldGroup>
            </form>
          </Surface>

          {kybVerificationId && (
            <Surface title="Pending decision">
              <p className="mb-4 text-sm text-muted-foreground">
                Review the off-ledger KYB case, then approve to allow topology allocation or reject
                to block onboarding.
              </p>
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm">
                <span>
                  Verification <InlineCode>{kybVerificationId}</InlineCode>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="success"
                  onClick={() => handleKybComplete("APPROVED")}
                >
                  Approve &amp; allocate
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
            </Surface>
          )}
        </div>
      )}

      <Dialog
        open={grantDialogOpen}
        onOpenChange={setGrantDialogOpen}
        title="Create jurisdiction grant"
        description="Authorize a regulator party to observe aggregate compliance data for a geography."
      >
        <form onSubmit={handleCreateGrant}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="grantId">Grant ID</FieldLabel>
              <Input
                id="grantId"
                value={grantForm.grantId}
                onChange={(e) => setGrantForm((f) => ({ ...f, grantId: e.target.value }))}
                className="font-mono text-xs"
              />
              <FieldDescription>Unique identifier recorded on-ledger with the grant.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="grantJurisdiction">Jurisdiction</FieldLabel>
              <Input
                id="grantJurisdiction"
                value={grantForm.jurisdiction}
                onChange={(e) =>
                  setGrantForm((f) => ({ ...f, jurisdiction: e.target.value }))
                }
                placeholder="US"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setGrantDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submittingGrant}>
                <Plus className="size-4" />
                {submittingGrant ? "Creating…" : "Create on ledger"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Dialog>
    </div>
  );
}
