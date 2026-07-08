import { useCallback, useEffect, useState } from "react";
import { FileText, Plus, Scale, ShieldCheck } from "lucide-react";
import { api, useNotifications, type SupplierReceivable } from "../api";
import { usePageTab } from "../hooks/usePageTab";
import { useActivityLog } from "../hooks/useActivityLog";
import { Alert, EmptyState, PageHeader } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { IssueInvoiceStepForm } from "../components/IssueInvoiceStepForm";
import { Dialog } from "../components/ui/Dialog";
import { Card, Surface } from "../components/ui/Surface";
import { Checkbox, Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PageTabBar } from "../components/ui/PageTabBar";
import { ActivityLogPanel } from "../components/ui/ActivityLogPanel";
import { objectToRecordFields, RecordCardGrid } from "../components/ui/RecordCardGrid";
import { truncateParty } from "../lib/utils";

const SUPPLIER_TABS = ["invoices", "proofs", "consent"] as const;

interface ConsentPolicy {
  contractId?: string;
  buyer?: string;
  supplier?: string;
  masterAgreementId?: string;
  grantedAt?: string;
  allowsAssignment?: boolean;
  [key: string]: unknown;
}

export function SupplierPage() {
  const [tab, setTab] = usePageTab(SUPPLIER_TABS, "invoices");
  const [receivables, setReceivables] = useState<SupplierReceivable[]>([]);
  const [proofs, setProofs] = useState<
    Array<{ receivableId: string; amount: string; settlementRef: string }>
  >([]);
  const [policies, setPolicies] = useState<ConsentPolicy[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [proposing, setProposing] = useState(false);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [invoiceFormToken, setInvoiceFormToken] = useState(0);
  const [faceValue, setFaceValue] = useState("5000");
  const [currency, setCurrency] = useState("USD");
  const [dueDate, setDueDate] = useState("2026-12-31");
  const [consentGranted, setConsentGranted] = useState(true);
  const [maId, setMaId] = useState("MA-DEMO-001");
  const [allowsAssignment, setAllowsAssignment] = useState(true);
  const { entries: logEntries, info, error: logError, clear: clearLog } =
    useActivityLog("supplier-portal");

  const refresh = useCallback(async () => {
    try {
      const [r, p, portfolio] = await Promise.all([
        api.getSupplierReceivables(),
        api.getConsentPolicies(),
        api.getSupplierPortfolio().catch(() => ({ receivables: [], repaymentProofs: [] })),
      ]);
      setReceivables(r.receivables);
      setPolicies(p.policies as ConsentPolicy[]);
      setProofs(portfolio.repaymentProofs ?? []);
      setError("");
    } catch (e) {
      const message = String(e);
      setError(message);
      logError("Failed to refresh supplier data", { error: message });
    }
  }, [logError]);

  const onLedgerNotify = useCallback(() => {
    info("Ledger notification received — refreshing supplier view");
  }, [info]);

  useNotifications("meridian-supplier", refresh, { onNotify: onLedgerNotify });
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handlePropose() {
    setProposing(true);
    setError("");
    setSuccess("");
    info("Submitting invoice proposal", { faceValue, currency, dueDate, consentGranted });
    try {
      const result = await api.proposeInvoice({
        faceValue,
        currency,
        dueDate,
        consentGranted,
      });
      info("Invoice proposed on-ledger", {
        contractId: result.contractId,
        faceValue,
        currency,
      });
      setSuccess(`Proposal created — contract ${result.contractId.slice(0, 24)}…`);
      setInvoiceFormToken((t) => t + 1);
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Invoice proposal failed", { error: message });
    } finally {
      setProposing(false);
    }
  }

  async function handleConsent(e: React.FormEvent) {
    e.preventDefault();
    setCreatingPolicy(true);
    setError("");
    setSuccess("");
    info("Registering consent policy", { masterAgreementId: maId, allowsAssignment });
    try {
      await api.createConsentPolicy({
        masterAgreementId: maId,
        allowsAssignment,
      });
      info("Consent policy registered on-ledger", { masterAgreementId: maId });
      setSuccess(`Standing consent policy registered for ${maId}.`);
      setMaId(`MA-DEMO-${String(policies.length + 1).padStart(3, "0")}`);
      setRegisterOpen(false);
      await refresh();
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Consent policy registration failed", { error: message });
    } finally {
      setCreatingPolicy(false);
    }
  }

  async function handlePostForBid(contractId: string, receivableId: string) {
    setPostingId(contractId);
    info("Posting receivable for bid", { receivableId, contractId });
    try {
      await api.postReceivableForBid(contractId);
      info("Receivable posted for sealed-bid financing", { receivableId });
      await refresh();
      setError("");
    } catch (err) {
      const message = String(err);
      setError(message);
      logError("Post for bid failed", { receivableId, error: message });
    } finally {
      setPostingId(null);
    }
  }

  const activePolicies = policies.filter((p) => p.allowsAssignment !== false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Portal"
        description="Issue invoices, manage assignment consent, and post receivables for sealed-bid financing."
      />

      {error && <Alert variant="destructive">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <PageTabBar
        tabs={[
          { id: "invoices", label: "Invoices & Receivables", count: receivables.length },
          { id: "proofs", label: "Repayment Proofs", count: proofs.length },
          { id: "consent", label: "Assignment Consent", count: policies.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === "invoices" && (
        <div className="space-y-6">
          <Surface title="Issue Invoice" emphasis size="fit">
            <p className="mb-2 text-sm text-muted-foreground">
              Propose a receivable to your buyer. You may grant assignment consent inline for this
              invoice, or rely on a standing policy registered under Assignment Consent.
            </p>
            <IssueInvoiceStepForm
              key={invoiceFormToken}
              faceValue={faceValue}
              onFaceValueChange={setFaceValue}
              currency={currency}
              onCurrencyChange={setCurrency}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
              consentGranted={consentGranted}
              onConsentGrantedChange={setConsentGranted}
              proposing={proposing}
              onSubmit={handlePropose}
            />
          </Surface>

          {receivables.length === 0 ? (
            <EmptyState>No receivables yet — propose an invoice to get started.</EmptyState>
          ) : (
            <div className="grid gap-4">
              {receivables.map((r) => (
                <Card key={r.contractId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileText className="size-4 text-primary" />
                        <strong className="font-heading text-foreground">{r.receivableId}</strong>
                        <Badge>{r.state}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Buyer: {truncateParty(r.buyer)} · {r.faceValue} {r.currency} · due{" "}
                        {r.dueDate}
                      </p>
                    </div>
                    {r.state === "Issued" && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handlePostForBid(r.contractId, r.receivableId)}
                        disabled={postingId === r.contractId}
                      >
                        {postingId === r.contractId ? "Posting…" : "Post for bid"}
                      </Button>
                    )}
                  </div>
                  {r.lineItems.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
                      {r.lineItems.map((li, i) => (
                        <li key={i}>
                          {li.description}: {li.quantity} × {li.unitPrice}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "proofs" && (
        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            On-ledger repayment proofs confirm buyer settlement against funded receivables.
          </p>
          {proofs.length === 0 ? (
            <EmptyState>No repayment proofs recorded yet.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {proofs.map((p) => (
                <Card key={p.receivableId + p.settlementRef}>
                  <strong className="text-foreground">{p.receivableId}</strong>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.amount} · ref {p.settlementRef}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "consent" && (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="flex gap-3 lg:col-span-2">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h3 className="font-heading font-semibold text-foreground">
                  Standing assignment consent
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  An on-ledger{" "}
                  <strong className="font-medium text-foreground">AssignmentConsentPolicy</strong>{" "}
                  binds your supplier persona to a buyer under a master commercial agreement. It
                  authorizes receivable assignment to financiers without repeating consent on every
                  invoice — required before posting receivables for sealed-bid financing.
                </p>
              </div>
            </Card>
            <Card className="justify-center text-center">
              <p className="text-3xl font-semibold text-primary">{activePolicies.length}</p>
              <p className="mt-1 text-sm text-muted-foreground">Active policies on ledger</p>
            </Card>
          </div>

          <Surface
            title="On-Ledger Policies"
            className="w-full"
            action={
              <Button type="button" size="sm" onClick={() => setRegisterOpen(true)}>
                <Plus className="size-4" />
                Register new policy
              </Button>
            }
          >
            <RecordCardGrid
              maxRows={2}
              items={policies.map((policy, index) => {
                const fields = objectToRecordFields(policy as Record<string, unknown>);
                return {
                  key: policy.contractId ?? `policy-${index}`,
                  title: policy.masterAgreementId ?? `Policy ${index + 1}`,
                  subtitle: policy.grantedAt
                    ? `Granted ${new Date(policy.grantedAt).toLocaleString()}`
                    : undefined,
                  badge: policy.allowsAssignment ? "Assignment allowed" : "No assignment",
                  fields,
                };
              })}
              dialogTitle="Consent policy"
              emptyMessage="No standing policies yet. Register one to streamline invoice assignment."
            />
          </Surface>

          <Dialog
            open={registerOpen}
            onOpenChange={setRegisterOpen}
            title="Register consent policy"
            description="Create a standing on-ledger AssignmentConsentPolicy under your master commercial agreement."
          >
            <form onSubmit={handleConsent}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="maId">Master Agreement ID</FieldLabel>
                  <Input
                    id="maId"
                    value={maId}
                    onChange={(e) => setMaId(e.target.value)}
                    placeholder="e.g. MA-ACME-2026"
                  />
                  <FieldDescription>
                    References your commercial framework with the buyer (MSA, supply agreement,
                    etc.).
                  </FieldDescription>
                </Field>
                <Field>
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={allowsAssignment}
                      onChange={(e) => setAllowsAssignment(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium text-foreground">
                        Allow receivable assignment to financiers
                      </span>
                      <FieldDescription className="mt-1">
                        When enabled, financiers can bid on posted receivables covered by this
                        agreement.
                      </FieldDescription>
                    </span>
                  </label>
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRegisterOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creatingPolicy}>
                    <Plus className="size-4" />
                    {creatingPolicy ? "Registering…" : "Register on ledger"}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </Dialog>

          <Card className="flex gap-3 border-primary/20 bg-primary/5">
            <Scale className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Inline vs standing consent:</strong> inline
              consent on an invoice proposal covers a single receivable; standing policies cover
              ongoing trade under the same master agreement and are reused across financing rounds.
            </p>
          </Card>
        </div>
      )}

      <ActivityLogPanel
        entries={logEntries}
        title="Supplier activity log"
        emptyMessage="Invoice proposals, consent policies, and financing posts appear here."
        onClear={clearLog}
        maxHeight="14rem"
      />
    </div>
  );
}
