import { useEffect, useState } from "react";
import { CheckCircle, Clock, Loader, Circle } from "lucide-react";
import type { WorkflowRun, WorkflowRunDetail, WorkflowStep } from "@fluxora/shared";

interface WorkflowTimelineProps {
  run: WorkflowRun;
}

export function WorkflowTimeline({ run }: WorkflowTimelineProps) {
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);

  useEffect(() => {
    loadDetail();
    if (run.status === "running") {
      const interval = setInterval(loadDetail, 1000);
      return () => clearInterval(interval);
    }
  }, [run.id, run.status]);

  async function loadDetail() {
    const d = await window.fluxora.workflows.get(run.id);
    setDetail(d);
  }

  if (!detail) return <div className="text-text-muted text-sm">Carregando...</div>;

  const genericRealStepNames = new Set(["Planejamento", "Desenvolvimento", "Testes e Validação", "Finalização"]);
  const realSpecificSteps = run.executionMode === "real"
    ? detail.steps.filter((step) => !genericRealStepNames.has(step.name))
    : detail.steps;
  const displaySteps = run.executionMode === "real" && realSpecificSteps.length > 0 ? realSpecificSteps : detail.steps;

  return (
    <div className="space-y-2">
      {displaySteps.map((step, i) => (
        <StepRow key={step.id} step={step} index={i} />
      ))}
    </div>
  );
}

function StepRow({ step, index }: { step: WorkflowStep; index: number }) {
  const tone =
    step.status === "completed"
      ? { icon: <CheckCircle size={16} className="text-success" />, label: "Concluído", borderClass: "border-success/30", bgClass: "bg-success-soft/40" }
      : step.status === "running"
      ? { icon: <Loader size={16} className="text-accent animate-spin" />, label: "Em andamento", borderClass: "border-accent/40", bgClass: "bg-accent-soft/40" }
      : step.status === "failed"
      ? { icon: <Circle size={16} className="text-error" />, label: "Erro", borderClass: "border-error/30", bgClass: "bg-error-soft/40" }
      : { icon: <Clock size={16} className="text-text-muted" />, label: "Aguardando", borderClass: "border-border", bgClass: "bg-bg-input/40" };

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${tone.borderClass} ${tone.bgClass}`}>
      <div className="flex-shrink-0 mt-0.5">{tone.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium text-text-primary">{step.name}</div>
          <span className="text-[10.5px] text-text-muted">{tone.label}</span>
        </div>
        {step.startedAt && (
          <div className="text-[10.5px] text-text-muted mt-0.5">
            {new Date(step.startedAt).toLocaleTimeString()}
            {step.completedAt && ` → ${new Date(step.completedAt).toLocaleTimeString()}`}
          </div>
        )}
        {step.output && (
          <div className="text-[11.5px] text-text-secondary mt-1.5 bg-bg-deep/60 border border-border rounded-md p-2">{step.output}</div>
        )}
      </div>
    </div>
  );
}
