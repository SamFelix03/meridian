import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import type { ActivityLogEntry } from "@meridian/shared-types";
import { Button } from "./Button";
import { EmptyState } from "./Alert";
import { cn } from "../../lib/utils";
import { formatLogTimestamp } from "../../lib/activity-log";

export interface ActivityLogPanelProps {
  entries: ActivityLogEntry[];
  title?: string;
  emptyMessage?: string;
  onClear?: () => void;
  className?: string;
  maxHeight?: string;
}

const LEVEL_CLASS: Record<ActivityLogEntry["level"], string> = {
  debug: "activity-log__level--debug",
  info: "activity-log__level--info",
  warn: "activity-log__level--warn",
  error: "activity-log__level--error",
};

export function ActivityLogPanel({
  entries,
  title = "Activity log",
  emptyMessage = "No log entries yet. Run an action to capture output here.",
  onClear,
  className,
  maxHeight = "18rem",
}: ActivityLogPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <section
      className={cn("activity-log", className)}
      aria-label={title}
      style={{ "--activity-log-max-h": maxHeight } as React.CSSProperties}
    >
      <header className="activity-log__header">
        <div>
          <h4 className="activity-log__title">{title}</h4>
          <p className="activity-log__meta">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        {onClear && entries.length > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </header>

      <div
        ref={viewportRef}
        className="activity-log__viewport"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {entries.length === 0 ? (
          <div className="activity-log__empty">
            <EmptyState>{emptyMessage}</EmptyState>
          </div>
        ) : (
          <ol className="activity-log__list">
            {entries.map((entry) => (
              <li key={entry.id} className="activity-log__entry">
                <span className="activity-log__time" title={entry.timestamp}>
                  {formatLogTimestamp(entry.timestamp)}
                </span>
                <span className={cn("activity-log__level", LEVEL_CLASS[entry.level])}>
                  {entry.level.toUpperCase()}
                </span>
                <span className="activity-log__source">{entry.source}</span>
                <span className="activity-log__message">{entry.message}</span>
                {entry.detail && Object.keys(entry.detail).length > 0 ? (
                  <pre className="activity-log__detail">
                    {JSON.stringify(entry.detail, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
