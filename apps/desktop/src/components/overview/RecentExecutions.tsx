import { useNavigate } from "react-router-dom";
import { Eye, ShieldCheck, FileText, AlertTriangle, ExternalLink } from "lucide-react";
import type { WorkflowRun, Approval } from "@fluxora/shared";
import {
  formatExecutionTitle,
  classifyCommandIntent,
} from "../../lib/presentationLabels";
import {
  StatusBadge,
  ModeBadge,
  ActionButton,
  MissionCard,
  SectionHeader,
  type StatusBadgeStatus,
  type ModeBadgeMode,
} from "../ui";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapStatus(status: string): StatusBadgeStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "running":
    case "approved":
      return "running";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
    case "pending_approval":
      return "waiting_approval";
    default:
      return "pending";
  }
}

function mapMode(mode: string): ModeBadgeMode | null {
  switch (mode) {
    case "real":
      return "real";
    case "simulated":
      return "simulated";
    case "multi_agent":
      return "multiagent";
    case "controlled_execution":
      return "controlled";
    default:
      return null;
  }
}

function getSubtitle(run: WorkflowRun): string {
  const intent = classifyCommandIntent(run.title);
  if (intent === "conversation") {
    return `Conversa: "${run.title.trim().slice(0, 40)}"`;
  }
  return run.prompt?.slice(0, 80) || run.title;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface RecentExecutionsProps {
  runs: WorkflowRun[];
  pendingApprovals: Approval[];
  onSelectRun: (run: WorkflowRun) => void;
  /** Callback para abrir resultado em drawer */
  onViewResult?: (run: WorkflowRun) => void;
}

export function RecentExecutions({ runs, pendingApprovals, onSelectRun, onViewResult }: RecentExecutionsProps) {
  const navigate = useNavigate();

  if (runs.length === 0) return null;

  return (
    <MissionCard className="overflow-hidden" padding="sm">
      <div className="px-6 py-4 border-b border-border-subtle">
        <SectionHeader
          title="Execuções Recentes"
          action={
            <button
              onClick={() => navigate("/executions")}
              className="no-drag text-[12px] text-text-secondary hover:text-accent transition-colors font-medium"
            >
              Ver todas →
            </button>
          }
        />
      </div>
      <div className="divide-y divide-border-subtle">
        {runs.map((run) => (
          <div
            key={run.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectRun(run)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectRun(run);
              }
            }}
            className="no-drag w-full flex items-center gap-4 px-6 py-4 hover:bg-bg-elevated/40 transition-colors cursor-pointer group"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span className="text-[14px] font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                  {formatExecutionTitle(run.title, run.executionMode)}
                </span>
              </div>
              <div className="text-[12px] text-text-muted truncate mt-1">
                {getSubtitle(run)}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              {run.executionMode && (() => {
                const badgeMode = mapMode(run.executionMode);
                return badgeMode ? <ModeBadge mode={badgeMode} size="sm" /> : null;
              })()}

              <StatusBadge status={mapStatus(run.status)} size="sm" />

              <span className="text-[11px] text-text-muted tabular-nums w-[120px] text-right font-mono">
                {new Date(run.createdAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>

              {getPrimaryAction(run, pendingApprovals, navigate, onSelectRun, onViewResult)}
            </div>
          </div>
        ))}
      </div>
    </MissionCard>
  );
}

// ─── Primary action button ──────────────────────────────────────────────────

function getPrimaryAction(
  run: WorkflowRun,
  pendingApprovals: Approval[],
  navigate: ReturnType<typeof useNavigate>,
  onSelectRun: (run: WorkflowRun) => void,
  onViewResult?: (run: WorkflowRun) => void,
) {
  if (run.status === "pending_approval") {
    const approval = pendingApprovals.find((a) => a.workflowRunId === run.id);
    if (approval) {
      return (
        <div className="flex items-center gap-2">
          <ActionButton
            variant="secondary"
            size="sm"
            icon={<ShieldCheck size={12} />}
            onClick={(e) => {
              e.stopPropagation();
              navigate("/approvals");
            }}
          >
            Aprovar / Rejeitar
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={12} />}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/executions/${run.id}`);
            }}
          >
            Detalhes
          </ActionButton>
        </div>
      );
    }
  }

  if (run.status === "running" || run.status === "approved") {
    return (
      <div className="flex items-center gap-2">
        <ActionButton
          variant="secondary"
          size="sm"
          icon={<Eye size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRun(run);
          }}
        >
          Acompanhar
        </ActionButton>
        <ActionButton
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/executions/${run.id}`);
          }}
        >
          Detalhes
        </ActionButton>
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="flex items-center gap-2">
        <ActionButton
          variant="danger"
          size="sm"
          icon={<AlertTriangle size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            onViewResult?.(run);
          }}
        >
          Ver erro
        </ActionButton>
        <ActionButton
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/executions/${run.id}`);
          }}
        >
          Detalhes
        </ActionButton>
      </div>
    );
  }

  if (run.status === "completed") {
    return (
      <div className="flex items-center gap-2">
        <ActionButton
          variant="secondary"
          size="sm"
          icon={<FileText size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            onViewResult?.(run);
          }}
        >
          Ver resultado
        </ActionButton>
        <ActionButton
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/executions/${run.id}`);
          }}
        >
          Detalhes
        </ActionButton>
      </div>
    );
  }

  // Default: rejected, cancelled, etc.
  return (
    <ActionButton
      variant="ghost"
      size="sm"
      icon={<ExternalLink size={12} />}
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/executions/${run.id}`);
      }}
    >
      Detalhes
    </ActionButton>
  );
}
