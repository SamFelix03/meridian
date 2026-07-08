import { useCallback, useEffect, useState } from "react";
import { Award, Users } from "lucide-react";
import {
  api,
  useNotifications,
  type CapTableEntry,
  type ParticipationInterestSummary,
  type SyndicationOfferingSummary,
} from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { useActivityLog } from "../hooks/useActivityLog";
import { Alert, EmptyState, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, Surface } from "../components/ui/Surface";
import { Field, FieldGroup, FieldLabel } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { CustomSelect } from "../components/ui/CustomSelect";
import { PageTabBar } from "../components/ui/PageTabBar";
import { ActivityLogPanel } from "../components/ui/ActivityLogPanel";
import { truncateParty } from "../lib/utils";

export function FinancierSyndicationPage() {
  const [tab, setTab] = usePageTab(["lead", "participant"] as const, "lead");
  const [error, setError] = useState("");
  const [positions, setPositions] = useState<
    Array<{ contractId: string; receivableId: string; faceValue: string; state: string }>
  >([]);
  const [offerings, setOfferings] = useState<SyndicationOfferingSummary[]>([]);
  const [invitations, setInvitations] = useState<SyndicationOfferingSummary[]>([]);
  const [interests, setInterests] = useState<ParticipationInterestSummary[]>([]);
  const [capTables, setCapTables] = useState<Record<string, CapTableEntry[]>>({});
  const [selectedReceivable, setSelectedReceivable] = useState("");
  const [shareBps, setShareBps] = useState("4000");
  const [discountRate, setDiscountRate] = useState("0.05");
  const [offeringBids, setOfferingBids] = useState<Record<string, string>>({});
  const { entries: logEntries, info, error: logError, clear: clearLog } =
    useActivityLog("financier-syndication");

  const refresh = useCallback(async () => {
    try {
      const [pos, off, inv, int] = await Promise.all([
        api.getFinancierPositions().catch(() => ({ positions: [] })),
        tab === "lead"
          ? api.getSyndicationOfferings().catch(() => ({ offerings: [] }))
          : Promise.resolve({ offerings: [] }),
        tab === "participant"
          ? api.getSyndicationInvitations().catch(() => ({ invitations: [] }))
          : Promise.resolve({ invitations: [] }),
        api.getSyndicationInterests(tab).catch(() => ({ interests: [] })),
      ]);
      setPositions(
        (pos.positions ?? [])
          .filter((p) => p.state === "Funded" || p.state === "PartiallySyndicated")
          .map((p) => ({
            contractId: p.contractId,
            receivableId: p.receivableId,
            faceValue: p.faceValue,
            state: p.state,
          }))
      );
      setOfferings(off.offerings ?? []);
      setInvitations(inv.invitations ?? []);
      setInterests(int.interests ?? []);

      if (tab === "lead") {
        const tables: Record<string, CapTableEntry[]> = {};
        for (const o of off.offerings ?? []) {
          if (o.roundState !== "Awarded") continue;
          try {
            const cap = await api.getSyndicationCapTable(o.receivableId);
            tables[o.receivableId] = cap.capTable;
          } catch {
            // cap table may not be projected yet
          }
        }
        setCapTables(tables);
      }
      setError("");
    } catch (e) {
      const message = String(e);
      setError(message);
      logError("Failed to refresh syndication data", { error: message });
    }
  }, [tab, logError]);

  const onLedgerNotify = useCallback(() => {
    info("Ledger notification received — refreshing syndication desk");
  }, [info]);

  useNotifications(
    tab === "lead" ? "meridian-financier-a" : "meridian-financier-b",
    refresh,
    { onNotify: onLedgerNotify }
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleOpenOffering() {
    if (!selectedReceivable) {
      setError("Select a funded position");
      return;
    }
    const position = positions.find((p) => p.contractId === selectedReceivable);
    if (!position) return;
    const offeringId = `SYN-UI-${Date.now()}`;
    info("Opening syndication offering", {
      offeringId,
      receivableId: position.receivableId,
      receivableCid: position.contractId,
    });
    try {
      await api.openSyndicationOffering({
        receivableCid: position.contractId,
        offeringId,
      });
      info("Syndication offering opened on-ledger", { offeringId, receivableId: position.receivableId });
      setError("");
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Open syndication offering failed", { error: message });
    }
  }

  async function handleSubmitBid(offeringContractId: string, offeringId: string, useStatic: boolean) {
    info("Submitting syndication interest bid", {
      offeringId,
      offeringContractId,
      shareBps,
      discountRate,
      useStaticReference: useStatic,
    });
    try {
      await api.submitSyndicationBid(offeringContractId, {
        shareBps: Number(shareBps),
        discountRate,
        useStaticReference: useStatic,
      });
      info("Syndication interest submitted on-ledger", { offeringId, shareBps });
      setError("");
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Syndication bid failed", { offeringId, error: message });
    }
  }

  async function handleAward(offeringContractId: string, offeringId: string) {
    const bidCid = offeringBids[offeringContractId];
    if (!bidCid) {
      setError("Enter winning bid contract id");
      return;
    }
    info("Awarding syndication bid", { offeringId, winningBidCid: bidCid });
    try {
      await api.awardSyndicationBid(offeringContractId, { winningBidCid: bidCid });
      info("Syndication bid awarded on-ledger", { offeringId, winningBidCid: bidCid });
      setError("");
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Syndication award failed", { offeringId, error: message });
    }
  }

  async function loadBids(offeringContractId: string, offeringId: string) {
    info("Loading syndication bids", { offeringId, offeringContractId });
    try {
      const { bids } = await api.getSyndicationBids(offeringContractId);
      if (bids.length > 0) {
        setOfferingBids((prev) => ({
          ...prev,
          [offeringContractId]: bids[0]!.contractId,
        }));
        info("Syndication bids loaded", {
          offeringId,
          count: bids.length,
          topBidCid: bids[0]!.contractId,
        });
      } else {
        info("No syndication bids found for offering", { offeringId });
      }
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Load syndication bids failed", { offeringId, error: message });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Syndication Desk"
        description="Secondary market — sealed interest bids; supplier and buyer never see syndication data."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <PageTabBar
        tabs={[
          { id: "lead", label: "Lead Financier", count: offerings.length },
          { id: "participant", label: "Participant", count: invitations.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "lead" && (
        <>
          <Surface title="Open Syndication Offering">
            <div className="space-y-4">
              {positions.length === 0 ? (
                <EmptyState>No funded positions eligible for syndication.</EmptyState>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="position">Eligible funded positions</FieldLabel>
                    <CustomSelect
                      id="position"
                      value={selectedReceivable}
                      onChange={setSelectedReceivable}
                      placeholder="Select position…"
                      options={positions.map((p) => ({
                        value: p.contractId,
                        label: `${p.receivableId} — ${p.faceValue}`,
                        description: p.state,
                      }))}
                    />
                  </Field>
                  <Button type="button" onClick={handleOpenOffering}>
                    <Users className="size-4" />
                    Open syndication offering
                  </Button>
                </>
              )}
            </div>
          </Surface>

          <div>
            <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
              Active Offerings ({offerings.length})
            </h2>
            {offerings.length === 0 ? (
              <EmptyState>No active syndication offerings.</EmptyState>
            ) : (
              <div className="grid gap-4">
                {offerings.map((o) => (
                  <Card key={o.contractId}>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="font-heading">{o.offeringId}</strong>
                        <Badge>{o.roundState}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Receivable {o.receivableId} · face {o.faceValue}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Band {o.pricingBandMin}–{o.pricingBandMax} · deadline {o.deadline}
                      </p>
                      {o.roundState === "RoundOpen" && (
                        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => loadBids(o.contractId, o.offeringId)}
                          >
                            Load bids
                          </Button>
                          <Input
                            className="max-w-xs"
                            placeholder="Winning bid CID"
                            value={offeringBids[o.contractId] ?? ""}
                            onChange={(e) =>
                              setOfferingBids((prev) => ({
                                ...prev,
                                [o.contractId]: e.target.value,
                              }))
                            }
                          />
                          <Button type="button" size="sm" onClick={() => handleAward(o.contractId, o.offeringId)}>
                            <Award className="size-3.5" />
                            Award bid
                          </Button>
                        </div>
                      )}
                      {capTables[o.receivableId] && (
                        <div className="border-t border-border pt-3">
                          <h3 className="mb-2 font-heading text-sm font-semibold">Cap table</h3>
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            {capTables[o.receivableId]!.map((e) => (
                              <li key={e.entryRef ?? e.participant}>
                                {truncateParty(e.participant, 20)} — {e.shareBps} bps
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "participant" && (
        <>
          <div>
            <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
              Invitations ({invitations.length})
            </h2>
            {invitations.length === 0 ? (
              <EmptyState>No syndication invitations.</EmptyState>
            ) : (
              <div className="grid gap-4">
                {invitations.map((inv) => (
                  <Card key={inv.contractId}>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="font-heading">{inv.offeringId}</strong>
                        <Badge>{inv.roundState}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Lead {truncateParty(inv.leadFinancier, 24)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Face {inv.faceValue} · deadline {inv.deadline}
                      </p>
                      {(inv.roundState === "RoundOpen" ||
                        inv.roundState === "StaticReferenceFallback") && (
                        <form
                          className="border-t border-border pt-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSubmitBid(
                              inv.contractId,
                              inv.offeringId,
                              inv.roundState === "StaticReferenceFallback"
                            );
                          }}
                        >
                          <FieldGroup>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field>
                                <FieldLabel>Share (bps)</FieldLabel>
                                <Input
                                  value={shareBps}
                                  onChange={(e) => setShareBps(e.target.value)}
                                />
                              </Field>
                              <Field>
                                <FieldLabel>Discount rate</FieldLabel>
                                <Input
                                  value={discountRate}
                                  onChange={(e) => setDiscountRate(e.target.value)}
                                />
                              </Field>
                            </div>
                            <Button type="submit">Submit sealed interest</Button>
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
              My Participation Interests ({interests.length})
            </h2>
            {interests.length === 0 ? (
              <EmptyState>No participation interests yet.</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {interests.map((i) => (
                  <Card key={i.contractId}>
                    <strong className="font-heading text-foreground">{i.receivableId}</strong>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {i.shareBps} bps · {i.legalNature} ({i.instrumentClass})
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Face {i.faceValue} {i.currency}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <ActivityLogPanel
        entries={logEntries}
        title="Syndication activity log"
        emptyMessage="Offering, bid, and award actions appear here."
        onClear={clearLog}
        maxHeight="14rem"
      />
    </div>
  );
}
