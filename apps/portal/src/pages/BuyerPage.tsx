import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard } from "lucide-react";
import { api, useNotifications, type BuyerObligation, type ReceivableProposal } from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { Alert, EmptyState, PageHeader } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Surface";
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

export function BuyerPage() {
  const [tab, setTab] = usePageTab(["cosign", "obligations"] as const, "cosign");
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
                    <Button type="button" size="sm" onClick={() => cosign(p.contractId)}>
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
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {obligations.map((o) => (
                    <TableRow key={o.contractId}>
                      <TableCell className="font-medium">{o.receivableId}</TableCell>
                      <TableCell>{truncateParty(o.payee, 20)}</TableCell>
                      <TableCell>
                        {o.faceValue} {o.currency}
                      </TableCell>
                      <TableCell>{o.dueDate}</TableCell>
                      <TableCell>
                        {(o.state === "Funded" ||
                          o.state === "PartiallySyndicated" ||
                          o.state === "Overdue" ||
                          !o.state) && (
                          <Button type="button" size="sm" onClick={() => repay(o)}>
                            <CreditCard className="size-3.5" />
                            Repay obligation
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
      )}
    </div>
  );
}
