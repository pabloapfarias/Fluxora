import type { WorkflowEvent } from "@fluxora/shared";

const ANSI_PATTERN = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

export function normalizeLogText(input: string): string {
  return stripAnsi(input)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .trim();
}

export function parseEventMetadata(metadata?: string): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function formatDurationMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function isStreamEvent(event: WorkflowEvent): boolean {
  return event.type === "opencode.stdout" || event.type === "opencode.stderr";
}

export function isTimeoutEvent(event: WorkflowEvent): boolean {
  const metadata = parseEventMetadata(event.metadata);
  const status = typeof metadata?.status === "string" ? metadata.status.toLowerCase() : "";
  const text = `${event.type} ${event.message} ${event.metadata || ""}`.toLowerCase();
  return status === "timeout" || text.includes("timeout") || text.includes("tempo limite");
}

export function summarizeEventMessage(event: WorkflowEvent, max = 120): string {
  const clean = normalizeLogText(event.message).replace(/^(STDOUT|STDERR):\s*/i, "");
  if (isStreamEvent(event)) {
    const source = event.type === "opencode.stderr" ? "stderr" : "stdout";
    const firstLine = clean.split("\n").find(Boolean) || "saída capturada";
    const short = firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
    return `Fluxora stream ${source}: ${short}`;
  }
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
