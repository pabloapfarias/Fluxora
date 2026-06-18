import { useMemo, useRef } from "react";
import { AlertTriangle, ArrowRight, Clock, ShieldAlert, Sparkles, Wrench, X } from "lucide-react";
import {
  formatAgentRoleLabel,
  getAgentReadiness,
  getMissionAgentRequirements,
  isAgentConfiguredForRealExecution,
  recommendDeveloperRoleForStack,
  recommendPlannerRoleForStack,
  recommendQaRoleForStack,
  type Agent,
  type AgentRole,
  type OpenCodeCatalogResult,
  type ProjectRecommendationHistoryEntry,
} from "@fluxora/shared";
import { useModalAccessibility } from "../../hooks/useModalAccessibility";

interface MissionDiagnosticModalProps {
  intent: string;
  suggestedAgents: AgentRole[];
  agents: Agent[];
  catalog: OpenCodeCatalogResult | null;
  hasEnabledProvider: boolean;
  activeProjectStack?: string[];
  savedRecommendation?: ProjectRecommendationSummary | null;
  recommendationHistory?: ProjectRecommendationHistoryEntry[];
  onClose: () => void;
  onGoToAgents: () => void;
}

export interface ProjectRecommendationSummary {
  developerRole: AgentRole;
  developerAgentName?: string;
  developerReady: boolean;
  plannerRole?: AgentRole;
  plannerAgentName?: string;
  plannerReady: boolean;
  qaRole?: AgentRole;
  qaAgentName?: string;
  qaReady: boolean;
  appliedAt: string;
}

