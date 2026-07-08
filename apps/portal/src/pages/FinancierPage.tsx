import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Gavel, Plus } from "lucide-react";
import type { ActivityLogEntry, AgentRunStatus, BiddingMandateSummary } from "@meridian/shared-types";
import {
  api,
  isAgentRuntimeOnline,
  logAgentError,
  useNotifications,
  type BidSummary,
  type FinancierInvitation,
} from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { Alert, EmptyState, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, Surface } from "../components/ui/Surface";
import { DataTable } from "../components/ui/DataTable";
import { Checkbox, Field, FieldGroup, FieldLabel } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PageTabBar } from "../components/ui/PageTabBar";
import { CollapsibleSection } from "../components/ui/CollapsibleSection";
import { ActivityLogPanel } from "../components/ui/ActivityLogPanel";
import { createClientLogEntry, mergeActivityLogs } from "../lib/activity-log";
import { cn, truncateParty } from "../lib/utils";

function canSubmitBid(inv: FinancierInvitation) {
  return inv.roundState === "RoundOpen" || inv.roundState === "StaticReferenceFallback";
}

function categorizeInvitations(invitations: FinancierInvitation[]) {
  const open: FinancierInvitation[] = [];
  const pending: FinancierInvitation[] = [];
  const awarded: FinancierInvitation[] = [];

  for (const inv of invitations) {
    if (inv.roundState === "RoundOpen" || inv.roundState === "StaticReferenceFallback") {
      open.push(inv);
    } else if (inv.roundState === "Awarded") {
      awarded.push(inv);
    } else {
      pending.push(inv);
    }
  }

  return { open, pending, awarded };
}

interface InvitationCardProps {
  inv: FinancierInvitation;
  myBids: BidSummary[];
  bidSubmitting: boolean;
  advanceByRound: Record<string, string>;
  discountByRound: Record<string, string>;
  onAdvanceChange: (contractId: string, value: string) => void;
  onDiscountChange: (contractId: string, value: string) => void;
  onSubmitBid: (contractId: string, requestId: string, useStaticReference: boolean) => void;
}

