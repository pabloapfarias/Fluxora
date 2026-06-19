import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  Trash2,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import {
  deriveProviderEngineGlobalDefault,
  type AgentConfig,
  type AiModelInfo,
  type AiProviderConfig,
  type ProviderCapabilities,
  type ProviderKind,
  type ProviderTestResult,
} from "@fluxora/shared";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";

type ProviderDraft = {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyValue: string;
  defaultModel: string;
  enabled: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
};

const DEFAULT_PROVIDER_DRAFT: ProviderDraft = {
  name: "",
  kind: "openai-compatible",
  baseUrl: "",
  apiKeyValue: "",
  defaultModel: "",
  enabled: true,
  supportsStreaming: true,
  supportsTools: false,
  supportsVision: false,
  supportsAudio: false,
};

const PROVIDER_KIND_OPTIONS: Array<{ value: ProviderKind; label: string }> = [
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "custom", label: "Custom" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "minimax", label: "MiniMax" },
  { value: "local", label: "Local" },
];

const AGENT_ORDER = ["planner", "developer", "qa", "finalizer"] as const;

function providerToDraft(provider: AiProviderConfig): ProviderDraft {
  return {
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl || "",
    apiKeyValue: provider.apiKeyEnv || "",
    defaultModel: provider.defaultModel || "",
    enabled: provider.enabled,
    supportsStreaming: provider.capabilities?.supportsStreaming !== false,
    supportsTools: provider.capabilities?.supportsTools === true,
    supportsVision: provider.capabilities?.supportsVision === true,
    supportsAudio: provider.capabilities?.supportsAudio === true,
  };
}

function draftToProviderInput(draft: ProviderDraft): Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt"> {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: draft.supportsStreaming,
    supportsTools: draft.supportsTools,
    supportsVision: draft.supportsVision,
    supportsAudio: draft.supportsAudio,
  };
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    baseUrl: draft.baseUrl.trim() || undefined,
    apiKeyEnv: draft.apiKeyValue.trim() || undefined,
    defaultModel: draft.defaultModel.trim() || undefined,
    enabled: draft.enabled,
    capabilities,
  };
}

function providerMeta(provider: AiProviderConfig): string[] {
  return [
    provider.enabled ? "Habilitado" : "Desabilitado",
    provider.kind,
    provider.baseUrl || "Base URL não definida",
  ];
}

