import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard } from "lucide-react";
import { api, useNotifications, type BuyerObligation, type ReceivableProposal } from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { useActivityLog } from "../hooks/useActivityLog";
import { Alert, EmptyState, PageHeader } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { ActivityLogPanel } from "../components/ui/ActivityLogPanel";
import { DataTable } from "../components/ui/DataTable";
import { Card } from "../components/ui/Surface";
import { PageTabBar } from "../components/ui/PageTabBar";
import { truncateParty } from "../lib/utils";

export function BuyerPage() {
  const [tab, setTab] = usePageTab(["cosign", "obligations"] as const, "cosign");
  const [obligations, setObligations] = useState<BuyerObligation[]>([]);
  const [proposals, setProposals] = useState<ReceivableProposal[]>([]);
  const [error, setError] = useState("");
  const { entries: logEntries, info, error: logError, debug, clear: clearLog } =
    useActivityLog("buyer-portal");

  const refresh = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([
        api.getBuyerRepayable().catch(() => api.getBuyerObligations()),
        api.getBuyerProposals(),
      ]);
      setObligations(o.obligations);
      setProposals(p.proposals);
      setError("");
      debug("Buyer data refreshed", {
        obligations: o.obligations.length,
        proposals: p.proposals.length,
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      logError("Failed to refresh buyer data", { error: message });
    }
  }, [debug, logError]);

  const onLedgerNotify = useCallback(() => {
    info("Ledger notification received — refreshing buyer view");
  }, [info]);

  useNotifications("meridian-buyer", refresh, { onNotify: onLedgerNotify });
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function cosign(contractId: string, proposalId: string) {
    info("Co-signing invoice proposal", { proposalId, contractId });
    try {
      await api.cosignInvoice(contractId);
      info("Invoice co-signed and issued on-ledger", { proposalId });
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Co-sign failed", { proposalId, error: message });
    }
  }

  async function repay(o: BuyerObligation) {
    const settlementRef = `portal-${o.receivableId}-${Date.now()}`;
    info("Submitting repayment", {
      receivableId: o.receivableId,
      faceValue: o.faceValue,
      settlementRef,
    });
    try {
      await api.repayObligation(o.contractId, {
        faceValue: o.faceValue,
        payeePartyId: o.payee,
        settlementRef,
      });
      info("Repayment submitted on-ledger", {
        receivableId: o.receivableId,
        settlementRef,
      });
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Repayment failed", { receivableId: o.receivableId, error: message });
    }
  }

  function canRepay(o: BuyerObligation) {
    return (
      o.state === "Funded" ||
      o.state === "PartiallySyndicated" ||
      o.state === "Overdue" ||
      !o.state
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buyer Portal"
        description="IBuyerView only — payee, amount, due date. No line items or supplier economics."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <PageTabBar
        tabs={[
          { id: "cosign", label: "Pending Co-Signature", count: proposals.length },
          { id: "obligations", label: "Obligations", count: obligations.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "cosign" && (
        <div>
          {proposals.length === 0 ? (
            <EmptyState>No proposals awaiting co-signature.</EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {proposals.map((p) => (
                <Card key={p.contractId}>
                  <div className="space-y-3">
                    <div>
                      <strong className="font-heading text-foreground">{p.proposalId}</strong>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {p.faceValue} {p.currency} · due {p.dueDate}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => cosign(p.contractId, p.proposalId)}
                    >
                      <CheckCircle2 className="size-4" />
                      Co-Sign &amp; Issue
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "obligations" && (
        <div>
          {obligations.length === 0 ? (
            <EmptyState>No outstanding obligations.</EmptyState>
          ) : (
            <DataTable
              data={obligations}
              rowKey={(o) => o.contractId}
              emptyMessage="No outstanding obligations."
              detailTitle={(o) => o.receivableId}
              detailDescription={(o) => `${o.faceValue} ${o.currency} · due ${o.dueDate}`}
              detailFields={(o) => [
                { label: "Invoice", value: o.receivableId },
                { label: "Payee", value: truncateParty(o.payee, 40), mono: true },
                { label: "Amount", value: `${o.faceValue} ${o.currency}` },
                { label: "Due date", value: o.dueDate },
                { label: "State", value: o.state ?? "—" },
                { label: "Contract ID", value: o.contractId, mono: true },
              ]}
              columns={[
                {
                  id: "invoice",
                  header: "Invoice",
                  cell: (o) => <span className="font-medium">{o.receivableId}</span>,
                },
                {
                  id: "payee",
                  header: "Payee",
                  cell: (o) => truncateParty(o.payee, 20),
                },
                {
                  id: "amount",
                  header: "Amount",
                  cell: (o) => `${o.faceValue} ${o.currency}`,
                },
                {
                  id: "due",
                  header: "Due date",
                  cell: (o) => o.dueDate,
                },
                {
                  id: "action",
                  header: "Action",
                  isAction: true,
                  align: "right",
                  cell: (o) =>
                    canRepay(o) ? (
                      <Button type="button" size="sm" onClick={() => repay(o)}>
                        <CreditCard className="size-3.5" />
                        Repay
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          )}
        </div>
      )}

      <ActivityLogPanel
        entries={logEntries}
        title="Buyer activity log"
        emptyMessage="Co-sign and repayment actions will appear here."
        onClear={clearLog}
        maxHeight="14rem"
      />
    </div>
  );
}
