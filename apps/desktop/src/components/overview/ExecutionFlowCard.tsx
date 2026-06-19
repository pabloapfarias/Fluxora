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
}

type StepState = "awaiting" | "running" | "completed" | "error";

function mapStepState(step: WorkflowStep | undefined): StepState {
  if (!step) return "awaiting";
  if (step.status === "completed") return "completed";
  if (step.status === "running") return "running";
  if (step.status === "failed") return "error";
  return "awaiting";
}

function StepConnector({ state }: { state: StepState }) {
  const isCompleted = state === "completed";
  const isRunning = state === "running";

  return (
    <div className="flex items-center justify-center px-1 flex-shrink-0" aria-hidden="true">
      <div className="relative flex items-center w-8 h-[2px]">
        <div
          className={`absolute inset-0 rounded-full transition-colors ${
            isCompleted
              ? "bg-success/40"
              : isRunning
              ? "bg-accent/40"
              : "bg-border-subtle"
          }`}
        />
        {isRunning && (
          <div className="absolute inset-0 rounded-full bg-accent/60 animate-pulse" />
        )}
        <div
          className={`absolute right-0 w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] translate-x-[5px] ${
            isCompleted
              ? "border-l-success/60"
              : isRunning
              ? "border-l-accent/60"
              : "border-l-text-muted/40"
          }`}
        />
      </div>
    </div>
  );
}

function StepCard({
  step,
  state,
}: {
  step: { label: string; number: number; icon: typeof ClipboardList; output?: string; startedAt?: string; completedAt?: string };
  state: StepState;
}) {
  const Icon = step.icon;
  const isRunning = state === "running";
  const isCompleted = state === "completed";
  const isError = state === "error";
  const isAwaiting = state === "awaiting";

  const stateClasses = {
    running: {
      card: "border-accent/35 bg-gradient-to-b from-accent-soft/18 to-bg-elevated/70 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
      number: "bg-accent text-white",
      icon: "text-accent",
      label: "text-white",
      status: "text-text-secondary",
    },
    completed: {
      card: "border-success/30 bg-success-soft/20",
      number: "bg-success text-white",
      icon: "text-success",
      label: "text-text-primary",
      status: "text-success/80",
    },
    error: {
      card: "border-error/30 bg-error-soft/20",
      number: "bg-error text-white",
      icon: "text-error",
      label: "text-text-primary",
      status: "text-error/80",
    },
    awaiting: {
      card: "border-border-subtle bg-bg-elevated/30",
      number: "bg-bg-input text-text-muted border border-border-subtle",
      icon: "text-text-muted",
      label: "text-text-secondary",
      status: "text-text-muted",
    },
  };

  const classes = stateClasses[state];

  return (
    <div className="flex items-stretch flex-none w-[220px]">
      <div
        className={`flex-1 rounded-xl border p-4 transition-all duration-300 flex flex-col ${classes.card}`}
        role="listitem"
        aria-label={`Etapa ${step.number}: ${step.label} — ${
          isRunning ? "Executando" : isCompleted ? "Concluído" : isError ? "Erro" : "Aguardando"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold transition-all ${classes.number}`}
          >
            {step.number}
          </div>
          <div className={classes.icon}>
            {isCompleted && <CheckCircle2 size={18} />}
            {isRunning && <Loader2 size={18} className="animate-spin" />}
            {isError && <AlertTriangle size={18} />}
            {isAwaiting && <Circle size={18} />}
          </div>
        </div>

        <div className={`mb-2 ${classes.icon}`}>
          <Icon size={20} strokeWidth={1.8} />
        </div>

        <div className={`text-[14px] font-semibold leading-tight ${classes.label}`}>
          {step.label}
        </div>

        <div className={`flux-secondary-text mt-1.5 font-medium ${classes.status}`}>
          {isRunning && "Executando..."}
          {isCompleted && "Concluído"}
          {isError && "Falhou"}
          {isAwaiting && "Aguardando"}
        </div>

        {step.output && (
          <div className="text-[10.5px] text-text-muted mt-1.5 truncate" title={step.output}>
            {step.output}
          </div>
        )}

        {/* Duração */}
        {step.startedAt && (
          <div className={`text-[10px] mt-1.5 tabular-nums ${isRunning ? "text-text-secondary" : "text-text-muted"}`}>
            {new Date(step.startedAt).toLocaleTimeString()}
            {step.completedAt && ` → ${new Date(step.completedAt).toLocaleTimeString()}`}
          </div>
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
          <div className="flex items-stretch gap-0 overflow-x-auto pb-2" role="list" aria-label="Pipeline de execução">
            {displaySteps.map((step, i) => {
              const isAgentStep = isReal && step.type === "developer";
              const displayLabel = isAgentStep ? (executionAgent?.name || "Agente") : step.name;
              const displayOutput = isAgentStep
                ? [executionAgent?.model ? `Modelo: ${executionAgent.model}` : null, step.output].filter(Boolean).join(" • ")
                : step.output;
              return (
                <div key={step.id} className="flex items-stretch flex-none">
                  <StepCard
                    step={{
                      label: displayLabel,
                      number: i + 1,
                      icon: isAgentStep ? Code2 : getStepIcon(step),
                      output: displayOutput || undefined,
                      startedAt: step.startedAt,
                      completedAt: step.completedAt,
                    }}
                    state={mapStepState(step)}
                  />
                  {i < displaySteps.length - 1 && <StepConnector state={mapStepState(step)} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MissionCard>
  );
}
