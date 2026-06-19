import { useEffect, useRef, useState } from "react";
import { FileText, ChevronDown, ChevronRight, Copy, Check, Trash2 } from "lucide-react";
import type { WorkflowEvent, ChangedFile, FileDiff } from "@fluxora/shared";
import { DiffViewer } from "../diff/DiffViewer";
import { formatEventType } from "../../lib/presentationLabels";
import { ActionButton } from "../ui";
import {
  formatDurationMs,
  isStreamEvent,
  isTimeoutEvent,
  normalizeLogText,
  parseEventMetadata,
  summarizeEventMessage,
} from "../../lib/logFormatting";

interface EventLogProps {
  events: WorkflowEvent[];
  workflowRunId?: string;
  activeTab?: EventLogTab;
  onTabChange?: (tab: EventLogTab) => void;
  visibleTabs?: EventLogTab[];
  /** Callback acionado quando o usuário confirma a limpeza manual. */
  onClear?: () => void;
}

export type EventLogTab = "timeline" | "logs" | "files" | "comments";

/**
 * Cores moderadas para fontes de evento.
 * Vermelho (accent/error) é reservado exclusivamente para falhas e rejeições.
 * Amber (terminal) para aprovações e alertas.
 * Verde para conclusões bem-sucedidas.
 * Tons neutros para tudo o demais — sem poluição visual.
 */
const eventTypeColors: Record<string, string> = {
  // Workflow
  "workflow.created": "text-text-secondary",
  "workflow.started": "text-accent-terminal",
  "workflow.completed": "text-success",
  "workflow.failed": "text-error",
  "workflow.real.started": "text-accent-terminal",
  "workflow.real.completed": "text-success",
  "workflow.real.failed": "text-error",
  "workflow.cancelled": "text-warning",
  // Approval
  "approval.required": "text-warning",
  "approval.created": "text-warning",
  "approval.approved": "text-success",
  "approval.rejected": "text-error",
  "approval.final.required": "text-warning",
  "approval.final.approved": "text-success",
  "approval.final.rejected": "text-error",
  // Step / Agent
  "step.started": "text-text-muted",
  "step.completed": "text-success",
  "agent.started": "text-text-secondary",
  "agent.completed": "text-success",
  // QA
  "qa.started": "text-text-muted",
  "qa.passed": "text-success",
  // OpenCode
  "opencode.detect.started": "text-text-secondary",
  "opencode.detect.completed": "text-success",
  "opencode.detect.failed": "text-error",
  "opencode.process.started": "text-text-secondary",
  "opencode.process.completed": "text-success",
  "opencode.process.failed": "text-error",
  "opencode.process.cancelled": "text-warning",
  "opencode.stdout": "text-text-muted",
  "opencode.stderr": "text-warning",
  "opencode.json_event": "text-text-secondary",
  // Git
  "git.changed_files.detected": "text-text-secondary",
  "git.diff.generated": "text-success",
  // Security
  "security.warning": "text-warning",
  // Controlled execution
  "controlled_execution.started": "text-text-secondary",
  "controlled_execution.sandbox_ready": "text-success",
  "controlled_execution.before_git_status_captured": "text-text-muted",
  "controlled_execution.opencode_started": "text-text-secondary",
  "controlled_execution.opencode_json_event": "text-text-secondary",
  "controlled_execution.opencode_completed": "text-success",
  "controlled_execution.after_git_status_captured": "text-text-muted",
  "controlled_execution.changed_files_detected": "text-text-secondary",
  "controlled_execution.diff_generated": "text-success",
  "controlled_execution.out_of_scope_changes": "text-warning",
  "controlled_execution.final_approval_required": "text-warning",
  "controlled_execution.completed": "text-success",
  "controlled_execution.failed": "text-error",
  "controlled_execution.cancelled": "text-warning",
  "controlled_execution.ui_started": "text-text-muted",
  "controlled_execution.ui_cancel_requested": "text-warning",
  "controlled_execution.ui_opened_diff": "text-text-muted",
  "controlled_execution.ui_report_copied": "text-text-muted",
  "controlled_execution.approved": "text-success",
  "controlled_execution.rejected": "text-error",
};

