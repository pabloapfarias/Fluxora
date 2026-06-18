import { useEffect, useState } from "react";
import {
  Mic,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Cloud,
  Server,
  VolumeX,
  Trash2,
  FolderOpen,
} from "lucide-react";
import type {
  AudioProviderSettings,
  AudioProviderType,
  AudioRetentionSettings,
  AudioStorageStats,
  WhisperDownloadProgress,
  WhisperModelInfo,
} from "@fluxora/shared";

// ============================================================
// Tipos
// ============================================================

type TestStatus = "idle" | "testing" | "success" | "error";

interface TestResult {
  status: TestStatus;
  message: string;
  details?: string;
}

interface ProviderMeta {
  value: AudioProviderType;
  label: string;
  shortLabel: string;
  description: string;
  statusNote: string;
  icon: React.ReactNode;
  statusTone: "good" | "warn" | "needs-config" | "advanced";
  badgeLabel: string;
}

// ============================================================
// Constantes
// ============================================================

const OPENAI_WHISPER_MODELS = [
  { value: "whisper-1", label: "whisper-1 (recomendado, mais barato)" },
  { value: "gpt-4o-transcribe", label: "gpt-4o-transcribe (mais novo, melhor qualidade)" },
  { value: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe (mais barato)" },
];

const PROVIDER_META: ProviderMeta[] = [
  {
    value: "whisper_local_managed",
    label: "Local offline — Whisper",
    shortLabel: "Local offline",
    description: "Modo recomendado. O Fluxora roda whisper.cpp no seu computador; nenhum áudio sai da máquina depois que o modelo foi baixado.",
    statusNote: "Baixe e selecione um modelo local. O usuário escolhe tamanho/qualidade, inclusive modelos grandes.",
    icon: <Server size={14} />,
    statusTone: "good",
    badgeLabel: "Recomendado",
  },
  {
    value: "whisper_http",
    label: "Nuvem (OpenAI, Groq)",
    shortLabel: "Nuvem",
    description: "Envia áudio para um serviço de voz na nuvem (OpenAI, Groq, etc.) e recebe a transcrição. Funciona em qualquer computador. Requer chave de API.",
    statusNote: "Opcional. Use quando não quiser baixar modelo local ou estiver em uma máquina sem recursos suficientes.",
    icon: <Cloud size={14} />,
    statusTone: "needs-config",
    badgeLabel: "Requer config",
  },
  {
    value: "whisper_local",
    label: "Servidor local externo",
    shortLabel: "Servidor externo",
    description: "Conecta a um servidor de voz rodando no seu computador (faster-whisper-server, whisper.cpp). Sem nuvem, sem mensalidade.",
    statusNote: "Avançado: você precisa instalar e rodar um servidor de voz manualmente. Sem download bundled.",
    icon: <Server size={14} />,
    statusTone: "advanced",
    badgeLabel: "Avançado",
  },
  {
    value: "manual",
    label: "Desativado (sem voz)",
    shortLabel: "Desativado",
    description: "Você digita a missão manualmente no painel de comando por voz. Use se preferir não falar ou se nenhuma das outras opções funcionar.",
    statusNote: "Não usa voz. Ideal como fallback ou se você prefere digitar.",
    icon: <VolumeX size={14} />,
    statusTone: "warn",
    badgeLabel: "Sem voz",
  },
];

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function statusToneClasses(tone: ProviderMeta["statusTone"]): string {
  switch (tone) {
    case "good":
      return "border-success/40 bg-success/5 hover:border-success";
    case "warn":
      return "border-warning/30 bg-warning/5 hover:border-warning/60";
    case "needs-config":
      return "border-accent/30 bg-accent/5 hover:border-accent/60";
    case "advanced":
      return "border-text-muted/30 bg-bg-deep hover:border-text-muted/60";
  }
}

function statusBadgeStyle(tone: ProviderMeta["statusTone"]): string {
  switch (tone) {
    case "good":
      return "text-success bg-success/10 border-success/30";
    case "warn":
      return "text-warning bg-warning/10 border-warning/30";
    case "needs-config":
      return "text-accent bg-accent/10 border-accent/30";
    case "advanced":
      return "text-text-muted bg-bg-input border-border";
  }
}

// ============================================================
// Componente principal
// ============================================================

export function AudioSettingsCard() {
  const [audio, setAudio] = useState<AudioProviderSettings | null>(null);
  const [audioDraft, setAudioDraft] = useState<AudioProviderSettings | null>(null);
  const [savingAudio, setSavingAudio] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ status: "idle", message: "" });
  const [audioRetention, setAudioRetention] = useState<AudioRetentionSettings | null>(null);
  const [audioStats, setAudioStats] = useState<AudioStorageStats | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, WhisperDownloadProgress>>({});

  // ============================================================
  // Carregar settings
  // ============================================================
  useEffect(() => {
    void loadAudio();
    void loadAudioRetention();
    void loadWhisperModels();
    const unsubscribe = window.fluxora.whisperLocal?.onDownloadProgress?.((progress) => {
      setDownloadProgress((prev) => ({ ...prev, [progress.modelId]: progress }));
      if (progress.status === "completed") void loadWhisperModels();
    });
    return () => unsubscribe?.();
  }, []);

  const loadAudio = async () => {
    try {
      const a = await window.fluxora.settings.getAudioProvider();
      setAudio(a);
      setAudioDraft(a);
    } catch (err) {
      console.warn("[Fluxora] Failed to load audio settings:", err);
    }
  };

  const loadAudioRetention = async () => {
    try {
      const [retention, stats] = await Promise.all([
        window.fluxora.voice.getAudioRetentionSettings(),
        window.fluxora.voice.getAudioStorageStats(),
      ]);
      setAudioRetention(retention);
      setAudioStats(stats);
    } catch (err) {
      console.warn("[Fluxora] Failed to load audio retention:", err);
    }
  };

  const loadWhisperModels = async () => {
    try {
      if (!window.fluxora.whisperLocal) return;
      const list = await window.fluxora.whisperLocal.listModels();
      setModels(list);
    } catch (err) {
      console.warn("[Fluxora] Failed to load whisper models:", err);
    }
  };

  // ============================================================
  // Save
  // ============================================================
  const handleSaveAudio = async () => {
    if (!audioDraft) return;
    setSavingAudio(true);
    try {
      const next = await window.fluxora.settings.setAudioProvider(audioDraft);
      setAudio(next);
      setAudioDraft(next);
      setTestResult({ status: "idle", message: "Configurações salvas." });
    } catch (err) {
      setTestResult({
        status: "error",
        message: "Erro ao salvar",
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSavingAudio(false);
    }
  };

  const handleSaveAudioRetention = async (input: Partial<AudioRetentionSettings>) => {
    try {
      const next = await window.fluxora.voice.updateAudioRetentionSettings(input);
      setAudioRetention(next);
      await loadAudioRetention();
    } catch (err) {
      console.warn("[Fluxora] Failed to save audio retention:", err);
    }
  };

  // ============================================================
  // Test provider
  // ============================================================
  const handleTestProvider = async () => {
    if (!audioDraft) return;
    setTestResult({ status: "testing", message: "Testando..." });

    try {
      if (audioDraft.type === "whisper_local_managed") {
        const status = await window.fluxora.whisperLocal.validateInstall();
        setTestResult({
          status: status.ok ? "success" : "error",
          message: status.ok ? "Whisper local pronto." : "Whisper local ainda não está pronto.",
          details: status.message,
        });
        return;
      }

      if (audioDraft.type === "manual") {
        setTestResult({
          status: "success",
          message: "Modo manual ativo. Sem voz para testar.",
          details: "Use o campo de digitação no painel de comando por voz.",
        });
        return;
      }

      if (audioDraft.type === "whisper_local") {
        const baseUrl = audioDraft.baseUrl || "http://localhost:8178";
        const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/models`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok || res.status === 401 || res.status === 403) {
          setTestResult({
            status: "success",
            message: `Servidor local respondendo em ${baseUrl}.`,
            details: "Você pode usar o comando por voz agora.",
          });
        } else {
          setTestResult({
            status: "error",
            message: `Servidor respondeu com status ${res.status}.`,
            details: `Verifique se a URL "${baseUrl}" está correta.`,
          });
        }
        return;
      }

      // whisper_http / openai_whisper
      const baseUrl = audioDraft.baseUrl || "https://api.openai.com/v1";
      const apiKeyEnvVal = audioDraft.apiKeyEnv || "OPENAI_API_KEY";
      let apiKey: string | null = null;
      if (window.fluxora.env) {
        apiKey = window.fluxora.env.get(apiKeyEnvVal);
      }
      if (!apiKey && apiKeyEnvVal && !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnvVal)) {
        apiKey = apiKeyEnvVal;
      }
      if (!apiKey) {
        setTestResult({
          status: "error",
          message: "Chave de API não encontrada.",
          details: `Configure a chave no campo abaixo ou defina a variável de ambiente "${apiKeyEnvVal}".`,
        });
        return;
      }
      const modelsRes = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!modelsRes.ok) {
        setTestResult({
          status: "error",
          message: `Chave rejeitada pelo servidor (${modelsRes.status}).`,
          details: `Verifique se "${audioDraft.apiKeyEnv || "OPENAI_API_KEY"}" contém uma chave válida.`,
        });
        return;
      }
      const modelsData = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const whisperModels = (modelsData.data || []).filter(
        (m) => m.id.toLowerCase().includes("whisper") || m.id.toLowerCase().includes("transcribe"),
      );
      const modelList =
        whisperModels.length > 0
          ? whisperModels.map((m) => m.id).join(", ")
          : "(nenhum modelo de voz encontrado)";
      setTestResult({
        status: "success",
        message: `Conexão OK! ${whisperModels.length} modelo(s) de voz disponível(eis).`,
        details: modelList,
      });
    } catch (err) {
      setTestResult({
        status: "error",
        message: "Erro ao testar",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // ============================================================
  // Render
  // ============================================================
  if (!audioDraft) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 text-text-muted text-[13px]">
          <Loader2 size={14} className="animate-spin" />
          Carregando configurações de áudio...
        </div>
      </div>
    );
  }

  const currentMeta = PROVIDER_META.find((p) => p.value === audioDraft.type);
  const isDirty = JSON.stringify(audio) !== JSON.stringify(audioDraft);

  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-accent" />
          <h3 className="font-medium">Captura de Áudio / Transcrição</h3>
        </div>
      </div>

      {/* Provider picker (radio cards) */}
      <div className="space-y-2">
        <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
          Provider de STT
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {PROVIDER_META.map((p) => {
            const isSelected = audioDraft.type === p.value;
            const badgeStyle = statusBadgeStyle(p.statusTone);
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setAudioDraft({ ...audioDraft, type: p.value })}
                className={`text-left rounded-lg border p-3 transition-all ${
                  isSelected
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : statusToneClasses(p.statusTone)
                }`}
                data-testid={`provider-card-${p.value}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={isSelected ? "text-accent" : "text-text-muted"}>{p.icon}</span>
                    <span className="text-[12.5px] font-medium text-text-primary">
                      {p.label}
                    </span>
                  </div>
                  <span
                    className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded border ${badgeStyle}`}
                  >
                    {p.badgeLabel}
                  </span>
                </div>
                <p className="text-[10.5px] text-text-muted mt-1 leading-relaxed">
                  {p.description}
                </p>
                <p className="text-[10px] text-text-muted/80 mt-1.5 leading-relaxed italic">
                  {p.statusNote}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-provider config */}
      {(audioDraft.type === "whisper_http" || audioDraft.type === "openai_whisper") && (
        <WhisperHttpConfig
          draft={audioDraft}
          onChange={(patch) => setAudioDraft({ ...audioDraft, ...patch })}
        />
      )}

      {audioDraft.type === "whisper_local" && (
        <WhisperLocalConfig
          draft={audioDraft}
          onChange={(patch) => setAudioDraft({ ...audioDraft, ...patch })}
        />
      )}

      {audioDraft.type === "whisper_local_managed" && (
        <WhisperManagedLocalConfig
          draft={audioDraft}
          models={models}
          progress={downloadProgress}
          onChange={(patch) => setAudioDraft({ ...audioDraft, ...patch })}
          onDownload={async (modelId) => {
            setTestResult({ status: "testing", message: "Baixando modelo Whisper..." });
            try {
              await window.fluxora.whisperLocal.downloadModel(modelId);
              await loadWhisperModels();
              setAudioDraft({ ...audioDraft, model: modelId });
              setTestResult({ status: "success", message: "Modelo baixado e selecionado.", details: "Clique em Salvar para fixar este modelo como padrão." });
            } catch (err) {
              setTestResult({ status: "error", message: "Erro ao baixar modelo", details: err instanceof Error ? err.message : String(err) });
            }
          }}
          onDelete={async (modelId) => {
            await window.fluxora.whisperLocal.deleteModel(modelId);
            await loadWhisperModels();
            if (audioDraft.model === modelId) setAudioDraft({ ...audioDraft, model: undefined });
          }}
        />
      )}

      {audioDraft.type === "manual" && (
        <div
          className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[11.5px] text-text-secondary flex items-start gap-2"
          data-testid="manual-info"
        >
          <VolumeX size={14} className="text-warning flex-shrink-0 mt-0.5" />
          <div>
            <strong>Modo manual.</strong> Você digita a missão no painel de comando por
            voz. Nenhuma captura de áudio acontece.
          </div>
        </div>
      )}

      {/* Idioma (opcional) */}
      <div>
        <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider block mb-1">
          Idioma padrão (opcional)
        </label>
        <input
          type="text"
          value={audioDraft.language || ""}
          onChange={(e) => setAudioDraft({ ...audioDraft, language: e.target.value })}
          placeholder="pt-BR (vazio = auto-detectar)"
          className="flux-input text-[12px] max-w-[200px]"
        />
        <p className="text-[10.5px] text-text-muted mt-1">
          Formato IETF (pt-BR, en-US, es-ES). Deixe vazio para auto-detectar.
        </p>
      </div>

      {/* Test result */}
      {testResult.status !== "idle" && (
        <TestResultBanner result={testResult} onDismiss={() => setTestResult({ status: "idle", message: "" })} />
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <button
          onClick={handleTestProvider}
          disabled={testResult.status === "testing"}
          className="no-drag flex items-center gap-1.5 border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors disabled:opacity-50"
          data-testid="test-audio-button"
        >
          {testResult.status === "testing" ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <CheckCircle2 size={11} />
          )}
          Testar agora
        </button>
        <button
          onClick={handleSaveAudio}
          disabled={savingAudio || !isDirty}
          data-testid="save-audio-button"
          className="no-drag flex items-center gap-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors"
        >
          <Save size={12} />
          {savingAudio ? "Salvando..." : isDirty ? "Salvar alterações" : "Salvo"}
        </button>
      </div>

      {/* Retention settings */}
      {audioRetention && (
        <div className="rounded-lg border border-border bg-bg-deep p-4 space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <div className="text-[12.5px] font-medium text-text-primary">Retenção de áudio</div>
            <div className="text-[10.5px] text-text-muted">
              {audioStats?.count || 0} arquivo(s) • {formatBytes(audioStats?.bytes || 0)}
            </div>
          </div>
          <p className="text-[10.5px] text-text-muted -mt-2">
            Os áudios gravados são salvos em <code className="px-1 rounded bg-bg-input">userData/audio/</code> para auditoria e replay.
          </p>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-[12px]">
              <input
                type="checkbox"
                checked={audioRetention.saveAudio}
                onChange={(e) => void handleSaveAudioRetention({ saveAudio: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-text-primary">Salvar áudio para auditoria</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10.5px] text-text-muted">Manter por</label>
            <select
              value={audioRetention.retentionDays}
              onChange={(e) =>
                void handleSaveAudioRetention({ retentionDays: Number(e.target.value) as AudioRetentionSettings["retentionDays"] })
              }
              className="flux-input text-[11px] py-1 px-2 max-w-[100px]"
            >
              {[7, 15, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {days} dias
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={async () => {
                await window.fluxora.voice.cleanupOldAudio();
                await loadAudioRetention();
              }}
              className="no-drag flux-btn-secondary h-7 text-[10.5px] flex items-center gap-1"
            >
              <Trash2 size={10} />
              Limpar antigos
            </button>
            <button
              onClick={() => window.fluxora.voice.openAudioFolder()}
              className="no-drag flux-btn-ghost h-7 text-[10.5px] flex items-center gap-1"
            >
              <FolderOpen size={10} />
              Abrir pasta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-componentes
// ============================================================

function WhisperManagedLocalConfig({
  draft,
  models,
  progress,
  onChange,
  onDownload,
  onDelete,
}: {
  draft: AudioProviderSettings;
  models: WhisperModelInfo[];
  progress: Record<string, WhisperDownloadProgress>;
  onChange: (patch: Partial<AudioProviderSettings>) => void;
  onDownload: (modelId: string) => Promise<void>;
  onDelete: (modelId: string) => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-3" data-testid="whisper-managed-setup">
      <div className="text-[12px] text-text-primary leading-relaxed">
        <strong>Modo recomendado:</strong> o Fluxora usa Whisper local no seu computador.
        Nenhum áudio é enviado para a nuvem. Baixe um modelo uma vez e use offline.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">Idioma</label>
          <select
            value={draft.language || "pt-BR"}
            onChange={(e) => onChange({ language: e.target.value })}
            className="flux-input text-[11px]"
          >
            <option value="pt-BR">Português (BR)</option>
            <option value="en-US">English</option>
            <option value="es-ES">Español</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">Threads</label>
          <input
            type="number"
            min={0}
            value={draft.threads ?? 0}
            onChange={(e) => onChange({ threads: Number(e.target.value) || undefined })}
            placeholder="0 = auto"
            className="flux-input text-[11px]"
          />
        </div>
      </div>

      <div className="space-y-2">
        {models.map((model) => {
          const p = progress[model.id];
          const isDownloading = p?.status === "downloading";
          const percent = p?.totalBytes ? Math.round((p.downloadedBytes / p.totalBytes) * 100) : 0;
          const selected = draft.model === model.id;
          return (
            <div key={model.id} className={`rounded-lg border p-2.5 bg-bg-card ${selected ? "border-accent" : "border-border"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-text-primary">
                    {model.label} <span className="text-[10px] text-text-muted">{formatBytes(model.sizeBytes)} · RAM {model.recommendedRamGb}GB</span>
                  </div>
                  <div className="text-[10.5px] text-text-muted">
                    Qualidade {model.quality} · velocidade {model.speed} · {model.language === "multi" ? "multilíngue" : "inglês"}
                  </div>
                  {isDownloading && <div className="text-[10px] text-accent mt-1">Baixando {percent}%</div>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {model.installed ? (
                    <>
                      <button type="button" onClick={() => onChange({ model: model.id })} className="flux-btn-ghost h-7 px-2 text-[10.5px]">
                        {selected ? "Selecionado" : "Selecionar"}
                      </button>
                      <button type="button" onClick={() => void onDelete(model.id)} className="flux-btn-ghost h-7 px-2 text-[10.5px] text-error">
                        Remover
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={isDownloading} onClick={() => void onDownload(model.id)} className="flux-btn-ghost h-7 px-2 text-[10.5px]">
                      {isDownloading ? "Baixando..." : "Baixar"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WhisperHttpConfig({
  draft,
  onChange,
}: {
  draft: AudioProviderSettings;
  onChange: (patch: Partial<AudioProviderSettings>) => void;
}) {
  return (
    <div
      className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2.5"
      data-testid="whisper-http-setup"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[12px] text-text-primary leading-relaxed flex-1">
          <strong>Como funciona:</strong> sua voz é enviada para o serviço de voz na
          nuvem e a transcrição volta em segundos. Funciona em qualquer computador.
        </div>
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="openai-get-key-link"
          className="no-drag inline-flex items-center gap-1 text-[10.5px] text-accent hover:underline font-medium flex-shrink-0"
        >
          <ExternalLink size={10} />
          Pegar chave
        </a>
      </div>
      <div className="text-[10.5px] text-text-muted">
        A OpenAI dá <strong>US$ 5 de crédito grátis</strong> para novas contas.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">URL do servidor</label>
          <input
            type="text"
            value={draft.baseUrl || ""}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="flux-input text-[11px]"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">Modelo</label>
          <input
            type="text"
            list="openai-whisper-models-list"
            value={draft.model || ""}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="whisper-1"
            className="flux-input text-[11px]"
          />
          <datalist id="openai-whisper-models-list">
            {OPENAI_WHISPER_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">Chave da API</label>
          <input
            type="password"
            value={draft.apiKeyEnv || ""}
            onChange={(e) => onChange({ apiKeyEnv: e.target.value })}
            placeholder="sk-... ou OPENAI_API_KEY"
            className="flux-input text-[11px]"
          />
        </div>
      </div>
    </div>
  );
}

function WhisperLocalConfig({
  draft,
  onChange,
}: {
  draft: AudioProviderSettings;
  onChange: (patch: Partial<AudioProviderSettings>) => void;
}) {
  return (
    <div
      className="rounded-lg border border-text-muted/30 bg-bg-deep p-3 space-y-2.5"
      data-testid="whisper-local-setup"
    >
      <div className="text-[12px] text-text-primary leading-relaxed">
        <strong>Como funciona:</strong> a voz é processada por um servidor local
        rodando no seu computador (faster-whisper-server, whisper.cpp). Sem áudio
        enviado para nuvem.
      </div>
      <div className="text-[10.5px] text-text-muted">
        Avançado: você precisa instalar e rodar um servidor de voz manualmente. Sem
        download bundled.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">URL do servidor</label>
          <input
            type="text"
            value={draft.baseUrl || ""}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="http://localhost:8178/v1"
            className="flux-input text-[11px]"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted block mb-0.5">Modelo (opcional)</label>
          <input
            type="text"
            value={draft.model || ""}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="whisper-1"
            className="flux-input text-[11px]"
          />
        </div>
      </div>
    </div>
  );
}

function TestResultBanner({ result, onDismiss }: { result: TestResult; onDismiss: () => void }) {
  const isError = result.status === "error";
  const isSuccess = result.status === "success";
  const isTesting = result.status === "testing";

  return (
    <div
      className={`rounded-lg border p-3 text-[11.5px] flex items-start gap-2 ${
        isError
          ? "border-error/30 bg-error/5 text-error"
          : isSuccess
          ? "border-success/30 bg-success/5 text-success"
          : "border-accent/30 bg-accent/5 text-accent"
      }`}
      data-testid="audio-test-result"
    >
      {isTesting ? (
        <Loader2 size={13} className="animate-spin flex-shrink-0 mt-0.5" />
      ) : isError ? (
        <XCircle size={13} className="flex-shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="font-medium">{result.message}</div>
        {result.details && <div className="text-[10.5px] opacity-90">{result.details}</div>}
      </div>
      <button
        onClick={onDismiss}
        className="opacity-60 hover:opacity-100 flex-shrink-0"
        aria-label="Fechar"
      >
        ✕
      </button>
    </div>
  );
}
