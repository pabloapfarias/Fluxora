import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Circle,
  AlertTriangle,
  ClipboardList,
  Code2,
  ShieldCheck,
  Rocket,
  Zap,
  GitBranch,
  Search,
  FileCheck,
  Activity,
  Clock,
  FolderOpen,
  FlaskConical,
} from "lucide-react";
import type { BackgroundWorkflowJob, Project, WorkflowEvent, WorkflowRun, WorkflowStep, WorkflowStepType } from "@fluxora/shared";
import { MissionCard, SectionHeader } from "../ui";

interface ExecutionFlowCardProps {
  run: WorkflowRun | null;
  activeJob?: BackgroundWorkflowJob | null;
  activeProject?: Project | null;
  executionMode?: string;
  events?: WorkflowEvent[];
  onCancel?: () => void;
  onSelectStep?: (stepId: string) => void;
}

type StepState = "pending" | "running" | "completed" | "failed" | "skipped";

function mapStepState(step: WorkflowStep | undefined): StepState {
  if (!step) return "pending";
  if (step.status === "completed") return "completed";
  if (step.status === "running") return "running";
  if (step.status === "failed") return "failed";
  if (step.status === "cancelled") return "skipped";
  return "pending";
}

function getFriendlyRoleLabel(role?: string): string {
  if (!role) return "Agente";
  switch (role.toLowerCase()) {
    case "planner": return "Planner";
    case "developer": return "Developer";
    case "qa": return "QA";
    case "finalizer": return "Finalizer";
    case "fixer": return "Fixer";
    default: return role;
  }
}

function StepCard({
  step,
  state,
  onSelect,
}: {
  step: { id?: string; label: string; roleLabel: string; number: number; icon: typeof ClipboardList; output?: string; startedAt?: string; completedAt?: string };
  state: StepState;
  onSelect?: () => void;
}) {
  const Icon = step.icon;
  const isRunning = state === "running";
  const isCompleted = state === "completed";
  const isError = state === "failed";
  const isAwaiting = state === "pending";
  const isSkipped = state === "skipped";

  const stateClasses = {
    pending: {
      card: "border-border-subtle bg-bg-elevated/20 opacity-60",
      number: "bg-bg-input text-text-muted border border-border-subtle/50",
      icon: "text-text-muted",
      label: "text-text-secondary",
      statusText: "Pendente",
      statusClass: "text-text-muted",
    },
    running: {
      card: "border-accent/45 bg-gradient-to-b from-accent-soft/10 to-bg-elevated/70 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] ring-1 ring-accent/25",
      number: "bg-accent text-white font-bold",
      icon: "text-accent",
      label: "text-white font-semibold",
      statusText: "Executando",
      statusClass: "text-accent font-medium",
    },
    completed: {
      card: "border-success/35 bg-bg-elevated/40 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.5)]",
      number: "bg-success/15 text-success border border-success/35 font-bold",
      icon: "text-success",
      label: "text-text-primary font-semibold",
      statusText: "Concluído",
      statusClass: "text-success font-medium",
    },
    failed: {
      card: "border-error/35 bg-bg-elevated/40 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.5)]",
      number: "bg-error/15 text-error border border-error/35 font-bold",
      icon: "text-error",
      label: "text-text-primary font-semibold",
      statusText: "Falhou",
      statusClass: "text-error font-medium",
    },
    skipped: {
      card: "border-warning/25 bg-bg-elevated/25 opacity-75",
      number: "bg-warning/10 text-warning border border-warning/25",
      icon: "text-warning/80",
      label: "text-text-secondary",
      statusText: "Ignorado",
      statusClass: "text-warning/80 font-medium",
    },
  };

  const classes = stateClasses[state] || stateClasses.pending;

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-300 flex flex-col justify-between h-full min-h-[190px] w-full ${classes.card}`}
      role="listitem"
      aria-label={`Etapa ${step.number}: ${step.label} — ${classes.statusText}`}
    >
      <div>
        {/* Top row: step order and status icon */}
        <div className="flex items-center justify-between mb-3">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-bold transition-all ${classes.number}`}
          >
            {step.number}
          </div>
          <div className={classes.icon}>
            {isCompleted && <CheckCircle2 size={16} />}
            {isRunning && <Loader2 size={16} className="animate-spin" />}
            {isError && <AlertTriangle size={16} />}
            {isAwaiting && <Circle size={16} />}
            {isSkipped && <Clock size={16} />}
          </div>
        </div>

        {/* Step role and icon */}
        <div className="flex items-center gap-1.5 mb-1">
          <div className={`${classes.icon} opacity-80`}>
            <Icon size={14} strokeWidth={1.8} />
          </div>
          <span className="text-[9.5px] uppercase font-semibold tracking-wider text-text-muted">
            {step.roleLabel}
          </span>
        </div>

        {/* Step label / agent name */}
        <div className={`text-[13.5px] font-semibold leading-snug truncate ${classes.label}`} title={step.label}>
          {step.label}
        </div>

        {/* Status indicator */}
        <div className={`text-[11px] mt-0.5 ${classes.statusClass}`}>
          {classes.statusText}
        </div>

        {/* Summarized Output */}
        {step.output && (
          <div
            className="text-[11px] text-text-muted mt-2 leading-relaxed break-words"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={step.output}
          >
            {step.output}
          </div>
        )}
      </div>

      {/* Footer: duration/timestamps and action button */}
      <div className="mt-3 pt-3 border-t border-border-subtle/30 flex items-center justify-between gap-2 flex-wrap">
        {step.startedAt ? (
          <div className={`text-[10px] tabular-nums ${isRunning ? "text-text-secondary" : "text-text-muted"}`}>
            {new Date(step.startedAt).toLocaleTimeString()}
            {step.completedAt && ` → ${new Date(step.completedAt).toLocaleTimeString()}`}
          </div>
        ) : (
          <div className="text-[10px] text-text-muted">Aguardando início</div>
        )}

        {onSelect && step.id && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className="no-drag text-[11px] font-semibold text-accent hover:text-accent-hover transition-colors flex items-center gap-0.5"
          >
            Detalhes →
          </button>
        )}
      </div>
    </div>
  );
}