export function MissionDiagnosticModal({
  intent,
  suggestedAgents,
  agents,
  catalog,
  hasEnabledProvider,
  activeProjectStack,
  savedRecommendation,
  recommendationHistory,
  onClose,
  onGoToAgents,
}: MissionDiagnosticModalProps) {
  const requirements = useMemo(
    () => getMissionAgentRequirements(intent as any, suggestedAgents),
    [intent, suggestedAgents]
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  const titleId = "mission-diagnostic-modal-title";
  const descId = "mission-diagnostic-modal-desc";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="presentation"
    >
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Fechar modal" />
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
              <h2 id={titleId} className="text-lg font-semibold text-text-primary">Diagnóstico da missão</h2>
              <div id={descId} className="text-[12px] text-text-muted mt-0.5">Intenção: <span className="text-text-secondary font-mono">{intent}</span></div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center" aria-label="Fechar modal de diagnóstico">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {!hasEnabledProvider && (
            <DiagnosticAlert
              icon={<AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />}
              title="Nenhum provider ativo"
              description="Ative pelo menos um provider em Configurações > Agentes para que a missão possa usar modelos reais."
            />
          )}

          {requirements.length === 0 && hasEnabledProvider && (
            <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2.5 text-[12.5px] text-success">
              Todos os requisitos básicos estão atendidos. Opcionalmente, configure modelos específicos para melhorar a qualidade das respostas.
            </div>
          )}

          <section className="space-y-2.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">Agentes exigidos</div>
            <ul className="space-y-2">
              {requirements.map((req) => {
                const agent = agents.find((entry) => entry.role === req.role);
                const readiness = agent
                  ? getAgentReadiness(agent, catalog)
                  : { ready: false, reasons: ["Nenhum agente cadastrado para este papel."] };
                return (
                  <li
                    key={req.role}
                    className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${
                      readiness.ready ? "border-success/20 bg-success/10" : "border-warning/25 bg-warning/10"
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${readiness.ready ? "bg-success/20 text-success" : "bg-warning/20 text-warning"}`}>
                      <Wrench size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[13px] text-text-primary font-medium">
                        {agent ? agent.name : formatAgentRoleLabel(req.role)}
                        <span className="text-text-muted text-[11.5px]">•</span>
                        <span className="text-text-muted text-[11.5px]">{formatAgentRoleLabel(req.role)}</span>
                      </div>
                      <div className="text-[11.5px] text-text-secondary mt-0.5">{req.reason}</div>
                      {!readiness.ready && (
                        <ul className="mt-2 list-disc pl-5 text-[11.5px] text-warning space-y-0.5">
                          {readiness.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {(() => {
            const unassigned = requirements.filter((req) => !agents.find((entry) => entry.role === req.role));
            if (unassigned.length === 0) return null;
            return (
              <DiagnosticAlert
                icon={<ArrowRight size={16} className="text-accent flex-shrink-0 mt-0.5" />}
                title="Sugestão"
                description={`Crie agentes para os papéis faltantes: ${unassigned.map((entry) => formatAgentRoleLabel(entry.role)).join(", ")}.`}
              />
            );
          })()}

          {activeProjectStack && activeProjectStack.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">Recomendação por stack</div>
                {savedRecommendation && (
                  <span className="text-[10.5px] text-text-muted">
                    Aplicado em {new Date(savedRecommendation.appliedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <RecommendationCard
                  label="Developer"
                  role={savedRecommendation?.developerRole ?? recommendDeveloperRoleForStack(activeProjectStack)}
                  agentName={savedRecommendation?.developerAgentName ?? findAgentName(agents, savedRecommendation?.developerRole ?? recommendDeveloperRoleForStack(activeProjectStack))}
                  ready={savedRecommendation?.developerReady ?? isAgentReady(agents, catalog, savedRecommendation?.developerRole ?? recommendDeveloperRoleForStack(activeProjectStack))}
                />
                {(() => {
                  const plannerRole = savedRecommendation?.plannerRole ?? recommendPlannerRoleForStack(activeProjectStack);
                  if (!plannerRole) return null;
                  return (
                    <RecommendationCard
                      label="Planner"
                      role={plannerRole}
                      agentName={savedRecommendation?.plannerAgentName ?? findAgentName(agents, plannerRole)}
                      ready={savedRecommendation?.plannerReady ?? isAgentReady(agents, catalog, plannerRole)}
                    />
                  );
                })()}
                {(() => {
                  const qaRole = savedRecommendation?.qaRole ?? recommendQaRoleForStack(activeProjectStack);
                  if (!qaRole) return null;
                  return (
                    <RecommendationCard
                      label="QA"
                      role={qaRole}
                      agentName={savedRecommendation?.qaAgentName ?? findAgentName(agents, qaRole)}
                      ready={savedRecommendation?.qaReady ?? isAgentReady(agents, catalog, qaRole)}
                    />
                  );
                })()}
              </div>
            </section>
          )}

          {recommendationHistory && recommendationHistory.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">
                <Clock size={11} className="text-accent" />
                Histórico de recomendações deste projeto
              </div>
              <ol className="space-y-1.5">
                {recommendationHistory.slice(0, 5).map((entry, index) => {
                  const isLatest = index === 0;
                  const dev = formatAgentRoleLabel(entry.developerRole);
                  const planner = entry.plannerRole ? formatAgentRoleLabel(entry.plannerRole) : undefined;
                  const qa = entry.qaRole ? formatAgentRoleLabel(entry.qaRole) : undefined;
                  const summary = [dev, planner, qa].filter(Boolean).join(" · ");
                  return (
                    <li
                      key={entry.id}
                      className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-3 ${
                        isLatest
                          ? "border-accent/30 bg-accent/10"
                          : "border-border-subtle bg-bg-deep/30"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] text-text-primary truncate">{summary}</div>
                        <div className="text-[10.5px] text-text-muted">
                          {new Date(entry.appliedAt).toLocaleString()} · fonte: {entry.source}
                        </div>
                      </div>
                      {isLatest && (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 font-semibold uppercase tracking-wide">
                          atual
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
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

function DiagnosticAlert({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
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

function findAgentName(agents: Agent[], role: AgentRole | undefined): string | undefined {
  if (!role) return undefined;
  return agents.find((entry) => entry.role === role)?.name;
}

function isAgentReady(agents: Agent[], catalog: OpenCodeCatalogResult | null, role: AgentRole | undefined): boolean {
  if (!role) return false;
  const agent = agents.find((entry) => entry.role === role);
  if (!agent) return false;
  return isAgentConfiguredForRealExecution(agent, catalog);
}

function RecommendationCard({ label, role, agentName, ready }: { label: string; role: AgentRole; agentName?: string; ready: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-deep/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold">
        <Sparkles size={11} className="text-accent" />
        {label}
      </div>
      <div className="text-[12.5px] text-text-primary mt-1 font-medium">
        {formatAgentRoleLabel(role)}
      </div>
      <div className="text-[11.5px] text-text-muted mt-0.5">
        {agentName || "Sem agente cadastrado"}
      </div>
      <div className={`mt-1 text-[10.5px] font-semibold ${ready ? "text-success" : "text-warning"}`}>
        {ready ? "Pronto" : "Pendente"}
      </div>
    </div>
  );
}
