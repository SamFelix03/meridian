import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Info } from "lucide-react";
import { Button, buttonVariants } from "./Button";
import { cn } from "../../lib/utils";

export function Alert({
  variant = "default",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "destructive" | "success";
}) {
  const Icon =
    variant === "destructive" ? AlertCircle : variant === "success" ? CheckCircle2 : Info;

  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
        variant === "destructive" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        variant === "success" && "border-success/30 bg-success/10 text-success",
        variant === "default" && "border-border bg-muted/40 text-foreground",
        className
      )}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <h2 className="mb-3 font-heading text-lg font-semibold text-foreground">
      {children}
      {count != null && (
        <span className="ml-2 text-sm font-normal text-muted-foreground">({count})</span>
      )}
    </h2>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

interface GuidanceAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

export function GuidancePanel({
  title,
  description,
  steps,
  primaryAction,
  secondaryAction,
  className,
}: {
  title: string;
  description: string;
  steps?: string[];
  primaryAction?: GuidanceAction;
  secondaryAction?: GuidanceAction;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[min(var(--radius-3xl),24px)] border border-dashed border-border bg-muted/15 px-6 py-10 text-center",
        className
      )}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
        <FileText className="size-5" />
      </div>
      <h3 className="font-heading text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>

      {steps && steps.length > 0 ? (
        <ol className="mt-6 w-full max-w-lg space-y-2 text-left text-sm text-muted-foreground">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-0.5 leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {primaryAction?.to ? (
          <Link to={primaryAction.to} className={buttonVariants()}>
            {primaryAction.label}
            <ArrowRight className="size-4" />
          </Link>
        ) : primaryAction?.onClick ? (
          <Button type="button" onClick={primaryAction.onClick}>
            {primaryAction.label}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}

        {secondaryAction?.to ? (
          <Link to={secondaryAction.to} className={buttonVariants({ variant: "outline" })}>
            {secondaryAction.label}
          </Link>
        ) : secondaryAction?.onClick ? (
          <Button type="button" variant="outline" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
      {children}
    </pre>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">
      {children}
    </code>
  );
}
