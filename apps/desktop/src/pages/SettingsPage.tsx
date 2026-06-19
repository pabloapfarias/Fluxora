import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import {
  deriveProviderEngineGlobalDefault,
  type AiModelInfo,
  type AiProviderConfig,
  type OpenCodeDetection,
  type OpenCodeDiagnosticResult,
  type OpenCodeSettings,
  type OpenCodeStatus,
  type ProviderCapabilities,
  type ProviderKind,
  type ProviderTestResult,
} from "@fluxora/shared";
import { OpenCodeDiagnosticPanel } from "../components/settings/OpenCodeDiagnosticPanel";
import { ControlledExecutionPanel } from "../components/settings/ControlledExecutionPanel";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";

const opencodeStatusLabels: Record<OpenCodeStatus, string> = {
  not_configured: "Não configurado",
  not_detected: "Não detectado",
  detected: "Detectado",
  running: "Executando",
  error: "Erro",
};

const opencodeStatusTone: Record<OpenCodeStatus, string> = {
  not_configured: "text-text-muted",
  not_detected: "text-warning",
  detected: "text-success",
  running: "text-accent",
  error: "text-error",
};

type ProviderDraft = {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
  enabled: boolean;
  supportsStreaming: boolean;
};

const DEFAULT_PROVIDER_DRAFT: ProviderDraft = {
  name: "",
  kind: "openai-compatible",
  baseUrl: "",
  apiKeyEnv: "",
  defaultModel: "",
  enabled: true,
  supportsStreaming: true,
};

const PROVIDER_KIND_OPTIONS: Array<{ value: ProviderKind; label: string }> = [
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "minimax", label: "MiniMax" },
  { value: "local", label: "Local" },
  { value: "custom", label: "Custom" },
];

function providerToDraft(provider: AiProviderConfig): ProviderDraft {
  return {
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl || "",
    apiKeyEnv: provider.apiKeyEnv || "",
    defaultModel: provider.defaultModel || "",
    enabled: provider.enabled,
    supportsStreaming: provider.capabilities?.supportsStreaming !== false,
  };
}

function draftToProviderInput(draft: ProviderDraft): Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt"> {
  const capabilities: ProviderCapabilities = {};
  capabilities.supportsStreaming = draft.supportsStreaming;
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    baseUrl: draft.baseUrl.trim() || undefined,
    apiKeyEnv: draft.apiKeyEnv.trim() || undefined,
    defaultModel: draft.defaultModel.trim() || undefined,
    enabled: draft.enabled,
    capabilities,
  };
}

function providerSummary(provider: AiProviderConfig) {
  return `${provider.kind} • ${provider.defaultModel || "sem defaultModel"}`;
}

