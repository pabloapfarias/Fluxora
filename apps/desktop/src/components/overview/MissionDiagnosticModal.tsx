import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import type {
  EffectiveExecutionAgent,
  MissionExecutionReadiness,
} from "@fluxora/shared";
import { useModalAccessibility } from "../../hooks/useModalAccessibility";

interface MissionDiagnosticModalProps {
  intent: string;
  projectId?: string;
  onClose: () => void;
  onGoToAgents: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  planner: "Planner",
  developer: "Developer",
  qa: "QA",
  finalizer: "Finalizer",
  custom: "Personalizado",
};

function describeProviderName(agent: EffectiveExecutionAgent): string {
  if (!agent.providerId) return "sem provider";
  return agent.providerName || agent.providerId;
}

function describeOrigin(agent: EffectiveExecutionAgent): string {
  if (!agent.providerId && !agent.model) return "sem provider configurado";
  if (agent.inheritsProvider && agent.inheritsModel) {
    return "Usa o provider padrão de execução";
  }
  if (agent.inheritsProvider) return "Usa o provider padrão de execução";
  return "Usa provider específico do agente";
}

export function MissionDiagnosticModal({
  intent,
  projectId,
  onClose,
  onGoToAgents,
}: MissionDiagnosticModalProps) {
  const [readiness, setReadiness] = useState<MissionExecutionReadiness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await window.fluxora.missions.getReadiness({ projectId });
        if (!cancelled) setReadiness(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  const titleId = "mission-diagnostic-modal-title";
  const descId = "mission-diagnostic-modal-desc";

  const defaultAgent = useMemo<EffectiveExecutionAgent | null>(() => {
    if (!readiness) return null;
    return (
      readiness.agents.find((entry) => entry.role === "developer") ||
      readiness.agents[0] ||
      null
    );
  }, [readiness]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Fechar modal"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-3xl max-h-[88vh] overflow-auto rounded-2xl border border-border bg-bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border-subtle sticky top-0 bg-bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg border border-warning/30 bg-warning/10 flex items-center justify-center" aria-hidden="true">
              <ShieldAlert size={18} className="text-warning" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-text-primary">
                Diagnóstico da missão
              </h2>
              <div id={descId} className="text-[12px] text-text-muted mt-0.5">
                Intenção: <span className="text-text-secondary font-mono">{intent}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center"
            aria-label="Fechar modal de diagnóstico"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loading && (
            <div className="rounded-lg border border-border-subtle bg-bg-deep/30 px-3 py-2.5 text-[12.5px] text-text-muted">
              Verificando readiness do Agent Engine e Provider Engine…
            </div>
          )}

          {!loading && readiness && readiness.ready && (
            <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2.5 text-[12.5px] text-success">
              Todos os agentes reais estão prontos. Esta é a configuração que será usada na próxima execução.
            </div>
          )}

          {!loading && readiness && !readiness.ready && (
            <DiagnosticAlert
              icon={<AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />}
              title="Missão ainda não está pronta"
              description={
                readiness.issues[0] ||
                "Verifique provider e agentes antes de executar."
              }
            />
          )}

          {readiness && readiness.defaultProviderId && (
            <section className="rounded-lg border border-border-subtle bg-bg-deep/30 px-3 py-2.5 text-[12px] text-text-secondary space-y-1">
              <div>
                Provider padrão de execução:{" "}
                <span className="text-text-primary font-medium">
                  {readiness.defaultProviderName || readiness.defaultProviderId}
                </span>
              </div>
              <div>
                Modelo padrão:{" "}
                <span className="text-text-primary font-medium">
                  {readiness.defaultModel || "não resolvido"}
                </span>
              </div>
            </section>
          )}

          <section className="space-y-2.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">
              Agentes que serão executados
            </div>
            <ul className="space-y-2">
              {readiness?.agents.map((agent) => (
                <li
                  key={agent.agentId}
                  className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${
                    agent.ready
                      ? "border-success/20 bg-success/10"
                      : "border-warning/25 bg-warning/10"
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                      agent.ready
                        ? "bg-success/20 text-success"
                        : "bg-warning/20 text-warning"
                    }`}
                  >
                    <Wrench size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[13px] text-text-primary font-medium">
                      {agent.name}
                      <span className="text-text-muted text-[11.5px]">•</span>
                      <span className="text-text-muted text-[11.5px]">
                        {ROLE_LABELS[agent.role] || agent.role}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-text-secondary mt-0.5">
                      Provider efetivo:{" "}
                      <span className="text-text-primary font-medium">
                        {describeProviderName(agent)}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-text-secondary">
                      Modelo efetivo:{" "}
                      <span className="text-text-primary font-medium">
                        {agent.model || "não resolvido"}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-text-muted mt-0.5">
                      {describeOrigin(agent)}
                    </div>
                    {!agent.ready && agent.issues.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-[11.5px] text-warning space-y-0.5">
                        {agent.issues.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span
                    className={`text-[10.5px] font-semibold uppercase tracking-wide ${
                      agent.ready ? "text-success" : "text-warning"
                    }`}
                  >
                    {agent.ready ? "Pronto" : "Pendente"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {readiness && readiness.issues.length > 0 && (
            <section className="space-y-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">
                Pendências globais
              </div>
              <ul className="space-y-1.5">
                {readiness.issues.map((issue, index) => (
                  <li
                    key={`${index}-${issue}`}
                    className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning"
                  >
                    {issue}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {defaultAgent && (
            <DiagnosticAlert
              icon={<ArrowRight size={16} className="text-accent flex-shrink-0 mt-0.5" />}
              title="Recomendação de especialização"
              description={
                "A pilha do projeto pode sugerir foco (ex.: APIs, UI, mobile), mas a execução continua usando Developer / QA / Planner / Finalizer."
              }
            />
          )}
        </div>

        <div className="px-6 py-4 border-t border-border-subtle flex justify-end gap-2 sticky bottom-0 bg-bg-card">
          <button
            type="button"
            onClick={onClose}
            className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/25"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onGoToAgents}
            className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-white"
          >
            <Wrench size={12} /> Configurar agentes
          </button>
        </div>
      </div>
    </div>
  );
}

function DiagnosticAlert({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-[12.5px] flex items-start gap-2.5">
      {icon}
      <div>
        <div className="font-medium text-text-primary">{title}</div>
        <div className="text-text-secondary text-[12px] mt-0.5">{description}</div>
      </div>
    </div>
  );
}