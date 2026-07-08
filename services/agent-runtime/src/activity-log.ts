import type { ActivityLogEntry, ActivityLogLevel } from "@meridian/shared-types";

const MAX_LOG_HISTORY = 400;

let logSeq = 0;

export function createLogEntry(
  level: ActivityLogLevel,
  message: string,
  options?: { source?: string; detail?: Record<string, unknown> }
): ActivityLogEntry {
  logSeq += 1;
  return {
    id: `log-${Date.now()}-${logSeq}`,
    timestamp: new Date().toISOString(),
    level,
    source: options?.source ?? "agent-runtime",
    message,
    detail: options?.detail,
  };
}

export class ActivityLogBuffer {
  private entries: ActivityLogEntry[] = [];

  append(entry: ActivityLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_HISTORY) {
      this.entries = this.entries.slice(-MAX_LOG_HISTORY);
    }
  }

  log(
    level: ActivityLogLevel,
    message: string,
    options?: { source?: string; detail?: Record<string, unknown> }
  ): void {
    const entry = createLogEntry(level, message, options);
    this.append(entry);
    const prefix = `[${entry.source}]`;
    if (level === "error") {
      console.error(prefix, message, options?.detail ?? "");
    } else if (level === "warn") {
      console.warn(prefix, message, options?.detail ?? "");
    } else {
      console.log(prefix, message, options?.detail ?? "");
    }
  }

  snapshot(): ActivityLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