function parseEventMetadata(metadata?: string): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getExecutionAgentInfo(events: WorkflowEvent[]): { name: string; model?: string } | null {
  for (const event of [...events].reverse()) {
    const metadata = parseEventMetadata(event.metadata);
    if (!metadata) continue;
    const agent = typeof metadata.agent === "string" ? metadata.agent : undefined;
    const model = typeof metadata.model === "string" ? metadata.model : undefined;
    if (agent || model) return { name: agent || "Agente", model };
  }
  return null;
}

// Icones por tipo de step
const STEP_ICONS: Record<string, typeof ClipboardList> = {
  planner: ClipboardList,
  developer: Code2,
  qa: ShieldCheck,
  finalization: Rocket,
  finalizer: Rocket,
  fixer: ShieldCheck,
};

// Labels customizados por nome de step (para modo real)
const CUSTOM_LABELS: Record<string, string> = {
  "Preparação": "Preparação",
  "Provider": "Provider",
  "Git / Diff": "Git / Diff",
  "Resultado": "Resultado",
};

function getStepIcon(step: WorkflowStep): typeof ClipboardList {
  if (CUSTOM_LABELS[step.name]) {
    switch (step.name) {
      case "Preparação": return Search;
      case "Provider": return Zap;
      case "Git / Diff": return GitBranch;
      case "Resultado": return FileCheck;
    }
  }
  return STEP_ICONS[step.type] || ClipboardList;
}