/**
 * Cores para os chips de fonte (source chips).
 * Segue a mesma lógica moderada: neutro para a maioria,
 * amber para alertas, verde para sucesso, vermelho só para erro.
 */
const sourceChipColors: Record<string, string> = {
  error: "flux-chip-error",
  warning: "flux-chip-warning",
  success: "flux-chip-success",
  default: "flux-chip-default",
};

function getSourceChipTone(type: string): string {
  if (type.includes("failed") || type.includes("rejected")) return sourceChipColors.error;
  if (type.includes("warning") || type.includes("approval") || type.includes("cancelled")) return sourceChipColors.warning;
  if (type.includes("completed") || type.includes("approved") || type.includes("passed")) return sourceChipColors.success;
  return sourceChipColors.default;
}

function getEventChipTone(event: WorkflowEvent): string {
  if (isTimeoutEvent(event)) return sourceChipColors.error;
  return getSourceChipTone(event.type);
}

const fileStatusPill: Record<string, string> = {
  added: "flux-pill-success",
  modified: "flux-pill-accent",
  deleted: "flux-pill-error",
  renamed: "flux-pill-warning",
  untracked: "flux-pill-muted",
};

export function EventLog({ events, workflowRunId, activeTab, onTabChange, visibleTabs, onClear }: EventLogProps) {
  const [internalTab, setInternalTab] = useState<EventLogTab>(activeTab || "timeline");
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, string | null>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState<string>("");
  const lastEventIdRef = useRef<string | null>(null);

  const tab = activeTab || internalTab;

  useEffect(() => {
    if (activeTab) setInternalTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!workflowRunId) {
      setChangedFiles([]);
      setDiffCache({});
      setExpanded(null);
      return;
    }
    let mounted = true;
    window.fluxora.git.changedFiles(workflowRunId).then((files) => {
      if (mounted) setChangedFiles(files);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [workflowRunId]);

  // Live region: anuncia novos eventos para leitores de tela
  useEffect(() => {
    if (events.length === 0) {
      lastEventIdRef.current = null;
      setAnnouncement("");
      return;
    }
    const last = events[events.length - 1];
    if (last.id !== lastEventIdRef.current) {
      lastEventIdRef.current = last.id;
      setAnnouncement(`${formatEventType(last.type)}: ${last.message}`);
    }
  }, [events]);

  const handleCopy = async () => {
    try {
      const text = events
        .map((e) => `${new Date(e.createdAt).toLocaleTimeString()} [${e.type}] ${e.message}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleClear = () => {
    if (!onClear) return;
    const confirmed = window.confirm(
      "Limpar logs e timeline desta tela? O histórico salvo das execuções não será removido."
    );
    if (!confirmed) return;
    onClear();
  };

  const expandFile = async (file: ChangedFile) => {
    const key = file.path;
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    if (!workflowRunId) return;
    if (diffCache[key] !== undefined) return;
    setLoadingDiff(key);
    try {
      const fd: FileDiff | null = await window.fluxora.git.fileDiff(workflowRunId, key);
      setDiffCache((prev) => ({ ...prev, [key]: fd?.diff || `Sem diff para ${key}` }));
    } catch (err) {
      setDiffCache((prev) => ({ ...prev, [key]: `Erro ao carregar diff: ${err instanceof Error ? err.message : "erro"}` }));
    } finally {
      setLoadingDiff(null);
    }
  };

  const setTab = (nextTab: EventLogTab) => {
    if (!activeTab) setInternalTab(nextTab);
    onTabChange?.(nextTab);
  };

  const tabs: { id: EventLogTab; label: string; count?: number }[] = [
    { id: "timeline", label: "Timeline" },
    { id: "logs", label: "Logs" },
    { id: "files", label: "Arquivos", count: changedFiles.length || undefined },
    { id: "comments", label: "Comentários" },
  ];
  const renderedTabs = visibleTabs ? tabs.filter((entry) => visibleTabs.includes(entry.id as EventLogTab)) : tabs;

  return (
    <div
      className="overflow-hidden flex flex-col rounded-xl border border-border-subtle h-[520px] min-h-[520px]"
      style={{ backgroundColor: "var(--bg-base)" }}
      role="region"
      aria-label="Terminal de eventos da missão"
    >
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {/* ── Tab bar ── */}
      <div
        className="flex items-center justify-between border-b border-border-subtle px-1"
        style={{ backgroundColor: "var(--bg-deep)" }}
        role="tablist"
        aria-label="Seções do terminal"
      >
        <div className="flex">
          {renderedTabs.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`no-drag relative px-4 py-3 text-[11.5px] font-semibold tracking-wide uppercase transition-colors flex items-center gap-2 ${
                  isActive
                    ? "text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`text-[9.5px] px-1.5 py-px rounded-md font-bold tabular-nums ${
                      isActive
                        ? "bg-accent/15 text-accent border border-accent/25"
                        : "bg-bg-elevated text-text-muted border border-border-subtle"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
                {isActive && (
                  <span
                    className="absolute left-2 right-2 -bottom-px h-px rounded-full"
                    style={{ backgroundColor: "var(--accent)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 pr-2">
          {onClear && (
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={handleClear}
              title="Limpar logs e timeline"
              icon={<Trash2 size={12} />}
              disabled={events.length === 0}
            >
              Limpar
            </ActionButton>
          )}
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            title="Copiar logs"
            icon={copied ? <Check size={12} /> : <Copy size={12} />}
          >
            {copied ? "Copiado" : "Copiar"}
          </ActionButton>
        </div>
      </div>

      {/* ── Tab panels ── */}
      <div className="flex-1 min-h-0">
        <div
          role="tabpanel"
          id="panel-timeline"
          aria-hidden={tab !== "timeline"}
          className={tab === "timeline" ? "block" : "hidden"}
        >
          <TimelineView events={events} />
        </div>
        <div
          role="tabpanel"
          id="panel-logs"
          aria-hidden={tab !== "logs"}
          className={tab === "logs" ? "block" : "hidden"}
        >
          <LogsView events={events} />
        </div>
        <div
          role="tabpanel"
          id="panel-files"
          aria-hidden={tab !== "files"}
          className={tab === "files" ? "block" : "hidden"}
        >
          <FilesView
            files={changedFiles}
            expanded={expanded}
            loadingDiff={loadingDiff}
            diffCache={diffCache}
            onExpand={expandFile}
          />
        </div>
        <div
          role="tabpanel"
          id="panel-comments"
          aria-hidden={tab !== "comments"}
          className={tab === "comments" ? "block" : "hidden"}
        >
          <CommentsView events={events} />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * TimelineView — visão cronológica compacta
 * ────────────────────────────────────────────────────────────────────── */

function TimelineView({ events }: { events: WorkflowEvent[] }) {
  const items = buildTimelineItems(events);
  return (
    <div
      className="flux-terminal-scroll h-[452px] overflow-auto"
      style={{ backgroundColor: "var(--bg-deep)" }}
    >
      {items.length === 0 ? (
        <EmptyState message="Nenhum evento registrado" />
      ) : (
        <div className="font-mono text-[12.5px] leading-relaxed py-3 px-4">
          {items.map((item) => {
            return (
              <div
                key={item.id}
                className={`flex items-start gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.03] transition-colors ${
                  item.tone === "error" ? "bg-error/5" : ""
                }`}
              >
                <time
                  className="flex-shrink-0 w-[72px] tabular-nums text-[11px] text-text-muted pt-1"
                  dateTime={item.createdAt}
                >
                  {formatTime(item.createdAt)}
                </time>

                <span className={`flex-shrink-0 mt-0.5 min-w-[86px] justify-center ${timelineChipClass(item.tone)}`}>
                  {item.category}
                </span>

                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-semibold ${timelineTitleClass(item.tone)}`}>
                    {item.title}
                  </div>
                  <div className="flux-secondary-text mt-0.5 whitespace-pre-wrap break-words">
                    {item.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * LogsView — terminal premium com fonte mono, chips de fonte e scroll custom
 * ────────────────────────────────────────────────────────────────────── */

function LogsView({ events }: { events: WorkflowEvent[] }) {
  return (
    <div
      className="flux-terminal-scroll h-[452px] overflow-auto"
      style={{ backgroundColor: "var(--bg-deep)" }}
    >
      {events.length === 0 ? (
        <EmptyState message="Aguardando execução. Envie uma missão para acompanhar logs em tempo real." />
      ) : (
        <div className="font-mono text-[12.5px] leading-relaxed py-3 px-4">
          {events.map((e) => {
            const chipTone = getEventChipTone(e);
            const metadata = parseEventMetadata(e.metadata);
            const showDetails = Boolean(metadata && hasTechnicalDetails(metadata));
            const isTechnical = isStreamEvent(e) || showDetails;
            const cleanMessage = normalizeLogText(e.message).replace(/^(STDOUT|STDERR):\s*/i, "");
            return (
              <div
                key={e.id}
                className={`flex items-start gap-3 py-[7px] px-2 -mx-2 rounded-md hover:bg-white/[0.03] transition-colors ${
                  isTimeoutEvent(e) ? "bg-error/5" : ""
                }`}
              >
                {/* Timestamp fixo e alinhado */}
                <time
                  className="flex-shrink-0 w-[72px] tabular-nums text-[11px] text-text-muted select-all pt-0.5"
                  dateTime={e.createdAt}
                >
                  {formatTime(e.createdAt)}
                </time>

                {/* Source chip — usa categoria do metadata quando disponível */}
                <span className={`flex-shrink-0 mt-0.5 ${chipTone}`}>
                  {extractCategory(e.type, e.metadata)}
                </span>

                <div className="flux-secondary-text flex-1 min-w-0 space-y-2">
                  {isTechnical ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-black/35 px-3 py-2 text-[11.5px] leading-relaxed text-text-secondary overflow-x-auto">
                      {cleanMessage}
                    </pre>
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{cleanMessage}</span>
                  )}
                  {metadata && showDetails && <EventMetadataDetails metadata={metadata} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EventMetadataDetails({ metadata, defaultOpen = false }: { metadata: Record<string, unknown>; defaultOpen?: boolean }) {
  const rawRows: Array<[string, unknown]> = [
    ["Agente", metadata.agent],
    ["Papel", metadata.agentRole],
    ["Motor", metadata.engine],
    ["Estratégia", metadata.strategy],
    ["Status", metadata.status],
    ["Timeout", typeof metadata.timeoutMs === "number" ? formatDurationMs(metadata.timeoutMs) : undefined],
    ["Duração", typeof metadata.durationMs === "number" ? formatDurationMs(metadata.durationMs) : undefined],
    ["Exit code", metadata.exitCode],
    ["Modelo", metadata.model],
    ["Diretório", metadata.cwd],
  ];
  const rows = rawRows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  const command = typeof metadata.command === "string" ? metadata.command : null;
  const args = Array.isArray(metadata.args) ? metadata.args.map(String) : null;
  const stderrTail = typeof metadata.stderrTail === "string" ? normalizeLogText(metadata.stderrTail) : "";
  const stdoutTail = typeof metadata.stdoutTail === "string" ? normalizeLogText(metadata.stdoutTail) : "";

  return (
    <details open={defaultOpen} className="rounded-md border border-border-subtle bg-bg-base/70 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-semibold text-text-secondary">Detalhes técnicos</summary>
      <div className="mt-2 space-y-2 text-[11px]">
        {rows.length > 0 && (
          <div className="grid gap-1 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <span className="text-text-muted">{label}: </span>
                <span className="text-text-secondary break-words">{String(value)}</span>
              </div>
            ))}
          </div>
        )}
        {(command || args) && (
          <pre className="overflow-x-auto rounded bg-black/40 p-2 text-text-secondary whitespace-pre-wrap break-words">
            {[command, ...(args || [])].filter(Boolean).join(" ")}
          </pre>
        )}
        {stderrTail && <LogTail title="Stderr" text={stderrTail} tone="error" />}
        {stdoutTail && <LogTail title="Stdout" text={stdoutTail} tone="default" />}
      </div>
    </details>
  );
}

function LogTail({ title, text, tone }: { title: string; text: string; tone: "default" | "error" }) {
  return (
    <div>
      <div className={tone === "error" ? "text-error" : "text-text-muted"}>{title}</div>
      <pre className="mt-1 max-h-72 overflow-auto rounded bg-black/45 p-2 text-text-secondary whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * FilesView — lista de arquivos alterados com diff expansível
 * ────────────────────────────────────────────────────────────────────── */

function FilesView({
  files,
  expanded,
  loadingDiff,
  diffCache,
  onExpand,
}: {
  files: ChangedFile[];
  expanded: string | null;
  loadingDiff: string | null;
  diffCache: Record<string, string | null>;
  onExpand: (file: ChangedFile) => void;
}) {
  if (files.length === 0) {
    return <EmptyState message="Nenhum arquivo alterado ainda — execute um workflow em modo real para popular." />;
  }
  return (
    <div className="flux-terminal-scroll h-[452px] overflow-auto p-3 space-y-1">
      {files.map((f) => {
        const isOpen = expanded === f.path;
        return (
          <div
            key={f.id}
            className="rounded-lg border border-border-subtle overflow-hidden"
            style={{ backgroundColor: "var(--bg-surface)" }}
          >
            <button
              onClick={() => onExpand(f)}
              className="no-drag w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left"
              aria-expanded={isOpen}
            >
              <span className="text-text-muted flex-shrink-0">
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
              <FileText size={13} className="text-text-muted flex-shrink-0" />
              <span className="font-mono text-[11.5px] text-text-primary flex-1 truncate">{f.path}</span>
              <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0 font-mono">
                +{f.additions}/-{f.deletions}
              </span>
              <span className={`flex-shrink-0 ${fileStatusPill[f.status] || "flux-pill-muted"}`}>{f.status}</span>
            </button>
            {isOpen && (
              <div
                className="border-t border-border-subtle p-2 max-h-96 overflow-auto flux-terminal-scroll"
                style={{ backgroundColor: "var(--bg-deep)" }}
              >
                {loadingDiff === f.path ? (
                  <div className="text-[11px] text-text-muted py-3 text-center font-mono">Carregando diff...</div>
                ) : (
                  <DiffViewer
                    diff={diffCache[f.path] || ""}
                    filePath={f.path}
                    maxLines={500}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * CommentsView — comentários do sistema
 * ────────────────────────────────────────────────────────────────────── */

function CommentsView({ events }: { events: WorkflowEvent[] }) {
  const systemComments = events
    .filter((e) => e.type.startsWith("approval") || e.type.startsWith("git") || e.type.startsWith("workflow"))
    .slice(0, 6);
  if (systemComments.length === 0) {
    return <EmptyState message="Sem comentários do sistema ainda" />;
  }
  return (
    <div className="flux-terminal-scroll h-[452px] overflow-auto p-3 space-y-1.5">
      {systemComments.map((e) => {
        const who = e.type.startsWith("approval") ? "Aprovação" : e.type.startsWith("git") ? "Git" : "Sistema";
        return (
          <div
            key={e.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border-subtle transition-colors hover:bg-white/[0.02]"
            style={{ backgroundColor: "var(--bg-surface)" }}
          >
            <div
              className="w-7 h-7 rounded-md text-[11px] font-bold flex items-center justify-center flex-shrink-0 border border-border-subtle"
              style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              aria-hidden="true"
            >
              {who[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className="text-text-primary font-medium">{who}</span>
                <time className="text-text-muted tabular-nums" dateTime={e.createdAt}>
                  {formatTime(e.createdAt)}
                </time>
              </div>
              <div className="flux-secondary-text mt-0.5">{e.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ────────────────────────────────────────────────────────────────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-text-muted py-10 text-center text-[12px] font-mono px-4">
      {message}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour12: false });
}

type TimelineTone = "default" | "success" | "warning" | "error" | "accent";

interface TimelineItem {
  id: string;
  createdAt: string;
  category: string;
  title: string;
  description: string;
  tone: TimelineTone;
}

function buildTimelineItems(events: WorkflowEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const mission = firstEvent(events, "mission.received") || firstEvent(events, "workflow.created");
  if (mission) {
    const project = messageValue(firstEvent(events, "mission.project"), "Projeto selecionado:");
    const mode = messageValue(firstEvent(events, "mission.mode"), "Modo:");
    const path = messageValue(firstEvent(events, "mission.path"), "Caminho:");
    const lines = [summarizeEventMessage(mission, 180), project && `Projeto: ${project}`, mode && `Modo: ${mode}`, path && `Pasta: ${path}`].filter(Boolean);
    items.push({
      id: `timeline-prep-${mission.id}`,
      createdAt: mission.createdAt,
      category: "MISSÃO",
      title: "Missão preparada",
      description: lines.join("\n"),
      tone: "accent",
    });
  }

  const started = firstEvent(events, "opencode.process.started") || firstEvent(events, "workflow.real.started");
  if (started) {
    const meta = parseEventMetadata(started.metadata) || {};
    const description = [
      meta.agent ? `Agente: ${meta.agent}` : "Agente iniciado",
      meta.model ? `Modelo: ${meta.model}` : null,
      meta.timeoutMs && typeof meta.timeoutMs === "number" ? `Tempo limite: ${formatDurationMs(meta.timeoutMs)}` : null,
      meta.engine ? `Motor: ${meta.engine}` : "Motor: Fluxora",
    ].filter(Boolean).join("\n");
    items.push({
      id: `timeline-agent-${started.id}`,
      createdAt: started.createdAt,
      category: "AGENTE",
      title: "Agente iniciado",
      description,
      tone: "default",
    });
  }

  const firstStream = events.find((event) => isStreamEvent(event));
  if (firstStream) {
    items.push({
      id: `timeline-work-${firstStream.id}`,
      createdAt: firstStream.createdAt,
      category: "STREAM",
      title: "Trabalhando no projeto",
      description: "O agente começou a analisar e alterar os arquivos necessários.",
      tone: "default",
    });
  }

  const failure = events.find((event) => event.type.includes("failed") || isTimeoutEvent(event));
  const success = [...events].reverse().find((event) => event.type.includes("completed") && !isTimeoutEvent(event));
  const final = failure || success;
  if (final) {
    const meta = parseEventMetadata(final.metadata) || {};
    const timedOut = isTimeoutEvent(final);
    items.push({
      id: `timeline-final-${final.id}`,
      createdAt: final.createdAt,
      category: timedOut || failure ? "ERRO" : "SISTEMA",
      title: timedOut ? "Tempo limite atingido" : failure ? "Execução interrompida" : "Execução concluída",
      description: timedOut
        ? `A execução passou do limite de ${formatDurationMs(typeof meta.timeoutMs === "number" ? meta.timeoutMs : undefined)} e foi interrompida.`
        : summarizeEventMessage(final, 220),
      tone: timedOut || failure ? "error" : "success",
    });
  }

  if (items.length > 0) return items;
  return events
    .filter((event) => !isStreamEvent(event))
    .map((event) => ({
      id: `timeline-${event.id}`,
      createdAt: event.createdAt,
      category: extractCategory(event.type, event.metadata),
      title: humanTimelineTitle(event),
      description: summarizeEventMessage(event, 220),
      tone: event.type.includes("failed") ? "error" : event.type.includes("completed") ? "success" : "default",
    }));
}

function firstEvent(events: WorkflowEvent[], type: string): WorkflowEvent | undefined {
  return events.find((event) => event.type === type);
}

function messageValue(event: WorkflowEvent | undefined, prefix: string): string | null {
  if (!event) return null;
  const message = normalizeLogText(event.message);
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
}

function humanTimelineTitle(event: WorkflowEvent): string {
  if (isTimeoutEvent(event)) return "Tempo limite atingido";
  if (event.type.startsWith("approval")) return "Aprovação atualizada";
  if (event.type.startsWith("mission")) return "Missão atualizada";
  if (event.type.startsWith("opencode")) return "Stream atualizado";
  if (event.type.startsWith("git")) return "Arquivos analisados";
  if (event.type.includes("failed")) return "Execução falhou";
  if (event.type.includes("completed")) return "Etapa concluída";
  return formatEventType(event.type);
}

function timelineChipClass(tone: TimelineTone): string {
  if (tone === "error") return sourceChipColors.error;
  if (tone === "warning") return sourceChipColors.warning;
  if (tone === "success") return sourceChipColors.success;
  return sourceChipColors.default;
}

function timelineTitleClass(tone: TimelineTone): string {
  if (tone === "error") return "text-error";
  if (tone === "warning") return "text-warning";
  if (tone === "success") return "text-success";
  if (tone === "accent") return "text-accent";
  return "text-text-primary";
}

function hasTechnicalDetails(metadata: Record<string, unknown>): boolean {
  const relevant = [
    "agent",
    "agentRole",
    "engine",
    "strategy",
    "model",
    "command",
    "args",
    "cwd",
    "durationMs",
    "timeoutMs",
    "exitCode",
    "status",
    "stdoutTail",
    "stderrTail",
  ];
  return relevant.some((key) => {
    const value = metadata[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
  });
}

function normalizeSource(type: string): string {
  if (type.startsWith("approval")) return "APROVAÇÃO";
  if (type.startsWith("workflow.real")) return "EXECUÇÃO REAL";
  if (type.startsWith("workflow.multi_agent")) return "MULTIAGENTE";
  if (type.startsWith("workflow.simulated")) return "SIMULAÇÃO";
  if (type.startsWith("workflow")) return "WORKFLOW";
  if (type.startsWith("controlled_execution")) return "CONTROLADO";
  if (type.startsWith("step")) return "AGENTE";
  if (type.startsWith("agent")) return "AGENTE";
  if (type.startsWith("planner")) return "AGENTE";
  if (type.startsWith("developer")) return "AGENTE";
  if (type.startsWith("qa")) return "QA";
  if (type.startsWith("fix")) return "AGENTE";
  if (type.startsWith("opencode")) return "STREAM";
  if (type.startsWith("mission")) return "MISSÃO";
  if (type.startsWith("git")) return "GIT";
  if (type.startsWith("security")) return "SEGURANÇA";
  if (type.startsWith("conversation")) return "CONVERSA";
  if (type.startsWith("command")) return "COMANDO";
  return "SISTEMA";
}

/**
 * Extrai a categoria do campo metadata (JSON) quando disponível.
 * Se o metadata tiver { category: "OPENCODE" }, usa essa categoria.
 * Caso contrário, faz fallback para normalizeSource().
 */
function extractCategory(type: string, metadata?: string): string {
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed.category) return parsed.category;
    } catch {
      // ignore
    }
  }
  return normalizeSource(type);
}
