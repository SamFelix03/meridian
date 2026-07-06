import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog } from "./Dialog";
import { DetailList, DetailRow } from "./DetailList";
import { EmptyState } from "./Alert";

export interface RecordField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface RecordCardItem {
  key: string;
  title: string;
  subtitle?: string;
  badge?: string;
  fields: RecordField[];
}

interface RecordCardGridProps {
  items: RecordCardItem[];
  dialogTitle?: string;
  emptyMessage?: string;
}

export function RecordCardGrid({
  items,
  dialogTitle = "Record details",
  emptyMessage = "No records to display.",
}: RecordCardGridProps) {
  const [selected, setSelected] = useState<RecordCardItem | null>(null);

  if (items.length === 0) {
    return <EmptyState>{emptyMessage}</EmptyState>;
  }

  return (
    <>
      <div className="record-card-grid">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className="record-card"
            onClick={() => setSelected(item)}
          >
            <div className="record-card__head">
              <div className="min-w-0 flex-1 text-left">
                <p className="record-card__title">{item.title}</p>
                {item.subtitle ? (
                  <p className="record-card__subtitle">{item.subtitle}</p>
                ) : null}
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
            {item.badge ? <span className="record-card__badge">{item.badge}</span> : null}
            {item.fields.length > 0 ? (
              <dl className="record-card__preview">
                {item.fields.slice(0, 2).map((field) => (
                  <div key={field.label} className="record-card__preview-row">
                    <dt>{field.label}</dt>
                    <dd className={field.mono ? "font-mono text-xs" : undefined}>{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </button>
        ))}
      </div>

      <Dialog
        open={selected != null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.title ?? dialogTitle}
        description={selected?.subtitle}
      >
        {selected ? (
          <DetailList>
            {selected.fields.map((field) => (
              <DetailRow
                key={field.label}
                term={field.label}
                value={field.value}
                mono={field.mono}
              />
            ))}
          </DetailList>
        ) : null}
      </Dialog>
    </>
  );
}

export function objectToRecordFields(
  obj: Record<string, unknown>,
  options?: { monoKeys?: string[] }
): RecordField[] {
  const monoKeys = new Set(options?.monoKeys ?? ["contractId", "buyer", "supplier", "partyId"]);
  return Object.entries(obj).map(([key, value]) => ({
    label: key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim(),
    value:
      value == null
        ? "—"
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : typeof value === "object"
            ? JSON.stringify(value, null, 2)
            : String(value),
    mono: monoKeys.has(key) || (typeof value === "string" && value.includes("::")),
  }));
}