export function ExecutionFlowCard({
  run,
  activeJob,
  activeProject,
  executionMode,
  events = [],
  onCancel,
  onSelectStep,
}: ExecutionFlowCardProps) {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  useEffect(() => {
    if (!run) {
      setSteps([]);
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const d = await window.fluxora.workflows.get(run.id);
        if (!mounted) return;
        setSteps(d.steps);
      } catch {
        // ignore
      }
    };
    load();
    if (run.status === "running" || run.status === "approved") {
      const id = setInterval(load, 1000);
      return () => {
        mounted = false;
        clearInterval(id);
      };
    }
    return () => {
      mounted = false;
    };
  }, [run?.id, run?.status]);

  const isMultiAgent = run?.realStrategy === "multi_agent";
  const isReal = run?.executionMode === "real";

  const [elapsed, setElapsed] = useState(0);
  const genericRealStepNames = new Set(["Planejamento", "Desenvolvimento", "Testes e Validação", "Finalização"]);

  useEffect(() => {
    if (!activeJob?.startedAt) {
      setElapsed(0);
      return;
    }

    const start = new Date(activeJob.startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeJob?.startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const modeLabel =
    (executionMode || run?.executionMode) === "real"
      ? "Real"
      : (executionMode || run?.executionMode) === "multi_agent"
      ? "Multiagente"
      : (executionMode || run?.executionMode) === "controlled_execution"
      ? "Controlada"
      : "Simulado";

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const executionAgent = getExecutionAgentInfo(events);
  const currentStep = (() => {
    if (!lastEvent) return "Preparando...";
    const t = lastEvent.type;
    if (t.includes("opencode")) return `${executionAgent?.name || "Agente"} executando`;
    if (t.includes("git")) return "Git / Diff";
    if (t.includes("approval")) return "Aprovação";
    if (t.includes("step") || t.includes("agent") || t.includes("planner") || t.includes("developer") || t.includes("qa")) return "Agente executando";
    if (t.includes("workflow.real")) return "Execução real";
    if (t.includes("workflow.multi_agent")) return "Multiagente";
    if (t.includes("controlled_execution")) return "Execução controlada";
    return "Executando...";
  })();

  const handleSelect = (stepId: string) => {
    if (onSelectStep) {
      onSelectStep(stepId);
    }
  };

  // Se não há run, mostrar estado vazio
  if (!run) {
    return (
      <MissionCard variant="default" padding="sm" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border-subtle">
          <SectionHeader title="Fluxo de Execução" />
        </div>
        <div className="p-5 text-center py-8">
          <div className="w-12 h-12 mx-auto rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center mb-3">
            <Rocket size={20} className="text-text-muted" />
          </div>
          <div className="text-[13px] text-text-secondary">Nenhuma execução ativa</div>
          <div className="text-[11.5px] text-text-muted mt-1">Envie uma missão para ver o fluxo</div>
        </div>
      </MissionCard>
    );
  }

  // Determinar steps a exibir baseado no modo
  // Os steps já vêm do banco (criados pelo runner)
  // Ordenar por rowid (ordem de criação)
  const realSpecificSteps = isReal ? steps.filter((step) => !genericRealStepNames.has(step.name)) : steps;
  const displaySteps = steps.length > 0 ? (isReal && realSpecificSteps.length > 0 ? realSpecificSteps : steps) : [];

  // Se é modo real single e não tem steps ainda, mostrar status simples
  if (isReal && !isMultiAgent && displaySteps.length === 0 && !activeJob) {
    const statusLabel =
      run.status === "running" ? "Executando..." :
      run.status === "completed" ? "Concluído" :
      run.status === "pending_approval" ? "Aguardando aprovação" :
      run.status === "failed" ? "Falhou" :
      run.status === "cancelled" ? "Cancelado" :
      run.status;

    return (
      <MissionCard variant="default" padding="sm" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
          <SectionHeader title="Fluxo de Execução" />
          <span className="text-[11.5px] text-text-muted truncate max-w-[320px] ml-4">{run.title}</span>
        </div>
        <div className="p-5 flex items-center gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            run.status === "running" ? "bg-accent-soft border border-accent/30" :
            run.status === "completed" ? "bg-success-soft border border-success/30" :
            "bg-bg-elevated border border-border-subtle"
          }`}>
            {run.status === "running" ? (
              <Loader2 size={18} className="text-accent animate-spin" />
            ) : run.status === "completed" ? (
              <CheckCircle2 size={18} className="text-success" />
            ) : (
              <Zap size={18} className="text-text-muted" />
            )}
          </div>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Execução real do Fluxora</div>
            <div className={`text-[12px] mt-0.5 font-medium ${
              run.status === "running" ? "text-accent" :
              run.status === "completed" ? "text-success" :
              "text-text-muted"
            }`}>
              {statusLabel}
            </div>
          </div>
        </div>
      </MissionCard>
    );
  }

  // Título baseado no modo
  const title = isMultiAgent
    ? "Fluxo de Execução (Multiagente)"
    : isReal
    ? "Fluxo de Execução (Real)"
    : "Fluxo de Execução (Simulado)";

  return (
    <MissionCard variant="default" padding="sm" className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <SectionHeader title={title} />
        {run && (
          <span className="text-[11.5px] text-text-muted truncate max-w-[320px] ml-4">{run.title}</span>
        )}
      </div>

      {activeJob && ["queued", "running"].includes(activeJob.status) && (
        <div className="px-5 py-4 border-b border-border-subtle bg-bg-deep/30">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Zap size={15} className="text-accent animate-pulse flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-text-primary">Executando missão</div>
                {activeProject?.name && (
                  <div className="text-[11.5px] text-text-muted mt-0.5 flex items-center gap-1.5 min-w-0">
                    <FolderOpen size={11} />
                    <span className="truncate">{activeProject.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 text-[11.5px] flex-wrap">
              <span className="text-text-muted flex items-center gap-1.5">
                <FlaskConical size={11} />
                {modeLabel}
              </span>
              <span className="text-text-muted flex items-center gap-1.5">
                <Activity size={11} />
                {currentStep}
              </span>
              {lastEvent && (
                <span className="text-text-muted flex items-center gap-1.5 max-w-[200px] truncate" title={lastEvent.message}>
                  <Clock size={11} />
                  {lastEvent.message?.slice(0, 40)}
                </span>
              )}
              <span className="text-accent font-mono font-semibold tabular-nums flex items-center gap-1.5">
                <Clock size={11} />
                Tempo {timeStr}
              </span>
            </div>

            {onCancel && (
              <button onClick={onCancel} className="no-drag flux-btn-danger h-9 px-3.5 text-[11.5px] flex-shrink-0">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-5">
        {displaySteps.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center mb-3">
              <Rocket size={20} className="text-text-muted" />
            </div>
            <div className="text-[13px] text-text-secondary">Aguardando início da execução</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" role="list" aria-label="Pipeline de execução">
            {displaySteps.map((step, i) => {
              const stepRole = step.type || (step as any).agentRole || "";
              const stepRoleLabel = getFriendlyRoleLabel(stepRole);
              const displayLabel = step.name || (step as any).agentName || "Agente";
              const displayOutput = step.output || (step as any).outputSummary || "";

              return (
                <div key={step.id} className="flex flex-col">
                  <StepCard
                    step={{
                      id: step.id,
                      label: displayLabel,
                      roleLabel: stepRoleLabel,
                      number: i + 1,
                      icon: STEP_ICONS[stepRole] || getStepIcon(step),
                      output: displayOutput || undefined,
                      startedAt: step.startedAt,
                      completedAt: step.completedAt,
                    }}
                    state={mapStepState(step)}
                    onSelect={() => handleSelect(step.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MissionCard>
  );
}
