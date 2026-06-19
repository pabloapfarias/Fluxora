import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCcw, Save, Sparkles } from "lucide-react";
import {
  deriveProviderEngineGlobalDefault,
  type AgentConfig,
  type AiModelInfo,
  type AiProviderConfig,
  type FluxoraAgentRole,
  type MissionExecutionReadiness,
} from "@fluxora/shared";

type AgentDraft = {
  enabled: boolean;
  providerId: string;
  model: string;
};

const ROLE_LABELS: Record<FluxoraAgentRole, string> = {
  planner: "Planner",
  developer: "Developer",
  qa: "QA",
  finalizer: "Finalizer",
  custom: "Custom",
};

const ROLE_DESCRIPTIONS: Record<FluxoraAgentRole, string> = {
  planner: "Analisa a missão e produz o plano técnico.",
  developer: "Implementa a solução e pode gerar patch proposal.",
  qa: "Valida a entrega e procura regressões.",
  finalizer: "Consolida o resultado final entregue ao usuário.",
  custom: "Agente adicional persistido no Agent Engine.",
};

function createDraft(agent: AgentConfig): AgentDraft {
  return {
    enabled: agent.status === "enabled",
    providerId: agent.providerId || "",
    model: agent.model || "",
  };
}

function describeProvider(providerId: string, providers: AiProviderConfig[]) {
  const provider = providers.find((entry) => entry.id === providerId);
  return provider ? provider.name : providerId;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AgentDraft>>({});
  const [modelsByAgent, setModelsByAgent] = useState<Record<string, AiModelInfo[]>>({});
  const [loadingModelsByAgent, setLoadingModelsByAgent] = useState<Record<string, boolean>>({});
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { type: "success" | "error"; message: string }>>({});
  const [resettingDefaults, setResettingDefaults] = useState(false);
  const [readiness, setReadiness] = useState<MissionExecutionReadiness | null>(null);

  const runtimeFallback = useMemo(
    () => deriveProviderEngineGlobalDefault(providers),
    [providers]
  );

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    const [configs, providerList] = await Promise.all([
      window.fluxora.agents.listConfigs(),
      window.fluxora.providers.list(),
    ]);
    setAgents(configs);
    setProviders(providerList);
    setDrafts(Object.fromEntries(configs.map((agent) => [agent.id, createDraft(agent)])));
    await Promise.all(
      configs
        .filter((agent) => Boolean(agent.providerId))
        .map((agent) => loadModels(agent.id, agent.providerId || ""))
    );
    // PR 014 — A AgentsPage consulta a MESMA readiness que
    // `missions_run` usa, para garantir que o provider/modelo
    // efetivo mostrado aqui bate com o que será executado.
    try {
      const nextReadiness = await window.fluxora.missions.getReadiness();
      setReadiness(nextReadiness);
    } catch {
      setReadiness(null);
    }
  }

  async function loadModels(agentId: string, providerId: string) {
    if (!providerId) {
      setModelsByAgent((current) => ({ ...current, [agentId]: [] }));
      return;
    }
    setLoadingModelsByAgent((current) => ({ ...current, [agentId]: true }));
    try {
      const models = await window.fluxora.providers.listModels(providerId);
      setModelsByAgent((current) => ({ ...current, [agentId]: models }));
    } catch {
      setModelsByAgent((current) => ({ ...current, [agentId]: [] }));
    } finally {
      setLoadingModelsByAgent((current) => ({ ...current, [agentId]: false }));
    }
  }

  function updateDraft(agentId: string, patch: Partial<AgentDraft>) {
    setDrafts((current) => ({
      ...current,
      [agentId]: {
        ...current[agentId],
        ...patch,
      },
    }));
    setFeedback((current) => {
      if (!current[agentId]) return current;
      const next = { ...current };
      delete next[agentId];
      return next;
    });
  }

  async function handleProviderChange(agentId: string, providerId: string) {
    updateDraft(agentId, { providerId, model: "" });
    await loadModels(agentId, providerId);
  }

  async function handleSave(agent: AgentConfig) {
    const draft = drafts[agent.id];
    if (!draft) return;
    setSavingAgentId(agent.id);
    try {
      await window.fluxora.agents.updateConfig(agent.id, {
        status: draft.enabled ? "enabled" : "disabled",
      });
      await window.fluxora.models.updateAgentConfigModel(agent.id, {
        providerId: draft.providerId || null,
        model: draft.model || null,
      });
      setFeedback((current) => ({
        ...current,
        [agent.id]: { type: "success", message: "Agente real atualizado com sucesso." },
      }));
      await loadData();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [agent.id]: {
          type: "error",
          message: error instanceof Error ? error.message : "Falha ao salvar o agente.",
        },
      }));
    } finally {
      setSavingAgentId(null);
    }
  }

  async function handleResetDefaults() {
    setResettingDefaults(true);
    try {
      await window.fluxora.agents.resetDefaults();
      await loadData();
    } finally {
      setResettingDefaults(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Agentes</h1>
          <p className="text-[12.5px] text-text-muted mt-1">
            Esta tela mostra os agentes reais persistidos em <code className="px-1 rounded bg-bg-input">agents.json</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleResetDefaults()}
          disabled={resettingDefaults}
          className="no-drag flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-accent/30 text-[12px] font-medium"
        >
          <RefreshCcw size={14} className={resettingDefaults ? "animate-spin" : ""} />
          {resettingDefaults ? "Restaurando..." : "Restaurar agentes padrão"}
        </button>
      </div>

      <div className="rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-[12px] text-text-secondary flex items-start gap-2">
        <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
        <div>
          A execução real do Fluxora usa
          {" "}
          <strong className="text-text-primary">Planner, Developer, QA e Finalizer</strong>.
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-card px-4 py-3 text-[12px] text-text-secondary">
        {runtimeFallback.providerId && runtimeFallback.modelName ? (
          <span>
            Provider padrão de execução:
            {" "}
            <strong className="text-text-primary">{runtimeFallback.providerId}</strong>
            {" / "}
            <strong className="text-text-primary">{runtimeFallback.modelName}</strong>.
          </span>
        ) : (
          <span>Nenhum provider configurado. Cadastre um provider em Configurações &gt; Providers.</span>
        )}
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-[12px] text-warning">
          Nenhum agente real carregado do Agent Engine.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {agents.map((agent) => {
            const draft = drafts[agent.id] || createDraft(agent);
            const models = modelsByAgent[agent.id] || [];
            const loadingModels = loadingModelsByAgent[agent.id] || false;
            const providerName = draft.providerId ? describeProvider(draft.providerId, providers) : null;
            const inheritsMissionFallback = !draft.providerId || !draft.model;
            const readinessAgent = readiness?.agents.find((entry) => entry.agentId === agent.id);
            return (
              <div key={agent.id} className="bg-bg-card border border-border rounded-xl p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${draft.enabled ? "bg-success" : "bg-text-muted"}`} />
                      <h2 className="text-lg font-semibold text-text-primary">{agent.name}</h2>
                    </div>
                    <div className="text-[12px] text-text-muted mt-1">
                      {ROLE_LABELS[agent.role]} • ordem {agent.order}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-1 rounded ${
                      draft.enabled ? "bg-success/10 text-success" : "bg-text-muted/10 text-text-muted"
                    }`}
                  >
                    {draft.enabled ? "Habilitado" : "Desabilitado"}
                  </span>
                </div>

                <p className="text-[12.5px] text-text-secondary">
                  {agent.description || ROLE_DESCRIPTIONS[agent.role]}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-text-muted block mb-1">Provider real</label>
                    <select
                      value={draft.providerId}
                      onChange={(event) => void handleProviderChange(agent.id, event.target.value)}
                      className="flux-input"
                    >
                      <option value="">Herdar do provider padrão</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name} • {provider.kind}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-text-muted block mb-1">Modelo real</label>
                    <select
                      value={draft.model}
                      onChange={(event) => updateDraft(agent.id, { model: event.target.value })}
                      className="flux-input"
                      disabled={!draft.providerId || loadingModels}
                    >
                      <option value="">
                        {!draft.providerId
                          ? "Herdar do provider padrão"
                          : loadingModels
                            ? "Carregando modelos..."
                            : models.length === 0
                              ? "Nenhum modelo retornado"
                              : "Selecione um modelo"}
                      </option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => updateDraft(agent.id, { enabled: event.target.checked })}
                  />
                  Agente habilitado
                </label>

                <div className="rounded-lg border border-border bg-bg-deep/30 px-3 py-2 text-[12px] text-text-secondary">
                  <div>
                    Provider efetivo:
                    {" "}
                    <span className="text-text-primary font-medium">
                      {readinessAgent?.providerName || providerName || runtimeFallback.providerId || "não resolvido"}
                    </span>
                  </div>
                  <div className="mt-1">
                    Modelo efetivo:
                    {" "}
                    <span className="text-text-primary font-medium">
                      {readinessAgent?.model || draft.model || runtimeFallback.modelName || "não resolvido"}
                    </span>
                  </div>
                  {inheritsMissionFallback && (
                    <div className="mt-2 flex items-start gap-2 text-[11.5px]">
                      <Sparkles size={12} className="text-accent flex-shrink-0 mt-0.5" />
                      <span>Usa o provider padrão de execução quando nenhum provider específico é definido.</span>
                    </div>
                  )}
                </div>

                {feedback[agent.id] && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-[12px] ${
                      feedback[agent.id].type === "success"
                        ? "border-success/20 bg-success/10 text-success"
                        : "border-error/20 bg-error/10 text-error"
                    }`}
                  >
                    {feedback[agent.id].message}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSave(agent)}
                    disabled={savingAgentId === agent.id}
                    className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Save size={12} /> {savingAgentId === agent.id ? "Salvando..." : "Salvar agente"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
