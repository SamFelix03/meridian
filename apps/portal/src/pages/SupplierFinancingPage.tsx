import { useCallback, useEffect, useState } from "react";
import { Award, Clock, Pause, RefreshCw, Timer } from "lucide-react";
import {
  api,
  useNotifications,
  type BidComparisonRow,
  type FinancingRequestSummary,
  type SupplierReceivable,
} from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { Alert, EmptyState, GuidancePanel, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, Surface } from "../components/ui/Surface";
import { CustomSelect } from "../components/ui/CustomSelect";
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

function defaultDeadline(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

export function SupplierFinancingPage() {
  const [tab, setTab] = usePageTab(["setup", "rounds"] as const, "setup");
  const [receivables, setReceivables] = useState<SupplierReceivable[]>([]);
  const [rounds, setRounds] = useState<FinancingRequestSummary[]>([]);
  const [bidMap, setBidMap] = useState<Record<string, BidComparisonRow[]>>({});
  const [parties, setParties] = useState<{ financierA: string; financierB: string } | null>(null);
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
    <div className="space-y-6">
      <PageHeader
        title="Supplier Financing"
        description="Configure sealed-bid rounds, compare oracle-anchored bids, and award atomically."
      />

      {error && <Alert variant="destructive">{error}</Alert>}
      {awardMsg && <Alert variant="success">{awardMsg}</Alert>}

      <PageTabBar
        tabs={[
          { id: "setup", label: "Open Round", count: posted.length || undefined },
          { id: "rounds", label: "Financing Rounds", count: rounds.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "setup" && (
        <>
      {issued.length > 0 && (
        <div id="ready-to-post">
          <h2 className="mb-2 font-heading text-lg font-semibold text-foreground">
            Ready to Post ({issued.length})
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            After buyer co-sign, post receivables for bid before opening a financing round.
          </p>
          <div className="grid gap-4">
            {issued.map((r) => (
              <Card key={r.contractId}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="font-heading">{r.receivableId}</strong>
                      <Badge>{r.state}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.faceValue} {r.currency} · due {r.dueDate}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handlePostForBid(r.contractId)}
                    disabled={postingId === r.contractId}
                  >
                    {postingId === r.contractId ? "Posting…" : "Post for bid"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Surface title="Open Financing Round" emphasis>
        {posted.length === 0 ? (
          <GuidancePanel
            title={
              issued.length > 0
                ? "Post receivables before opening a round"
                : "No receivables ready for financing"
            }
            description={
              issued.length > 0
                ? "You have issued receivables that still need to be posted for bid. Financing rounds can only be opened on receivables in PostedForBid state."
                : "Financing rounds require a receivable that has been issued by the buyer and posted for bid. Start on the Supplier Portal by proposing an invoice."
            }
            steps={[
              "Propose an invoice to the buyer on the Supplier Portal",
              "Wait for the buyer to co-sign and issue the receivable",
              "Post the receivable for bid once it reaches Issued state",
              "Return here to configure pricing bands and open a sealed-bid round",
            ]}
            primaryAction={{
              label: issued.length > 0 ? "Go to Supplier Portal" : "Issue your first invoice",
              to: "/supplier/portal",
            }}
            secondaryAction={
              issued.length > 0
                ? {
                    label: "View receivables to post",
                    onClick: () =>
                      document
                        .getElementById("ready-to-post")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  }
                : undefined
            }
          />
        ) : (
          <form onSubmit={handleOpenRound}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="receivable">Receivable (PostedForBid)</FieldLabel>
                <CustomSelect
                  id="receivable"
                  value={selectedReceivable}
                  onChange={setSelectedReceivable}
                  placeholder="Select receivable…"
                  options={posted.map((r) => ({
                    value: r.contractId,
                    label: `${r.receivableId} — ${r.faceValue} ${r.currency}`,
                    description: `Due ${r.dueDate}`,
                  }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="deadline">Deadline</FieldLabel>
                  <Input
                    id="deadline"
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pricingMin">Pricing band min (decimal rate)</FieldLabel>
                  <Input
                    id="pricingMin"
                    value={pricingMin}
                    onChange={(e) => setPricingMin(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pricingMax">Pricing band max (decimal rate)</FieldLabel>
                  <Input
                    id="pricingMax"
                    value={pricingMax}
                    onChange={(e) => setPricingMax(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Checkbox checked={inviteA} onChange={(e) => setInviteA(e.target.checked)} />
                  Invite Financier A
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Checkbox checked={inviteB} onChange={(e) => setInviteB(e.target.checked)} />
                  Invite Financier B
                </label>
              </div>
              <Button type="submit">
                <Clock className="size-4" />
                Open Round
              </Button>
            </FieldGroup>
          </form>
        )}
      </Surface>
        </>
      )}

      {tab === "rounds" && (
      <div>
        <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
          Financing Rounds ({rounds.length})
        </h2>
        {rounds.length === 0 ? (
          <EmptyState>No financing rounds yet.</EmptyState>
        ) : (
          <div className="space-y-4">
            {rounds.map((round) => (
              <Card key={round.contractId} className="gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-heading text-base">{round.requestId}</strong>
                      <Badge variant="secondary">{round.roundState}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Deadline: {round.deadline} · Band {round.pricingBandMin}–
                      {round.pricingBandMax} · {round.activeBidCount} active bid(s)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Receivable: {truncateParty(round.receivableCid, 28)}
                    </p>
                  </div>
                </div>

                {(round.roundState === "RoundOpen" ||
                  round.roundState === "StaticReferenceFallback" ||
                  round.roundState === "Paused") && (
                  <div className="flex flex-wrap gap-2">
                    {round.roundState === "RoundOpen" && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handlePause(round.contractId)}
                        >
                          <Pause className="size-3.5" />
                          Pause Round
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleStaticFallback(round.contractId)}
                        >
                          <RefreshCw className="size-3.5" />
                          Enter Static Reference Fallback
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleExpire(round.contractId)}
                    >
                      <Timer className="size-3.5" />
                      Expire Round (post-deadline)
                    </Button>
                  </div>
                )}

                <div>
                  <h3 className="mb-3 font-heading text-sm font-semibold text-foreground">
                    Bid Comparison
                  </h3>
                  {(bidMap[round.contractId] ?? []).length === 0 ? (
                    <EmptyState>No bids yet.</EmptyState>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rank</TableHead>
                          <TableHead>Financier</TableHead>
                          <TableHead>Advance</TableHead>
                          <TableHead>Discount</TableHead>
                          <TableHead>Effective Rate</TableHead>
                          <TableHead>Mode</TableHead>
                          <TableHead>Oracle</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(bidMap[round.contractId] ?? []).map((bid) => (
                          <TableRow key={bid.bidContractId}>
                            <TableCell>{bid.rank}</TableCell>
                            <TableCell>{truncateParty(bid.financier, 18)}</TableCell>
                            <TableCell>{bid.advanceAmount}</TableCell>
                            <TableCell>{bid.discountRate}</TableCell>
                            <TableCell>{bid.effectiveRate}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{bid.mode}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={bid.oracleFresh ? "success" : "destructive"}>
                                {bid.oracleFresh ? "fresh" : "stale"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {round.roundState === "RoundOpen" ||
                              round.roundState === "StaticReferenceFallback" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() =>
                                    handleAward(
                                      round.contractId,
                                      bid.bidContractId,
                                      bid.advanceAmount,
                                      bid.financier
                                    )
                                  }
                                >
                                  <Award className="size-3.5" />
                                  Award (DvP)
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