export function SettingsPage() {
  const [opencodeDraft, setOpencodeDraft] = useState<OpenCodeSettings | null>(null);
  const [opencodeDetection, setOpencodeDetection] = useState<OpenCodeDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [savingOpencode, setSavingOpencode] = useState(false);
  const [diagnostic, setDiagnostic] = useState<OpenCodeDiagnosticResult | null>(null);
  const [runningDiagnostic, setRunningDiagnostic] = useState<
    false | "detect" | "run" | "json" | "providers" | "controlled"
  >(false);

  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(DEFAULT_PROVIDER_DRAFT);
  const [savingProvider, setSavingProvider] = useState(false);
  const [removingProvider, setRemovingProvider] = useState(false);
  const [providerFeedback, setProviderFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResult | null>(null);
  const [providerModels, setProviderModels] = useState<AiModelInfo[]>([]);
  const [loadingProviderModels, setLoadingProviderModels] = useState(false);

  useEffect(() => {
    void loadOpenCode();
    void loadProviders();
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) || null,
    [providers, selectedProviderId]
  );
  const runtimeFallback = useMemo(
    () => deriveProviderEngineGlobalDefault(providers),
    [providers]
  );

  async function loadOpenCode() {
    const settings = await window.fluxora.opencode.getSettings();
    setOpencodeDraft(settings);
    const detection = await window.fluxora.opencode.detect();
    setOpencodeDetection(detection);
  }

  async function loadProviders(nextSelectedId?: string | null) {
    setLoadingProviders(true);
    try {
      const list = await window.fluxora.providers.list();
      setProviders(list);
      const chosenId =
        nextSelectedId !== undefined
          ? nextSelectedId
          : selectedProviderId && list.some((provider) => provider.id === selectedProviderId)
            ? selectedProviderId
            : list[0]?.id || null;
      setSelectedProviderId(chosenId);
      if (chosenId) {
        const provider = list.find((entry) => entry.id === chosenId);
        setProviderDraft(provider ? providerToDraft(provider) : DEFAULT_PROVIDER_DRAFT);
      } else {
        setProviderDraft(DEFAULT_PROVIDER_DRAFT);
      }
    } finally {
      setLoadingProviders(false);
    }
  }

  function selectProvider(provider: AiProviderConfig) {
    setSelectedProviderId(provider.id);
    setProviderDraft(providerToDraft(provider));
    setProviderFeedback(null);
    setProviderTestResult(null);
    setProviderModels([]);
  }

  function handleNewProvider() {
    setSelectedProviderId(null);
    setProviderDraft(DEFAULT_PROVIDER_DRAFT);
    setProviderFeedback(null);
    setProviderTestResult(null);
    setProviderModels([]);
  }

  async function handleSaveProvider() {
    if (!providerDraft.name.trim()) {
      setProviderFeedback({ type: "error", message: "Informe o nome do provider real." });
      return;
    }
    setSavingProvider(true);
    try {
      const payload = draftToProviderInput(providerDraft);
      const saved = selectedProvider
        ? await window.fluxora.providers.update(selectedProvider.id, payload)
        : await window.fluxora.providers.create(payload);
      setProviderFeedback({
        type: "success",
        message: selectedProvider ? "Provider atualizado com sucesso." : "Provider criado com sucesso.",
      });
      await loadProviders(saved.id);
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
    setRemovingProvider(true);
    try {
      await window.fluxora.providers.remove(selectedProvider.id);
      setProviderFeedback({ type: "success", message: "Provider removido com sucesso." });
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
        setProviderModels(result.models);
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
      setProviderModels(models);
    } catch {
      setProviderModels([]);
    } finally {
      setLoadingProviderModels(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    try {
      const detection = await window.fluxora.opencode.detect();
      setOpencodeDetection(detection);
    } finally {
      setDetecting(false);
    }
  }

  async function handleSaveOpenCode() {
    if (!opencodeDraft) return;
    setSavingOpencode(true);
    try {
      const next = await window.fluxora.opencode.updateSettings(opencodeDraft);
      setOpencodeDraft(next);
      const detection = await window.fluxora.opencode.detect();
      setOpencodeDetection(detection);
    } finally {
      setSavingOpencode(false);
    }
  }

  async function runDiagnostic(mode: "detect" | "run" | "json" | "providers" | "controlled") {
    if (!opencodeDraft) return;
    setRunningDiagnostic(mode);
    try {
      const result = await window.fluxora.opencode.diagnostics.run({
        binaryPath: opencodeDraft.binaryPath,
        projectPath: "/home/pablo/projects/FluxoraV1",
        runSmokeTest: mode === "run" || mode === "json",
        format: mode === "json" ? "json" : "default",
        controlledRunTest: mode === "controlled",
        timeoutMs: opencodeDraft.defaultTimeoutMs,
      });
      setDiagnostic(result);
    } finally {
      setRunningDiagnostic(false);
    }
  }

  async function handleCopyDiagnostic() {
    await window.fluxora.opencode.diagnostics.copyLastResult();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-[12.5px] text-text-muted mt-1">
          Provider Engine real, integrações legadas do OpenCode, áudio e segurança.
        </p>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-4">Ambiente</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-text-muted">Modo</span>
            <div className="text-sm mt-1">Desenvolvimento</div>
          </div>
          <div>
            <span className="text-xs text-text-muted">Banco de Dados</span>
            <div className="text-sm mt-1">SQLite Local</div>
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-medium">Providers reais do Provider Engine</h3>
            <p className="text-[12px] text-text-muted mt-1">
              Esta é a fonte de verdade usada por Mission Engine, Agent Engine e streaming.
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
              onClick={handleNewProvider}
              className="no-drag flex items-center gap-1 text-xs border border-accent/30 text-accent hover:bg-accent/10 rounded-lg px-2.5 py-1.5"
            >
              <Plus size={12} /> Novo provider
            </button>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Nenhum provider real configurado. O catálogo legado do OpenCode não é usado pelo Mission Engine.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
            <div className="space-y-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => selectProvider(provider)}
                  className={`no-drag w-full text-left rounded-lg border px-3 py-3 transition-colors ${
                    selectedProviderId === provider.id
                      ? "border-accent/40 bg-accent/10"
                      : "border-border bg-bg-deep/30 hover:border-accent/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{provider.name}</div>
                      <div className="text-[11px] text-text-muted truncate">{providerSummary(provider)}</div>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded ${
                        provider.enabled ? "bg-success/10 text-success" : "bg-text-muted/10 text-text-muted"
                      }`}
                    >
                      {provider.enabled ? "Ativo" : "Desativado"}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted block mb-1">Nome</label>
                  <input
                    type="text"
                    value={providerDraft.name}
                    onChange={(event) => setProviderDraft((current) => ({ ...current, name: event.target.value }))}
                    className="flux-input"
                    placeholder="Ex.: OpenAI"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">Tipo</label>
                  <select
                    value={providerDraft.kind}
                    onChange={(event) =>
                      setProviderDraft((current) => ({ ...current, kind: event.target.value as ProviderKind }))
                    }
                    className="flux-input"
                  >
                    {PROVIDER_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">Base URL</label>
                  <input
                    type="text"
                    value={providerDraft.baseUrl}
                    onChange={(event) => setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                    className="flux-input"
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">apiKeyEnv</label>
                  <input
                    type="text"
                    value={providerDraft.apiKeyEnv}
                    onChange={(event) => setProviderDraft((current) => ({ ...current, apiKeyEnv: event.target.value }))}
                    className="flux-input"
                    placeholder="OPENAI_API_KEY"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">defaultModel</label>
                  <input
                    type="text"
                    value={providerDraft.defaultModel}
                    onChange={(event) =>
                      setProviderDraft((current) => ({ ...current, defaultModel: event.target.value }))
                    }
                    className="flux-input"
                    placeholder="gpt-5.4"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={providerDraft.enabled}
                      onChange={(event) =>
                        setProviderDraft((current) => ({ ...current, enabled: event.target.checked }))
                      }
                    />
                    Enabled
                  </label>
                  <label className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={providerDraft.supportsStreaming}
                      onChange={(event) =>
                        setProviderDraft((current) => ({
                          ...current,
                          supportsStreaming: event.target.checked,
                        }))
                      }
                    />
                    Streaming
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11.5px] text-text-secondary flex items-start gap-2">
                <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
                <div>
                  O Mission Engine usa apenas providers reais salvos em <code className="px-1 rounded bg-bg-input">providers.json</code>.
                  A API key não é exibida nem enviada em eventos.
                </div>
              </div>

              {providerFeedback && (
                <div
                  className={`rounded-lg border px-3 py-2 text-[12px] ${
                    providerFeedback.type === "success"
                      ? "border-success/20 bg-success/10 text-success"
                      : "border-error/20 bg-error/10 text-error"
                  }`}
                >
                  {providerFeedback.message}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => void handleSaveProvider()}
                  disabled={savingProvider}
                  className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  <Save size={12} /> {savingProvider ? "Salvando..." : selectedProvider ? "Salvar provider" : "Criar provider"}
                </button>
                <button
                  onClick={() => void handleTestProvider()}
                  disabled={!selectedProvider}
                  className="no-drag flex items-center gap-1 border border-border hover:border-accent/30 rounded-lg px-3 py-1.5 text-xs"
                >
                  <Wrench size={12} /> Testar provider
                </button>
                <button
                  onClick={() => void handleListProviderModels()}
                  disabled={!selectedProvider || loadingProviderModels}
                  className="no-drag flex items-center gap-1 border border-border hover:border-accent/30 rounded-lg px-3 py-1.5 text-xs"
                >
                  <RefreshCcw size={12} className={loadingProviderModels ? "animate-spin" : ""} /> Listar modelos
                </button>
                <button
                  onClick={() => void handleRemoveProvider()}
                  disabled={!selectedProvider || removingProvider}
                  className="no-drag flex items-center gap-1 border border-error/30 text-error hover:bg-error/10 rounded-lg px-3 py-1.5 text-xs"
                >
                  <Trash2 size={12} /> {removingProvider ? "Removendo..." : "Remover"}
                </button>
              </div>

              {providerTestResult && (
                <div
                  className={`rounded-lg border px-3 py-2 text-[12px] ${
                    providerTestResult.ok
                      ? "border-success/20 bg-success/10 text-success"
                      : "border-warning/20 bg-warning/10 text-warning"
                  }`}
                >
                  {providerTestResult.message || "Teste concluído."}
                </div>
              )}

              <div className="rounded-lg border border-border bg-bg-deep/30 p-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted font-semibold mb-2">
                  Modelos retornados pelo provider real
                </div>
                {providerModels.length === 0 ? (
                  <div className="text-[12px] text-text-muted">
                    {loadingProviderModels
                      ? "Carregando modelos..."
                      : "Nenhum modelo carregado ainda. Use “Testar provider” ou “Listar modelos”."}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {providerModels.map((model) => (
                      <span key={model.id} className="text-[11px] px-2 py-1 rounded bg-bg-card border border-border">
                        {model.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wrench size={16} className="text-accent" />
          <h3 className="font-medium">Fallback real do Mission Engine</h3>
        </div>
        {runtimeFallback.providerId && runtimeFallback.modelName ? (
          <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[12px] text-text-secondary">
            Quando a missão não informa provider/modelo e o agente também não sobrescreve, o backend usará
            {" "}
            <span className="font-medium text-text-primary">{runtimeFallback.providerId}</span>
            {" / "}
            <span className="font-medium text-text-primary">{runtimeFallback.modelName}</span>
            {" "}
            porque é o primeiro provider real habilitado com <code className="px-1 rounded bg-bg-input">defaultModel</code>.
          </div>
        ) : (
          <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Nenhum fallback real disponível. Configure um provider habilitado com <code className="px-1 rounded bg-bg-input">defaultModel</code>.
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-warning" />
          <h3 className="font-medium">Catálogo legado do OpenCode</h3>
        </div>
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-text-secondary">
          Este catálogo não é usado pelo Mission Engine atual. Cadastre um provider real no Provider Engine.
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-accent" />
            <h3 className="font-medium">OpenCode CLI</h3>
          </div>
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="no-drag flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded-lg px-2.5 py-1.5"
          >
            <RefreshCcw size={12} className={detecting ? "animate-spin" : ""} /> Testar detecção
          </button>
        </div>

        {opencodeDetection && (
          <div className="mb-4 rounded-lg border border-border bg-bg-deep p-3 flex items-center gap-3">
            <span
              className={`w-2 h-2 rounded-full ${
                opencodeDetection.status === "detected"
                  ? "bg-success flux-pulse-dot"
                  : opencodeDetection.status === "error"
                    ? "bg-error"
                    : "bg-warning"
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className={`text-[13px] font-medium ${opencodeStatusTone[opencodeDetection.status]}`}>
                {opencodeStatusLabels[opencodeDetection.status]}
              </div>
              <div className="text-[11.5px] text-text-muted truncate">
                {opencodeDetection.message || opencodeDetection.version || `Binário: ${opencodeDetection.binaryPath}`}
              </div>
            </div>
            <span className="text-[10.5px] text-text-faint">
              {new Date(opencodeDetection.checkedAt).toLocaleTimeString()}
            </span>
          </div>
        )}

        {opencodeDraft && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">Caminho do binário</label>
              <input
                type="text"
                value={opencodeDraft.binaryPath}
                onChange={(event) => setOpencodeDraft({ ...opencodeDraft, binaryPath: event.target.value })}
                placeholder="opencode"
                className="flux-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted block mb-1">Timeout padrão (ms)</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={opencodeDraft.defaultTimeoutMs}
                  onChange={(event) =>
                    setOpencodeDraft({
                      ...opencodeDraft,
                      defaultTimeoutMs: parseInt(event.target.value, 10) || 60000,
                    })
                  }
                  className="flux-input"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted block mb-1">Habilitado</label>
                <button
                  onClick={() => setOpencodeDraft({ ...opencodeDraft, enabled: !opencodeDraft.enabled })}
                  className={`flux-input text-left ${opencodeDraft.enabled ? "text-success" : "text-text-muted"}`}
                >
                  {opencodeDraft.enabled ? "Sim — OpenCode ativo" : "Não — OpenCode desativado"}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-[11.5px] text-text-secondary flex items-start gap-2">
              <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <div>
                OpenCode permanece apenas como integração legada e diagnóstico. Ele não é a fonte de verdade de providers
                do Mission Engine.
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSaveOpenCode}
                disabled={savingOpencode}
                className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                <Save size={12} /> {savingOpencode ? "Salvando..." : "Salvar"}
              </button>
            </div>

            <OpenCodeDiagnosticPanel
              diagnostic={diagnostic}
              running={runningDiagnostic !== false}
              onDetect={() => void runDiagnostic("detect")}
              onRun={() => void runDiagnostic("run")}
              onRunJson={() => void runDiagnostic("json")}
              onProviders={() => void runDiagnostic("providers")}
              onControlledRun={() => void runDiagnostic("controlled")}
              onCopy={() => void handleCopyDiagnostic()}
            />

            <ControlledExecutionPanel />
          </div>
        )}
      </div>

      <AudioSettingsCard />

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-4">Segurança</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Context Isolation</span>
            <span className="text-xs text-success">Ativado</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Node Integration</span>
            <span className="text-xs text-success">Desativado</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Sandbox</span>
            <span className="text-xs text-success">Ativado</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Bloqueio de comandos destrutivos</span>
            <span className="text-xs text-success">Ativado</span>
          </div>
        </div>
      </div>
    </div>
  );
}
