export type HostStatus = { checkedAt: string; diskUsedPercent: number | null; memoryAvailablePercent: number | null; databaseConnections: number | null; databaseLimit: number | null; appHealth: string; oomKilled: boolean | null; image: string | null };
export type MonitorEntry = { runId: string; checkedAt: string; readiness: string; backup: string; recipientSource: string | null; status: string; kind: string | null; channels: { channel: string; accepted: number; failed: number }[] };
export function recent(timestamp: unknown, maxAge: number, now?: number): boolean;
export function safeHostStatus(value: unknown): HostStatus | null;
export function safeMonitorEntry(value: unknown): MonitorEntry | null;
export function safeMonitorHistory(value: unknown): MonitorEntry[];