function InvitationCard({
  inv,
  myBids,
  bidSubmitting,
  advanceByRound,
  discountByRound,
  onAdvanceChange,
  onDiscountChange,
  onSubmitBid,
}: InvitationCardProps) {
  const biddable = canSubmitBid(inv);

  return (
    <Card
      className={cn("invitation-card gap-0", biddable && "invitation-card--biddable")}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="font-heading">{inv.requestId}</strong>
          <Badge>{inv.roundState}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Supplier: {truncateParty(inv.supplier, 24)} · Deadline {inv.deadline}
        </p>
        <p className="text-sm text-muted-foreground">
          Pricing band {inv.pricingBandMin}–{inv.pricingBandMax}
        </p>
        <p className="text-sm text-muted-foreground">
          Credit profile: {inv.creditProfileStub}
        </p>

        {biddable ? (
          <form
            className="border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitBid(
                inv.contractId,
                inv.requestId,
                inv.roundState === "StaticReferenceFallback"
              );
            }}
          >
            <FieldGroup className="gap-3">
              <div className="grid grid-cols-1 gap-3">
                <Field>
                  <FieldLabel>Advance amount</FieldLabel>
                  <Input
                    value={advanceByRound[inv.contractId] ?? "1000"}
                    onChange={(e) => onAdvanceChange(inv.contractId, e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>Discount rate (decimal)</FieldLabel>
                  <Input
                    value={discountByRound[inv.contractId] ?? "0.05"}
                    onChange={(e) => onDiscountChange(inv.contractId, e.target.value)}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={bidSubmitting} className="w-full">
                <Gavel className="size-4" />
                {bidSubmitting
                  ? "Submitting…"
                  : myBids.some((b) => b.requestId === inv.requestId)
                    ? inv.roundState === "StaticReferenceFallback"
                      ? "Replace Static Reference Bid"
                      : "Replace Oracle-Anchored Bid"
                    : inv.roundState === "StaticReferenceFallback"
                      ? "Submit Static Reference Bid"
                      : "Submit Oracle-Anchored Bid"}
              </Button>
            </FieldGroup>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

interface InvitationSectionGridProps {
  invitations: FinancierInvitation[];
  myBids: BidSummary[];
  bidSubmitting: boolean;
  advanceByRound: Record<string, string>;
  discountByRound: Record<string, string>;
  onAdvanceChange: (contractId: string, value: string) => void;
  onDiscountChange: (contractId: string, value: string) => void;
  onSubmitBid: (contractId: string, requestId: string, useStaticReference: boolean) => void;
}

function InvitationSectionGrid({
  invitations,
  myBids,
  bidSubmitting,
  advanceByRound,
  discountByRound,
  onAdvanceChange,
  onDiscountChange,
  onSubmitBid,
}: InvitationSectionGridProps) {
  if (invitations.length === 0) {
    return <EmptyState>No rounds in this section.</EmptyState>;
  }

  const grid = (
    <div className="invitation-card-grid">
      {invitations.map((inv) => (
        <InvitationCard
          key={inv.contractId}
          inv={inv}
          myBids={myBids}
          bidSubmitting={bidSubmitting}
          advanceByRound={advanceByRound}
          discountByRound={discountByRound}
          onAdvanceChange={onAdvanceChange}
          onDiscountChange={onDiscountChange}
          onSubmitBid={onSubmitBid}
        />
      ))}
    </div>
  );

  if (invitations.length <= 6) {
    return grid;
  }

  return (
    <div
      className="invitation-card-grid-viewport"
      style={{ "--invitation-card-max-rows": 2 } as React.CSSProperties}
    >
      {grid}
    </div>
  );
}

export function FinancierPage() {
  const [tab, setTab] = usePageTab(["deal-flow", "agent", "positions"] as const, "deal-flow");
  const [dealFlowView, setDealFlowView] = useState<"invitations" | "bids">("invitations");
  const [invitations, setInvitations] = useState<FinancierInvitation[]>([]);
  const [myBids, setMyBids] = useState<BidSummary[]>([]);
  const [mandates, setMandates] = useState<BiddingMandateSummary[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentRunStatus | null>(null);
  const [positions, setPositions] = useState<
    Array<{ receivableId: string; state: string; faceValue: string }>
  >([]);
  const [error, setError] = useState("");
  const [agentTicking, setAgentTicking] = useState(false);
  const [advanceByRound, setAdvanceByRound] = useState<Record<string, string>>({});
  const [discountByRound, setDiscountByRound] = useState<Record<string, string>>({});
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [agentLogs, setAgentLogs] = useState<ActivityLogEntry[]>([]);
  const [invitationSectionsOpen, setInvitationSectionsOpen] = useState({
    open: true,
    pending: false,
    awarded: false,
  });
  const [mandateForm, setMandateForm] = useState({
    mandateId: `mandate-${Date.now()}`,
    maxExposure: "2000",
    minSpread: "0.03",
    eligibleSuppliers: "",
    agentEnabled: true,
  });

  const refresh = useCallback(async () => {
    console.log("[meridian-financier] refresh start");
    try {
      const [inv, bids, pos, mandateRes, agentRes] = await Promise.all([
        api.getFinancierInvitations(),
        api.getFinancierMyBids(),
        api.getFinancierPositions().catch((err) => {
          console.warn("[meridian-financier] positions fetch failed", err);
          return { positions: [] };
        }),
        api.getFinancierMandates().catch((err) => {
          console.warn("[meridian-financier] mandates fetch failed", err);
          return { mandates: [] };
        }),
        api.getAgentStatus().catch((err) => {
          logAgentError("getAgentStatus failed — is agent-runtime running on :4025?", err);
          return null;
        }),
      ]);
      setInvitations(inv.invitations);
      setMyBids(bids.bids);
      setMandates(mandateRes.mandates);
      setAgentStatus(agentRes);
      if (agentRes?.logs?.length) {
        setAgentLogs((logs) => mergeActivityLogs(logs, agentRes.logs));
      }
      setPositions(
        (pos.positions ?? []).map((p) => ({
          receivableId: p.receivableId,
          state: p.state,
          faceValue: p.faceValue,
        }))
      );
      setError("");
      console.log("[meridian-financier] refresh ok", {
        invitations: inv.invitations.length,
        myBids: bids.bids.length,
        mandates: mandateRes.mandates.length,
        agentRuntime: isAgentRuntimeOnline(agentRes) ? "online" : "offline",
        openInvitations: inv.invitations.filter(
          (i) => i.roundState === "RoundOpen" || i.roundState === "StaticReferenceFallback"
        ).length,
      });
    } catch (e) {
      console.error("[meridian-financier] refresh failed", e);
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
    setBidSubmitting(true);
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
    } finally {
      setBidSubmitting(false);
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
    setAgentTicking(true);
    setError("");
    const mandate = mandates.find((m) => m.agentEnabled && !m.revoked);
    setAgentLogs((logs) =>
      mergeActivityLogs(logs, [
        createClientLogEntry("info", "Agent tick requested", {
          detail: {
            mandateId: mandate?.mandateId ?? null,
            openInvitations: invitations.filter(
              (i) => i.roundState === "RoundOpen" || i.roundState === "StaticReferenceFallback"
            ).length,
            existingBids: myBids.length,
          },
        }),
      ])
    );
    try {
      const status = await api.triggerAgentTick();
      setAgentStatus(status);
      setAgentLogs((logs) => mergeActivityLogs(logs, status.logs));
      const submitted = status.decisions.filter((d) => d.submitted);
      setAgentLogs((logs) =>
        mergeActivityLogs(logs, [
          createClientLogEntry(
            submitted.length > 0 ? "info" : "warn",
            `Tick finished — ${submitted.length}/${status.decisions.length} bids submitted`,
            {
              detail: {
                durationMs: status.lastTickDurationMs,
                lastError: status.lastError,
              },
            }
          ),
        ])
      );
      await refresh();
    } catch (err) {
      setAgentLogs((logs) =>
        mergeActivityLogs(logs, [
          createClientLogEntry("error", "Agent tick failed", {
            detail: { error: String(err) },
          }),
        ])
      );
      setError(String(err));
    } finally {
      setAgentTicking(false);
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
  const agentOnline = isAgentRuntimeOnline(agentStatus);
  const invitationGroups = useMemo(() => categorizeInvitations(invitations), [invitations]);

  const invitationGridProps = {
    myBids,
    bidSubmitting,
    advanceByRound,
    discountByRound,
    onAdvanceChange: (contractId: string, value: string) =>
      setAdvanceByRound((m) => ({ ...m, [contractId]: value })),
    onDiscountChange: (contractId: string, value: string) =>
      setDiscountByRound((m) => ({ ...m, [contractId]: value })),
    onSubmitBid: (contractId: string, requestId: string, useStaticReference: boolean) => {
      void handleSubmitBid(contractId, requestId, useStaticReference);
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financier Desk"
        description="Sealed-bid deal flow — invitations visible only to invited financiers."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <PageTabBar
        tabs={[
          { id: "deal-flow", label: "Deal Flow", count: invitations.length },
          { id: "agent", label: "Agent & Mandates", count: mandates.length },
          { id: "positions", label: "Funded Positions", count: positions.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "agent" && (
      <>
      <Surface title="Agent Bidding" emphasis>
        <div className="space-y-5">
          {activeMandate ? (
            <Card className="border-primary/30 bg-primary/5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                      Active mandate
                    </p>
                    <p className="font-heading text-lg font-semibold text-foreground">
                      {activeMandate.mandateId}
                    </p>
                  </div>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Max exposure</dt>
                      <dd className="font-medium tabular-nums">{activeMandate.maxExposure}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Min spread</dt>
                      <dd className="font-medium tabular-nums">{activeMandate.minSpread}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Model</dt>
                      <dd className="font-medium">
                        {agentStatus?.groqModel ?? "openai/gpt-oss-120b"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <Badge variant="success">Agent enabled</Badge>
              </div>
            </Card>
          ) : (
            <Alert>
              No agent-enabled mandate. Create a mandate below and enable the agent, or turn on an
              existing mandate.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleAgentTick}
              disabled={agentTicking || !agentOnline || !activeMandate}
            >
              <Bot className="size-4" />
              {agentTicking ? "Running agent tick…" : "Trigger agent tick"}
            </Button>
            {!agentOnline && (
              <p className="text-sm text-muted-foreground">
                Agent runtime offline — start with <code className="text-xs">pnpm agent-runtime</code>
              </p>
            )}
          </div>

          <ActivityLogPanel
            entries={agentLogs}
            title="Agent run log"
            emptyMessage="No agent activity yet. Trigger a tick to evaluate open rounds and stream structured logs here."
            onClear={() => setAgentLogs([])}
            maxHeight="20rem"
          />

          {agentStatus && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                Last tick: {agentStatus.lastTickAt ?? "never"}
                {agentStatus.lastTickDurationMs != null
                  ? ` (${agentStatus.lastTickDurationMs} ms)`
                  : ""}
              </p>
              {agentStatus.lastError && (
                <Alert variant="destructive">Agent error: {agentStatus.lastError}</Alert>
              )}
              {agentStatus.decisions.length > 0 && (
                <DataTable
                  data={agentStatus.decisions}
                  rowKey={(d) => d.requestContractId}
                  emptyMessage="No agent decisions yet."
                  detailTitle={(d) => d.requestId}
                  detailFields={(d) => [
                    { label: "Should bid", value: d.shouldBid ? "Yes" : "No" },
                    { label: "Advance", value: d.advanceAmount },
                    { label: "Discount rate", value: d.discountRate },
                    {
                      label: "Submitted",
                      value: d.submitted ? d.bidContractId ?? "Yes" : "No",
                      mono: Boolean(d.bidContractId),
                    },
                    { label: "Rationale", value: d.rationale ?? "—" },
                    { label: "Ledger error", value: d.ledgerError ?? "—" },
                    { label: "Request contract", value: d.requestContractId, mono: true },
                  ]}
                  columns={[
                    { id: "round", header: "Round", cell: (d) => d.requestId },
                    { id: "bid", header: "Bid?", cell: (d) => (d.shouldBid ? "yes" : "no") },
                    { id: "advance", header: "Advance", cell: (d) => d.advanceAmount },
                    { id: "rate", header: "Rate", cell: (d) => d.discountRate },
                    {
                      id: "submitted",
                      header: "Submitted",
                      cell: (d) =>
                        d.submitted ? d.bidContractId?.slice(0, 12) ?? "yes" : "no",
                    },
                    {
                      id: "notes",
                      header: "Notes",
                      cell: (d) => (
                        <span className="block max-w-[200px] truncate">
                          {d.ledgerError ?? d.rationale}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </Surface>

      <div>
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Bidding Mandates ({mandates.length})
        </h2>
        <Surface className="mb-4">
          <form onSubmit={handleCreateMandate}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="mandateId">Mandate ID</FieldLabel>
                  <Input
                    id="mandateId"
                    value={mandateForm.mandateId}
                    onChange={(e) =>
                      setMandateForm((f) => ({ ...f, mandateId: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="maxExposure">Max exposure</FieldLabel>
                  <Input
                    id="maxExposure"
                    value={mandateForm.maxExposure}
                    onChange={(e) =>
                      setMandateForm((f) => ({ ...f, maxExposure: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="minSpread">Min spread (decimal)</FieldLabel>
                  <Input
                    id="minSpread"
                    value={mandateForm.minSpread}
                    onChange={(e) =>
                      setMandateForm((f) => ({ ...f, minSpread: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="eligibleSuppliers">
                    Eligible suppliers (comma-separated party ids, empty = any)
                  </FieldLabel>
                  <Input
                    id="eligibleSuppliers"
                    value={mandateForm.eligibleSuppliers}
                    onChange={(e) =>
                      setMandateForm((f) => ({ ...f, eligibleSuppliers: e.target.value }))
                    }
                  />
                </Field>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  checked={mandateForm.agentEnabled}
                  onChange={(e) =>
                    setMandateForm((f) => ({ ...f, agentEnabled: e.target.checked }))
                  }
                />
                Enable agent
              </label>
              <Button type="submit">
                <Plus className="size-4" />
                Create mandate on-ledger
              </Button>
            </FieldGroup>
          </form>
        </Surface>

        {mandates.length > 0 && (
          <DataTable
            data={mandates}
            rowKey={(m) => m.contractId}
            emptyMessage="No mandates on record."
            detailTitle={(m) => m.mandateId}
            detailFields={(m) => [
              { label: "Max exposure", value: m.maxExposure },
              { label: "Min spread", value: m.minSpread },
              { label: "Agent enabled", value: m.agentEnabled ? "Yes" : "No" },
              { label: "Revoked", value: m.revoked ? "Yes" : "No" },
              { label: "Contract ID", value: m.contractId, mono: true },
            ]}
            columns={[
              {
                id: "id",
                header: "ID",
                cell: (m) => <span className="font-medium">{m.mandateId}</span>,
              },
              { id: "exposure", header: "Max exposure", cell: (m) => m.maxExposure },
              { id: "spread", header: "Min spread", cell: (m) => m.minSpread },
              {
                id: "agent",
                header: "Agent",
                cell: (m) => (
                  <Badge variant={m.agentEnabled ? "success" : "muted"}>
                    {m.agentEnabled ? "on" : "off"}
                  </Badge>
                ),
              },
              { id: "revoked", header: "Revoked", cell: (m) => (m.revoked ? "yes" : "no") },
              {
                id: "action",
                header: "",
                isAction: true,
                align: "right",
                cell: (m) =>
                  !m.revoked ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAgentEnabled(m)}
                    >
                      {m.agentEnabled ? "Disable agent" : "Enable agent"}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </div>
      </>
      )}

      {tab === "deal-flow" && (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Rounds are grouped by status. Open rounds accept bids inline; pending and
          awarded history stay collapsible so large volumes remain easy to scan.
        </p>

        <PageTabBar
          tabs={[
            { id: "invitations", label: "Invitations", count: invitations.length },
            { id: "bids", label: "My Bids", count: myBids.length },
          ]}
          activeTab={dealFlowView}
          onTabChange={(id) => setDealFlowView(id as "invitations" | "bids")}
        />

        {dealFlowView === "invitations" && (
          <div className="space-y-4">
            {invitations.length === 0 ? (
              <EmptyState>No invitations.</EmptyState>
            ) : (
              <>
                <CollapsibleSection
                  title="Open Rounds"
                  count={invitationGroups.open.length}
                  open={invitationSectionsOpen.open}
                  onOpenChange={(open) =>
                    setInvitationSectionsOpen((s) => ({ ...s, open }))
                  }
                  emphasis
                >
                  <InvitationSectionGrid
                    invitations={invitationGroups.open}
                    {...invitationGridProps}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  title="Pending"
                  count={invitationGroups.pending.length}
                  open={invitationSectionsOpen.pending}
                  onOpenChange={(isOpen) =>
                    setInvitationSectionsOpen((s) => ({ ...s, pending: isOpen }))
                  }
                >
                  <InvitationSectionGrid
                    invitations={invitationGroups.pending}
                    {...invitationGridProps}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  title="Awarded"
                  count={invitationGroups.awarded.length}
                  open={invitationSectionsOpen.awarded}
                  onOpenChange={(isOpen) =>
                    setInvitationSectionsOpen((s) => ({ ...s, awarded: isOpen }))
                  }
                >
                  <InvitationSectionGrid
                    invitations={invitationGroups.awarded}
                    {...invitationGridProps}
                  />
                </CollapsibleSection>
              </>
            )}
          </div>
        )}

        {dealFlowView === "bids" && (
          <div>
            {myBids.length === 0 ? (
              <EmptyState>No active bids.</EmptyState>
            ) : (
              <DataTable
                data={myBids}
                rowKey={(bid) => bid.contractId}
                emptyMessage="No active bids."
                detailTitle={(bid) => bid.requestId}
                detailFields={(bid) => [
                  { label: "Advance", value: bid.advanceAmount },
                  { label: "Discount", value: bid.discountRate },
                  { label: "Mode", value: bid.mode },
                  { label: "Agent", value: bid.viaAgent ? bid.mandateId ?? "yes" : "manual" },
                  { label: "Report ID", value: bid.reportId, mono: true },
                  { label: "Submitted", value: bid.ledgerTime },
                  { label: "Contract ID", value: bid.contractId, mono: true },
                ]}
                columns={[
                  { id: "round", header: "Round", cell: (bid) => bid.requestId },
                  { id: "advance", header: "Advance", cell: (bid) => bid.advanceAmount },
                  { id: "discount", header: "Discount", cell: (bid) => bid.discountRate },
                  {
                    id: "mode",
                    header: "Mode",
                    cell: (bid) => <Badge variant="outline">{bid.mode}</Badge>,
                  },
                  {
                    id: "agent",
                    header: "Agent",
                    cell: (bid) => (bid.viaAgent ? bid.mandateId ?? "yes" : "manual"),
                  },
                  {
                    id: "report",
                    header: "Report",
                    cell: (bid) => `${bid.reportId.slice(0, 16)}…`,
                  },
                  { id: "submitted", header: "Submitted", cell: (bid) => bid.ledgerTime },
                ]}
              />
            )}
          </div>
        )}
      </div>
      )}

      {tab === "positions" && (
      <div>
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Funded Positions ({positions.length})
        </h2>
        {positions.length === 0 ? (
          <EmptyState>No funded positions yet.</EmptyState>
        ) : (
          <DataTable
            data={positions}
            rowKey={(p) => p.receivableId}
            emptyMessage="No funded positions yet."
            detailTitle={(p) => p.receivableId}
            detailFields={(p) => [
              { label: "Face value", value: p.faceValue },
              { label: "Status", value: p.state },
            ]}
            columns={[
              {
                id: "receivable",
                header: "Receivable",
                cell: (p) => <span className="font-medium">{p.receivableId}</span>,
              },
              { id: "face", header: "Face value", cell: (p) => p.faceValue },
              {
                id: "status",
                header: "Status",
                cell: (p) => <Badge variant="secondary">{p.state}</Badge>,
              },
            ]}
          />
        )}
      </div>
      )}
    </div>
  );
}
