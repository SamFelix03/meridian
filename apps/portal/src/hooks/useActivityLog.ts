import { useCallback, useRef, useState } from "react";
import type { ActivityLogEntry, ActivityLogLevel } from "@meridian/shared-types";
import { createClientLogEntry, mergeActivityLogs } from "../lib/activity-log";

export function useActivityLog(source: string, maxEntries = 300) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const append = useCallback(
    (level: ActivityLogLevel, message: string, detail?: Record<string, unknown>) => {
      setEntries((logs) =>
        mergeActivityLogs(
          logs,
          [createClientLogEntry(level, message, { source: sourceRef.current, detail })],
          maxEntries
        )
      );
    },
    [maxEntries]
  );

  const appendMany = useCallback(
    (incoming: ActivityLogEntry[]) => {
      setEntries((logs) => mergeActivityLogs(logs, incoming, maxEntries));
    },
    [maxEntries]
  );

  const clear = useCallback(() => setEntries([]), []);

  const info = useCallback(
    (message: string, detail?: Record<string, unknown>) => append("info", message, detail),
    [append]
  );
  const warn = useCallback(
    (message: string, detail?: Record<string, unknown>) => append("warn", message, detail),
    [append]
  );
  const error = useCallback(
    (message: string, detail?: Record<string, unknown>) => append("error", message, detail),
    [append]
  );
  const debug = useCallback(
    (message: string, detail?: Record<string, unknown>) => append("debug", message, detail),
    [append]
  );

  return { entries, append, appendMany, clear, info, warn, error, debug };
}
