import { cn } from "../../lib/utils";

export function Surface({
  className,
  emphasis = false,
  title,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  emphasis?: boolean;
  title?: string;
}) {
  return (
    <section
      data-slot="surface"
      className={cn(
        "flex flex-col rounded-[min(var(--radius-3xl),24px)] border border-border bg-card p-5 shadow-[0_1px_0_0_color-mix(in_oklch,white_4%,transparent)_inset,0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-2xl",
        emphasis && "border-primary/25 bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))]",
        className
      )}
      {...props}
    >
      {title && (
        <header className="mb-4">
          <h3
            className={cn(
              "font-heading text-base font-semibold",
              emphasis ? "text-primary" : "text-foreground"
            )}
          >
            {title}
          </h3>
        </header>
      )}
      {children}
    </section>
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-4 rounded-[min(var(--radius-3xl),20px)] border border-border bg-card/80 p-4 text-sm shadow-sm backdrop-blur-xl",
        className
      )}
      {...props}
    />
  );
}
