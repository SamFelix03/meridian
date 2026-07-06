import { useCallback, useEffect, useState } from "react";
import { Bot, Gavel, Plus } from "lucide-react";
import type { AgentRunStatus, BiddingMandateSummary } from "@meridian/shared-types";
import {
  api,
  isAgentRuntimeOnline,
  logAgent,
  logAgentError,
  useNotifications,
  type BidSummary,
  type FinancierInvitation,
} from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { Alert, EmptyState, InlineCode, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, Surface } from "../components/ui/Surface";
import { Checkbox, Field, FieldGroup, FieldLabel } from "../components/ui/Field";
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
import { truncateParty } from "../lib/utils";

export function FinancierPage() {
  const [tab, setTab] = usePageTab(["deal-flow", "agent", "positions"] as const, "deal-flow");
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
    setAgentTicking(true);
    setError("");
    const mandate = mandates.find((m) => m.agentEnabled && !m.revoked);
    logAgent("Trigger agent tick clicked", {
      activeMandate: mandate?.mandateId ?? null,
      openInvitations: invitations.filter(
        (i) => i.roundState === "RoundOpen" || i.roundState === "StaticReferenceFallback"
      ).length,
      existingBids: myBids.length,
    });
    try {
      const status = await api.triggerAgentTick();
      setAgentStatus(status);
      const submitted = status.decisions.filter((d) => d.submitted);
      logAgent(`tick complete: ${submitted.length}/${status.decisions.length} bids submitted`);
      await refresh();
    } catch (err) {
      logAgentError("triggerAgentTick failed", err);
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Agent runtime:</span>
            <Badge variant={agentOnline ? "success" : "destructive"}>
              {agentOnline ? "online (port 4025)" : "offline — run: pnpm agent-runtime"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Open DevTools Console and filter <InlineCode>[meridian-agent]</InlineCode> for tick logs.
            Mandate-constrained agent uses Groq{" "}
            <InlineCode>{agentStatus?.groqModel ?? "openai/gpt-oss-120b"}</InlineCode>; the ledger
            enforces limits on <InlineCode>viaAgent</InlineCode> bids.
          </p>
          <p className="text-sm text-foreground">
            Active mandate:{" "}
            {activeMandate
              ? `${activeMandate.mandateId} (max ${activeMandate.maxExposure}, min spread ${activeMandate.minSpread})`
              : "none"}
          </p>
          <Button
            type="button"
            onClick={handleAgentTick}
            disabled={agentTicking || !agentOnline}
          >
            <Bot className="size-4" />
            {agentTicking ? "Running agent tick…" : "Trigger agent tick"}
          </Button>

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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Round</TableHead>
                      <TableHead>Bid?</TableHead>
                      <TableHead>Advance</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agentStatus.decisions.map((d) => (
                      <TableRow key={d.requestContractId}>
                        <TableCell>{d.requestId}</TableCell>
                        <TableCell>{d.shouldBid ? "yes" : "no"}</TableCell>
                        <TableCell>{d.advanceAmount}</TableCell>
                        <TableCell>{d.discountRate}</TableCell>
                        <TableCell>
                          {d.submitted ? d.bidContractId?.slice(0, 12) ?? "yes" : "no"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {d.ledgerError ?? d.rationale}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Max exposure</TableHead>
                  <TableHead>Min spread</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Revoked</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mandates.map((m) => (
                  <TableRow key={m.contractId}>
                    <TableCell className="font-medium">{m.mandateId}</TableCell>
                    <TableCell>{m.maxExposure}</TableCell>
                    <TableCell>{m.minSpread}</TableCell>
                    <TableCell>
                      <Badge variant={m.agentEnabled ? "success" : "muted"}>
                        {m.agentEnabled ? "on" : "off"}
                      </Badge>
                    </TableCell>
                    <TableCell>{m.revoked ? "yes" : "no"}</TableCell>
                    <TableCell>
                      {!m.revoked && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => toggleAgentEnabled(m)}
                        >
                          {m.agentEnabled ? "Disable agent" : "Enable agent"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      </>
      )}

      {tab === "deal-flow" && (
      <>
      <div>
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Invitations ({invitations.length})
        </h2>
        {invitations.length === 0 ? (
          <EmptyState>No open invitations.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {invitations.map((inv) => (
              <Card key={inv.contractId}>
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

                  {(inv.roundState === "RoundOpen" ||
                    inv.roundState === "StaticReferenceFallback") && (
                    <form
                      className="border-t border-border pt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSubmitBid(
                          inv.contractId,
                          inv.requestId,
                          inv.roundState === "StaticReferenceFallback"
                        );
                      }}
                    >
                      <FieldGroup>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel>Advance amount</FieldLabel>
                            <Input
                              value={advanceByRound[inv.contractId] ?? "1000"}
                              onChange={(e) =>
                                setAdvanceByRound((m) => ({
                                  ...m,
                                  [inv.contractId]: e.target.value,
                                }))
                              }
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Discount rate (decimal)</FieldLabel>
                            <Input
                              value={discountByRound[inv.contractId] ?? "0.05"}
                              onChange={(e) =>
                                setDiscountByRound((m) => ({
                                  ...m,
                                  [inv.contractId]: e.target.value,
                                }))
                              }
                            />
                          </Field>
                        </div>
                        <Button type="submit">
                          <Gavel className="size-4" />
                          {myBids.some((b) => b.requestId === inv.requestId)
                            ? inv.roundState === "StaticReferenceFallback"
                              ? "Replace Static Reference Bid"
                              : "Replace Oracle-Anchored Bid"
                            : inv.roundState === "StaticReferenceFallback"
                              ? "Submit Static Reference Bid"
                              : "Submit Oracle-Anchored Bid"}
                        </Button>
                      </FieldGroup>
                    </form>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          My Bids ({myBids.length})
        </h2>
        {myBids.length === 0 ? (
          <EmptyState>No active bids.</EmptyState>
        ) : (
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Round</TableHead>
                  <TableHead>Advance</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myBids.map((bid) => (
                  <TableRow key={bid.contractId}>
                    <TableCell>{bid.requestId}</TableCell>
                    <TableCell>{bid.advanceAmount}</TableCell>
                    <TableCell>{bid.discountRate}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{bid.mode}</Badge>
                    </TableCell>
                    <TableCell>{bid.viaAgent ? bid.mandateId ?? "yes" : "manual"}</TableCell>
                    <TableCell>{bid.reportId.slice(0, 16)}…</TableCell>
                    <TableCell>{bid.ledgerTime}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      </>
      )}

      {tab === "positions" && (
      <div>
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Funded Positions ({positions.length})
        </h2>
        {positions.length === 0 ? (
          <EmptyState>No funded positions yet.</EmptyState>
        ) : (
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receivable</TableHead>
                  <TableHead>Face value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => (
                  <TableRow key={p.receivableId}>
                    <TableCell className="font-medium">{p.receivableId}</TableCell>
                    <TableCell>{p.faceValue}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.state}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      )}
    </div>
  );
}
