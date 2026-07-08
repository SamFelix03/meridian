import type { ActivityLogEntry, ActivityLogLevel } from "@meridian/shared-types";

let clientSeq = 0;

export function createClientLogEntry(
  level: ActivityLogLevel,
  message: string,
  options?: { source?: string; detail?: Record<string, unknown> }
): ActivityLogEntry {
  clientSeq += 1;
  return {
    id: `client-${Date.now()}-${clientSeq}`,
    timestamp: new Date().toISOString(),
    level,
    source: options?.source ?? "financier-portal",
    message,
    detail: options?.detail,
  };
}

export function mergeActivityLogs(
  existing: ActivityLogEntry[],
  incoming: ActivityLogEntry[],
  maxEntries = 500
): ActivityLogEntry[] {
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged.slice(-maxEntries);
}

export function formatLogTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
