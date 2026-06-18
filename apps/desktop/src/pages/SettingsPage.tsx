import { useEffect, useState } from "react";
import {
  Save,
  Zap,
  RefreshCcw,
  AlertTriangle,
  Wrench,
  Clipboard,
} from "lucide-react";
import {
  readGlobalDefaultAgentModel,
  writeGlobalDefaultAgentModel,
  type GlobalDefaultAgentModel,
  type OpenCodeCatalogResult,
  type OpenCodeModel,
  type OpenCodeProvider,
  type OpenCodeSettings,
  type OpenCodeDetection,
  type OpenCodeDiagnosticResult,
  type OpenCodeStatus,
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

// (Constantes de áudio movidas para AudioSettingsCard na PR 013)

export function SettingsPage() {
  // OpenCode state
  const [opencode, setOpencode] = useState<OpenCodeSettings | null>(null);
  const [opencodeDraft, setOpencodeDraft] = useState<OpenCodeSettings | null>(null);
  const [opencodeDetection, setOpencodeDetection] = useState<OpenCodeDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [savingOpencode, setSavingOpencode] = useState(false);

  // Audio provider state — gerenciado por AudioSettingsCard (PR 013)
  const [diagnostic, setDiagnostic] = useState<OpenCodeDiagnosticResult | null>(null);
  const [runningDiagnostic, setRunningDiagnostic] = useState<false | "detect" | "run" | "json" | "providers" | "controlled">(false);

  // OpenCode catalog
  const [catalog, setCatalog] = useState<OpenCodeCatalogResult | null>(null);
  const [globalDefaultModels, setGlobalDefaultModels] = useState<OpenCodeModel[]>([]);
  const [loadingGlobalDefaultModels, setLoadingGlobalDefaultModels] = useState(false);

  // Global default model (fallback for agents without their own configuration)
  const [globalDefault, setGlobalDefault] = useState<GlobalDefaultAgentModel>({ providerId: null, modelName: null });
  const [globalDefaultDraft, setGlobalDefaultDraft] = useState<GlobalDefaultAgentModel>({ providerId: null, modelName: null });
  const [savingGlobalDefault, setSavingGlobalDefault] = useState(false);

  useEffect(() => {
    loadOpenCode();
    loadGlobalDefault();
    void loadCatalog();
  }, []);

  // Probe do servidor whisper_local para mostrar status online/offline.
  // Usa múltiplos endpoints para cobrir whisper-server (/) e
  // OpenAI-compatible (/v1/models). Qualquer resposta HTTP (incluindo
  // 404) significa que o servidor está rodando — só falha se o fetch
  // em si falhar (connection refused, timeout).
  async function loadOpenCode() {
    const s = await window.fluxora.opencode.getSettings();
    setOpencode(s);
    setOpencodeDraft(s);
    const det = await window.fluxora.opencode.detect();
    setOpencodeDetection(det);
  }

  async function loadCatalog() {
    try {
      const result = await window.fluxora.opencode.getCatalog();
      setCatalog(result);
    } catch {
      setCatalog({ providers: [], models: [], modelsByProvider: {}, fetchedAt: new Date().toISOString(), error: "Falha ao consultar o OpenCode" });
    }
  }

  async function refreshCatalog() {
    setCatalog(null);
    try {
      const result = await window.fluxora.opencode.refreshCatalog();
      setCatalog(result);
    } catch {
      setCatalog({ providers: [], models: [], modelsByProvider: {}, fetchedAt: new Date().toISOString(), error: "Falha ao consultar o OpenCode" });
    }
  }

  async function loadAudio() {
    // (PR 013: lógica de áudio movida para AudioSettingsCard)
  }

  // (probeWhisperServerNow removido na PR 013 — não há mais bundled server)

  // (handleInstallAndStart removido na PR 013 — whisper_local agora é apenas
  // configuração de URL, sem download ou instalação via pip)

  // (Bundle de voz offline removido na PR 013 — whisper_local agora é apenas
  // configuração de URL do servidor, sem download bundled)

  async function loadAudioRetention() {
    // (PR 013: lógica de retenção movida para AudioSettingsCard)
  }

  function loadGlobalDefault() {
    const value = readGlobalDefaultAgentModel(window.localStorage);
    setGlobalDefault(value);
    setGlobalDefaultDraft(value);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      if (!globalDefaultDraft.providerId) {
        setGlobalDefaultModels([]);
        return;
      }
      setLoadingGlobalDefaultModels(true);
      try {
        const models = await window.fluxora.opencode.getModelsForProvider(globalDefaultDraft.providerId);
        if (!cancelled) setGlobalDefaultModels(models);
      } catch {
        if (!cancelled) setGlobalDefaultModels([]);
      } finally {
        if (!cancelled) setLoadingGlobalDefaultModels(false);
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [globalDefaultDraft.providerId]);

  async function handleSaveGlobalDefault() {
    setSavingGlobalDefault(true);
    try {
      const next: GlobalDefaultAgentModel = {
        providerId: globalDefaultDraft.providerId || null,
        modelName: globalDefaultDraft.modelName?.trim() || null,
        updatedAt: new Date().toISOString(),
      };
      writeGlobalDefaultAgentModel(window.localStorage, next);
      setGlobalDefault(next);
      setGlobalDefaultDraft(next);
    } finally {
      setSavingGlobalDefault(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    try {
      const det = await window.fluxora.opencode.detect();
      setOpencodeDetection(det);
    } finally {
      setDetecting(false);
    }
  }

  async function handleSaveOpenCode() {
    if (!opencodeDraft) return;
    setSavingOpencode(true);
    try {
      const next = await window.fluxora.opencode.updateSettings(opencodeDraft);
      setOpencode(next);
      setOpencodeDraft(next);
      const det = await window.fluxora.opencode.detect();
      setOpencodeDetection(det);
    } finally {
      setSavingOpencode(false);
    }
  }

  async function handleSaveAudio() {
    // (PR 013: lógica de salvar movida para AudioSettingsCard)
  }

  async function runDiagnostic(mode: "detect" | "run" | "json" | "providers" | "controlled") {
    if (!opencodeDraft) return;
    setRunningDiagnostic(mode);
    try {
      const result = await window.fluxora.opencode.diagnostics.run({
        binaryPath: opencodeDraft.binaryPath,
        projectPath: "/home/pablo/projects/Fluxora",
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
        <p className="text-[12.5px] text-text-muted mt-1">Ambiente, OpenCode, providers de modelo, áudio e segurança.</p>
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
            <span className={`w-2 h-2 rounded-full ${opencodeDetection.status === "detected" ? "bg-success flux-pulse-dot" : opencodeDetection.status === "error" ? "bg-error" : "bg-warning"}`} />
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
                onChange={(e) => setOpencodeDraft({ ...opencodeDraft, binaryPath: e.target.value })}
                placeholder="opencode"
                className="flux-input"
              />
              <p className="text-[10.5px] text-text-muted mt-1">
                Caminho do executável. Use <code className="px-1 py-0.5 rounded bg-bg-input border border-border">opencode</code> se estiver no PATH.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted block mb-1">Timeout padrão (ms)</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={opencodeDraft.defaultTimeoutMs}
                  onChange={(e) => setOpencodeDraft({ ...opencodeDraft, defaultTimeoutMs: parseInt(e.target.value, 10) || 60000 })}
                  className="flux-input"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted block mb-1">Habilitado</label>
                <button
                  onClick={() => setOpencodeDraft({ ...opencodeDraft, enabled: !opencodeDraft.enabled })}
                  className={`flux-input text-left ${opencodeDraft.enabled ? "text-success" : "text-text-muted"}`}
                >
                  {opencodeDraft.enabled ? "Sim — OpenCode ativo" : "Não — apenas simulação"}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-warning/30 bg-warning-soft/40 p-3 text-[11.5px] text-text-secondary flex items-start gap-2">
              <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <div>
                Comandos destrutivos (<code className="px-1 rounded bg-bg-input">rm -rf</code>, <code className="px-1 rounded bg-bg-input">git reset --hard</code>, <code className="px-1 rounded bg-bg-input">git push</code> etc.) são bloqueados por padrão. Comandos sempre rodam com <code className="px-1 rounded bg-bg-input">cwd</code> dentro do project root selecionado.
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium">Catálogo do OpenCode</h3>
            <p className="text-[12px] text-text-muted mt-1">
              Providers e modelos detectados diretamente no CLI. O Fluxora não mantém catálogo próprio.
            </p>
          </div>
          <button
            onClick={() => void refreshCatalog()}
            className="no-drag flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded-lg px-2.5 py-1.5"
          >
            <RefreshCcw size={12} /> Atualizar
          </button>
        </div>

        {catalog?.error ? (
          <div className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] text-error">
            {catalog.error}
          </div>
        ) : !catalog ? (
          <div className="text-[12px] text-text-muted">Carregando catálogo...</div>
        ) : catalog.providers.length === 0 ? (
          <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Nenhum provider disponível no OpenCode. Configure credenciais via <code className="px-1 rounded bg-bg-input">opencode providers</code>.
          </div>
        ) : (
          <div className="space-y-2">
            {catalog.providers.map((p) => {
              const count = catalog.modelsByProvider[p.id]?.length || 0;
              return (
                <div key={p.id} className="flex items-center justify-between p-3 bg-bg-hover rounded-lg">
                  <div>
                    <div className="text-sm font-medium">{p.displayName}</div>
                    <div className="text-xs text-text-muted">
                      {p.authType} • {count} modelo{count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">
                    Disponível
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wrench size={16} className="text-accent" />
          <h3 className="font-medium">Modelo padrão global</h3>
        </div>
        <p className="text-[12px] text-text-muted mb-4">
          Quando um agente não tem provider/modelo próprios, o sistema usa este modelo padrão.
          O provider e o modelo devem existir no OpenCode atual.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-text-muted block mb-1">Provider padrão</label>
            <select
              value={globalDefaultDraft.providerId || ""}
              onChange={(e) => setGlobalDefaultDraft((current) => ({ ...current, providerId: e.target.value || null, modelName: null }))}
              className="bg-bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent w-full"
              disabled={!catalog || catalog.providers.length === 0}
            >
              <option value="">Nenhum (sem fallback)</option>
              {catalog?.providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName} • {entry.authType}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-text-muted block mb-1">Modelo padrão</label>
            <select
              value={globalDefaultDraft.modelName || ""}
              onChange={(e) => setGlobalDefaultDraft((current) => ({ ...current, modelName: e.target.value || null }))}
              className="bg-bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent w-full"
              disabled={!globalDefaultDraft.providerId || loadingGlobalDefaultModels}
            >
              <option value="">
                {!globalDefaultDraft.providerId
                  ? "Selecione um provider primeiro"
                  : loadingGlobalDefaultModels
                    ? "Carregando modelos..."
                    : globalDefaultModels.length === 0
                      ? "Nenhum modelo disponível para este provider"
                      : "Selecione um modelo"}
              </option>
              {globalDefaultModels.map((m) => (
                <option key={m.id} value={m.id}>{m.modelName}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          <div className="text-[11.5px] text-text-muted">
            {globalDefault.providerId && globalDefault.modelName
              ? `Atual: ${catalog?.providers.find((p) => p.id === globalDefault.providerId)?.displayName || globalDefault.providerId} / ${globalDefault.modelName}`
              : "Nenhum modelo padrão configurado."}
          </div>
          <button
            onClick={handleSaveGlobalDefault}
            disabled={savingGlobalDefault}
            className="flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            <Save size={12} /> {savingGlobalDefault ? "Salvando..." : "Salvar padrão"}
          </button>
        </div>
      </div>

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

// (formatBytes movido para AudioSettingsCard na PR 013)