function orderedAgents(agents: AgentConfig[]) {
  return [...agents].sort((a, b) => {
    const aIndex = AGENT_ORDER.indexOf(a.role as typeof AGENT_ORDER[number]);
    const bIndex = AGENT_ORDER.indexOf(b.role as typeof AGENT_ORDER[number]);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
}

export function SettingsPage() {
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, AiModelInfo[]>>({});
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerFeedback, setProviderFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResult | null>(null);
  const [loadingProviderModels, setLoadingProviderModels] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(DEFAULT_PROVIDER_DRAFT);
  const [savingProvider, setSavingProvider] = useState(false);
  const [removingProvider, setRemovingProvider] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) || null,
    [providers, selectedProviderId]
  );

  const runtimeFallback = useMemo(
    () => deriveProviderEngineGlobalDefault(providers),
    [providers]
  );

  async function loadAll(nextSelectedId?: string | null) {
    await Promise.all([loadProviders(nextSelectedId), loadAgents()]);
  }

  async function loadProviders(nextSelectedId?: string | null) {
    setLoadingProviders(true);
    try {
      const list = await window.fluxora.providers.list();
      setProviders(list);
      const targetId =
        nextSelectedId !== undefined
          ? nextSelectedId
          : selectedProviderId && list.some((provider) => provider.id === selectedProviderId)
            ? selectedProviderId
            : list[0]?.id || null;
      setSelectedProviderId(targetId);
    } finally {
      setLoadingProviders(false);
    }
  }

  async function loadAgents() {
    setLoadingAgents(true);
    try {
      const configs = await window.fluxora.agents.listConfigs();
      setAgents(configs);
    } finally {
      setLoadingAgents(false);
    }
  }

  function openCreateProvider() {
    setEditingProviderId(null);
    setProviderDraft(DEFAULT_PROVIDER_DRAFT);
    setProviderModalOpen(true);
    setProviderFeedback(null);
    setProviderTestResult(null);
  }

  function openEditProvider(provider: AiProviderConfig) {
    setEditingProviderId(provider.id);
    setProviderDraft(providerToDraft(provider));
    setProviderModalOpen(true);
    setProviderFeedback(null);
    setProviderTestResult(null);
  }

  function closeProviderModal() {
    setProviderModalOpen(false);
    setEditingProviderId(null);
    setProviderDraft(DEFAULT_PROVIDER_DRAFT);
  }

  async function handleSaveProvider() {
    if (!providerDraft.name.trim()) {
      setProviderFeedback({ type: "error", message: "Informe o nome do provider." });
      return;
    }

    setSavingProvider(true);
    try {
      const payload = draftToProviderInput(providerDraft);
      const saved = editingProviderId
        ? await window.fluxora.providers.update(editingProviderId, payload)
        : await window.fluxora.providers.create(payload);
      setProviderFeedback({
        type: "success",
        message: editingProviderId ? "Provider atualizado com sucesso." : "Provider criado com sucesso.",
      });
      await loadProviders(saved.id);
      closeProviderModal();
    } catch (error) {
      setProviderFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao salvar o provider.",
      });
    } finally {
      setSavingProvider(false);
    }
  }

  async function handleRemoveProvider() {
    if (!selectedProvider) return;
    const confirmed = window.confirm(`Remover o provider "${selectedProvider.name}"?`);
    if (!confirmed) return;

    setRemovingProvider(true);
    try {
      await window.fluxora.providers.remove(selectedProvider.id);
      setProviderFeedback({ type: "success", message: "Provider removido com sucesso." });
      setProviderTestResult(null);
      await loadProviders(null);
    } catch (error) {
      setProviderFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao remover o provider.",
      });
    } finally {
      setRemovingProvider(false);
    }
  }

  async function handleTestProvider() {
    if (!selectedProvider) return;
    setProviderFeedback(null);
    try {
      const result = await window.fluxora.providers.test(selectedProvider.id);
      setProviderTestResult(result);
      if (result.models?.length) {
        setProviderModels((current) => ({ ...current, [selectedProvider.id]: result.models || [] }));
      }
    } catch (error) {
      setProviderTestResult({
        ok: false,
        providerId: selectedProvider.id,
        status: "invalid",
        message: error instanceof Error ? error.message : "Falha ao testar o provider.",
      });
    }
  }

  async function handleListProviderModels() {
    if (!selectedProvider) return;
    setLoadingProviderModels(true);
    try {
      const models = await window.fluxora.providers.listModels(selectedProvider.id);
      setProviderModels((current) => ({ ...current, [selectedProvider.id]: models }));
    } catch {
      setProviderModels((current) => ({ ...current, [selectedProvider.id]: [] }));
    } finally {
      setLoadingProviderModels(false);
    }
  }

  const selectedProviderModels = selectedProvider ? providerModels[selectedProvider.id] || [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-[12.5px] text-text-muted mt-1">
          Configure providers, modelos, voz, permissões e execução do Fluxora.
        </p>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-4">Ambiente</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <InfoRow label="Modo" value="Desenvolvimento" />
          <InfoRow label="Armazenamento" value="SQLite local + JSON local" />
          <InfoRow label="Versão do app" value="Fluxora Tauri" />
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-medium">Providers</h3>
            <p className="text-[12px] text-text-muted mt-1">
              Fonte única de verdade para missões, agentes e streaming.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadProviders()}
              className="no-drag flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded-lg px-2.5 py-1.5"
            >
              <RefreshCcw size={12} /> Atualizar
            </button>
            <button
              onClick={openCreateProvider}
              className="no-drag flex items-center gap-1 text-xs border border-accent/30 text-accent hover:bg-accent/10 rounded-lg px-2.5 py-1.5"
            >
              <Plus size={12} /> Novo provider
            </button>
          </div>
        </div>

        {providerFeedback && (
          <FeedbackBox type={providerFeedback.type} message={providerFeedback.message} />
        )}

        {providers.length === 0 ? (
          <div className="rounded-lg border border-warning/25 bg-warning/10 px-4 py-3 text-[12px] text-warning">
            Nenhum provider configurado. Cadastre um provider para executar missões.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
            <div className="space-y-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setSelectedProviderId(provider.id)}
                  className={`no-drag w-full text-left rounded-lg border px-3 py-3 transition-colors ${
                    selectedProviderId === provider.id
                      ? "border-accent/40 bg-accent/10"
                      : "border-border bg-bg-deep/30 hover:border-accent/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{provider.name}</div>
                      <div className="text-[11px] text-text-muted truncate">{provider.defaultModel || "Sem modelo padrão"}</div>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded ${
                        provider.enabled ? "bg-success/10 text-success" : "bg-text-muted/10 text-text-muted"
                      }`}
                    >
                      {provider.enabled ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {selectedProvider ? (
                <>
                  <div className="rounded-lg border border-border bg-bg-deep/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-text-primary">{selectedProvider.name}</h4>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {providerMeta(selectedProvider).map((entry) => (
                            <span key={entry} className="text-[11px] px-2 py-1 rounded bg-bg-card border border-border">
                              {entry}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => openEditProvider(selectedProvider)}
                        className="no-drag text-xs border border-border hover:border-accent/30 rounded-lg px-3 py-1.5"
                      >
                        Editar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-[12px] text-text-secondary">
                      <InfoRow label="Modelo padrão" value={selectedProvider.defaultModel || "Não definido"} />
                      <InfoRow label="Streaming" value={selectedProvider.capabilities?.supportsStreaming === false ? "Não" : "Sim"} />
                      <InfoRow label="Tools" value={selectedProvider.capabilities?.supportsTools ? "Sim" : "Não"} />
                      <InfoRow label="Visão / áudio" value={`${selectedProvider.capabilities?.supportsVision ? "Visão" : "Sem visão"} • ${selectedProvider.capabilities?.supportsAudio ? "Áudio" : "Sem áudio"}`} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => void handleTestProvider()}
                      className="no-drag flex items-center gap-1 border border-border hover:border-accent/30 rounded-lg px-3 py-1.5 text-xs"
                    >
                      <Wrench size={12} /> Testar
                    </button>
                    <button
                      onClick={() => void handleListProviderModels()}
                      disabled={loadingProviderModels}
                      className="no-drag flex items-center gap-1 border border-border hover:border-accent/30 rounded-lg px-3 py-1.5 text-xs"
                    >
                      <RefreshCcw size={12} className={loadingProviderModels ? "animate-spin" : ""} /> Listar modelos
                    </button>
                    <button
                      onClick={() =>
                        void window.fluxora.providers.update(selectedProvider.id, { enabled: !selectedProvider.enabled })
                          .then(async () => {
                            await loadProviders(selectedProvider.id);
                            setProviderFeedback({
                              type: "success",
                              message: selectedProvider.enabled ? "Provider desabilitado." : "Provider habilitado.",
                            });
                          })
                          .catch((error) => {
                            setProviderFeedback({
                              type: "error",
                              message: error instanceof Error ? error.message : "Falha ao atualizar o provider.",
                            });
                          })
                      }
                      className="no-drag flex items-center gap-1 border border-border hover:border-accent/30 rounded-lg px-3 py-1.5 text-xs"
                    >
                      {selectedProvider.enabled ? "Desabilitar" : "Habilitar"}
                    </button>
                    <button
                      onClick={() => void handleRemoveProvider()}
                      disabled={removingProvider}
                      className="no-drag flex items-center gap-1 border border-error/30 text-error hover:bg-error/10 rounded-lg px-3 py-1.5 text-xs"
                    >
                      <Trash2 size={12} /> {removingProvider ? "Removendo..." : "Remover"}
                    </button>
                  </div>

                  {providerTestResult && (
                    <FeedbackBox
                      type={providerTestResult.ok ? "success" : "error"}
                      message={providerTestResult.message || "Teste concluído."}
                    />
                  )}

                  <div className="rounded-lg border border-border bg-bg-deep/30 p-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted font-semibold mb-2">
                      Modelos do provider
                    </div>
                    {selectedProviderModels.length === 0 ? (
                      <div className="text-[12px] text-text-muted">
                        {loadingProviderModels
                          ? "Carregando modelos..."
                          : "Nenhum modelo carregado ainda. Use “Testar” ou “Listar modelos”."}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {selectedProviderModels.map((model) => (
                          <span key={model.id} className="text-[11px] px-2 py-1 rounded bg-bg-card border border-border">
                            {model.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-border bg-bg-deep/30 p-4 text-[12px] text-text-muted">
                  Selecione um provider para ver detalhes, testar e listar modelos.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wrench size={16} className="text-accent" />
          <h3 className="font-medium">Modelo padrão de execução</h3>
        </div>
        {providers.length === 0 ? (
          <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Nenhum provider configurado. Cadastre um provider para executar missões.
          </div>
        ) : runtimeFallback.providerId && runtimeFallback.modelName ? (
          <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[12px] text-text-secondary">
            O Fluxora executará missões com <strong className="text-text-primary">{runtimeFallback.providerId}</strong>
            {" / "}
            <strong className="text-text-primary">{runtimeFallback.modelName}</strong> quando a missão ou o agente não sobrescreverem provider/modelo.
          </div>
        ) : (
          <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Provider configurado sem modelo padrão. Defina um modelo para executar missões.
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bot size={16} className="text-accent" />
          <h3 className="font-medium">Agentes</h3>
        </div>
        {loadingAgents ? (
          <div className="text-[12px] text-text-muted">Carregando agentes...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {orderedAgents(agents).map((agent) => (
              <div key={agent.id} className="rounded-lg border border-border bg-bg-deep/30 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-primary">{agent.name}</div>
                    <div className="text-[11px] text-text-muted mt-1">{agent.role}</div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      agent.status === "enabled" ? "bg-success/10 text-success" : "bg-text-muted/10 text-text-muted"
                    }`}
                  >
                    {agent.status === "enabled" ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <div className="mt-3 text-[12px] text-text-secondary">
                  {agent.providerId && agent.model
                    ? `${agent.providerId} / ${agent.model}`
                    : "Herdando provider/modelo da missão."}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AudioSettingsCard />

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={16} className="text-accent" />
          <h3 className="font-medium">Segurança e permissões</h3>
        </div>
        <div className="space-y-3 text-sm">
          <SecurityRow label="Política padrão" value="Conservadora com aprovações operacionais" />
          <SecurityRow label="Modo assistido" value="Disponível" />
          <SecurityRow label="Modo propositivo" value="Disponível" />
          <SecurityRow label="Piloto automático" value="Controlado por permissões do projeto" />
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Check size={16} className="text-accent" />
          <h3 className="font-medium">Diagnóstico do Fluxora</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px] text-text-secondary">
          <DiagnosticRow label="Provider Engine" value={providers.length > 0 ? `${providers.length} provider(s) carregado(s)` : "Nenhum provider configurado"} />
          <DiagnosticRow label="Agent Engine" value={agents.length > 0 ? `${agents.length} agente(s) persistido(s)` : "Nenhum agente carregado"} />
          <DiagnosticRow label="Mission Engine" value={runtimeFallback.providerId ? "Pronto para resolver provider/modelo" : "Aguardando provider com modelo padrão"} />
          <DiagnosticRow label="Event Bus" value="Ativo via Fluxora event bridge" />
          <DiagnosticRow label="Patch Engine" value="Disponível para propostas controladas" />
          <DiagnosticRow label="Voice Engine" value="Configurável nesta tela" />
        </div>
      </div>

      {providerModalOpen && (
        <ProviderModal
          draft={providerDraft}
          editing={Boolean(editingProviderId)}
          saving={savingProvider}
          onClose={closeProviderModal}
          onSave={() => void handleSaveProvider()}
          onChange={setProviderDraft}
        />
      )}
    </div>
  );
}

function ProviderModal({
  draft,
  editing,
  saving,
  onClose,
  onSave,
  onChange,
}: {
  draft: ProviderDraft;
  editing: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onChange: (draft: ProviderDraft) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-bg-card shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{editing ? "Editar provider" : "Novo provider"}</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Persistido no Provider Engine. A chave não é exibida em eventos nem logs.
            </p>
          </div>
          <button onClick={onClose} className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary">
            <X size={16} className="mx-auto" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nome">
            <input
              type="text"
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              className="flux-input"
              placeholder="Ex.: OpenAI, Groq, LM Studio"
            />
          </Field>

          <Field label="Tipo">
            <select
              value={draft.kind}
              onChange={(event) => onChange({ ...draft, kind: event.target.value as ProviderKind })}
              className="flux-input"
            >
              {PROVIDER_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Base URL">
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
              className="flux-input"
              placeholder="https://api.openai.com/v1"
            />
          </Field>

          <Field label="API key env ou token">
            <input
              type="password"
              value={draft.apiKeyValue}
              onChange={(event) => onChange({ ...draft, apiKeyValue: event.target.value })}
              className="flux-input"
              placeholder="OPENAI_API_KEY ou sk-..."
            />
          </Field>

          <Field label="Modelo padrão">
            <input
              type="text"
              value={draft.defaultModel}
              onChange={(event) => onChange({ ...draft, defaultModel: event.target.value })}
              className="flux-input"
              placeholder="gpt-4.1-mini"
            />
          </Field>

          <Field label="Estado">
            <button
              type="button"
              onClick={() => onChange({ ...draft, enabled: !draft.enabled })}
              className={`flux-input text-left ${draft.enabled ? "text-success" : "text-text-muted"}`}
            >
              {draft.enabled ? "Habilitado" : "Desabilitado"}
            </button>
          </Field>

          <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            <ToggleChip label="Streaming" checked={draft.supportsStreaming} onClick={() => onChange({ ...draft, supportsStreaming: !draft.supportsStreaming })} />
            <ToggleChip label="Tools" checked={draft.supportsTools} onClick={() => onChange({ ...draft, supportsTools: !draft.supportsTools })} />
            <ToggleChip label="Visão" checked={draft.supportsVision} onClick={() => onChange({ ...draft, supportsVision: !draft.supportsVision })} />
            <ToggleChip label="Áudio" checked={draft.supportsAudio} onClick={() => onChange({ ...draft, supportsAudio: !draft.supportsAudio })} />
          </div>

          <div className="md:col-span-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11.5px] text-text-secondary flex items-start gap-2">
            <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
            <div>
              Providers OpenAI-compatible e custom continuam suportados. O Fluxora usa apenas providers reais persistidos no backend.
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border-subtle flex items-center justify-end gap-2">
          <button onClick={onClose} className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            <Save size={12} /> {saving ? "Salvando..." : "Salvar provider"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted block mb-1">{label}</span>
      {children}
    </label>
  );
}

function ToggleChip({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm text-left ${
        checked ? "border-success/30 bg-success/10 text-success" : "border-border text-text-secondary"
      }`}
    >
      {label}
    </button>
  );
}

function FeedbackBox({ type, message }: { type: "success" | "error"; message: string }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-[12px] ${
        type === "success"
          ? "border-success/20 bg-success/10 text-success"
          : "border-error/20 bg-error/10 text-error"
      }`}
    >
      {message}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-text-muted">{label}</span>
      <div className="text-sm mt-1 text-text-primary">{value}</div>
    </div>
  );
}

function SecurityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-xs text-text-primary">{value}</span>
    </div>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-deep/30 px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="text-[12px] text-text-primary mt-1">{value}</div>
    </div>
  );
}
