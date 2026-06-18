import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiModelInfo,
  AiProviderConfig,
  AudioProviderSettings,
  AudioRetentionSettings,
  AudioTranscriptionInput,
  AudioTranscriptionResult,
  ChatOnceRequest,
  ChatOnceResult,
  CreateProjectInput,
  FluxoraAPI,
  FluxoraEvent,
  FluxoraEventLevel,
  FluxoraEventSource,
  GitInspectionResult,
  OpenCodeCatalogResult,
  OpenCodeModel,
  OpenCodeProvider,
  Project,
  ProviderTestResult,
  SelectDirectoryResult,
  UpdateProjectInput,
  ValidatePathResult,
} from "@fluxora/shared";
import { createMockAPI } from "../api/mock-api";

type AppInfoPayload = {
  name: string;
  version: string;
  tauri: boolean;
  platform: string;
};

type AppGitInfoPayload = {
  branch: string;
  commit: string;
  error?: string;
};

type EmitDiagnosticInput = {
  message: string;
  level?: FluxoraEventLevel;
  source?: FluxoraEventSource;
  projectId?: string;
  missionId?: string;
  agentId?: string;
  payload?: unknown;
};

type ListRecentInput = {
  limit?: number;
  type?: string;
};

/** Canal único do barramento de eventos do FluxoraV1 no Tauri. */
const FLUXORA_EVENT_CHANNEL = "fluxora-event";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Codifica bytes em base64. O Tauri 2 serializa argumentos
 * via JSON, então `Uint8Array` viraria `number[]` (gigante
 * para áudios típicos). Enviamos base64 em vez disso.
 *
 * Implementação streaming para não estourar a stack em
 * áudios longos.
 */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function" && bytes.length < 0xffff) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  // Fallback: chunked encoding sem btoa.
  // Não é usado no Vite (btoa sempre existe), mas mantém
  // compatibilidade caso rode em ambiente sem `btoa`.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  // Node fallback (vite dev server, vitest)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BufferCtor: any = (globalThis as any).Buffer;
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64");
  }
  throw new Error("Nenhum encoder base64 disponível no ambiente.");
}

async function invokeOrFallback<T>(
  command: string,
  args: Record<string, unknown>,
  fallback: () => Promise<T>,
  options?: { fallbackOnError?: boolean }
): Promise<T> {
  if (!isTauriRuntime()) {
    return fallback();
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (!options?.fallbackOnError) {
      throw error;
    }
    console.warn(`[desktopBridge] Falling back to mock for ${command}`, error);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Projects (PR 002)
// ---------------------------------------------------------------------------

export async function listProjects(api: FluxoraAPI): Promise<Project[]> {
  return invokeOrFallback<Project[]>(
    "projects_list",
    {},
    async () => api.projects.list()
  );
}

export async function openProject(api: FluxoraAPI): Promise<SelectDirectoryResult> {
  return invokeOrFallback<SelectDirectoryResult>(
    "projects_select_directory",
    {},
    async () => api.projects.selectDirectory()
  );
}

export async function createProject(api: FluxoraAPI, input: CreateProjectInput): Promise<Project> {
  return invokeOrFallback<Project>(
    "projects_create",
    { payload: input },
    async () => api.projects.create(input)
  );
}

export async function updateProject(api: FluxoraAPI, id: string, input: UpdateProjectInput): Promise<Project> {
  return invokeOrFallback<Project>(
    "projects_update",
    { id, payload: input },
    async () => api.projects.update(id, input)
  );
}

export async function removeProject(api: FluxoraAPI, id: string): Promise<void> {
  return invokeOrFallback<void>(
    "projects_remove",
    { id },
    async () => api.projects.remove(id)
  );
}

export async function validateProjectPath(api: FluxoraAPI, projectPath: string): Promise<ValidatePathResult> {
  return invokeOrFallback<ValidatePathResult>(
    "projects_validate_path",
    { projectPath },
    async () => api.projects.validatePath(projectPath)
  );
}

// ---------------------------------------------------------------------------
// App (PR 001 + PR 003)
// ---------------------------------------------------------------------------

export async function getAppVersion(api: FluxoraAPI): Promise<string> {
  const info = await invokeOrFallback<AppInfoPayload>("get_app_info", {}, async () => ({
    name: "Fluxora",
    version: await api.app.getVersion(),
    tauri: false,
    platform: "browser",
  }), { fallbackOnError: true });

  return info.version;
}

/**
 * Branch e commit do diretório onde o app está rodando.
 * No runtime Tauri, lê via `git rev-parse` no cwd.
 * Fora do runtime Tauri, faz fallback para o mock.
 *
 * Não mascara erro real quando em runtime Tauri.
 */
export async function getAppGitInfo(): Promise<AppGitInfoPayload> {
  if (!isTauriRuntime()) {
    return { branch: "", commit: "", error: "not_in_tauri_runtime" };
  }
  return invoke<AppGitInfoPayload>("app_get_git_info", {});
}

// ---------------------------------------------------------------------------
// Git (PR 003)
// ---------------------------------------------------------------------------

/**
 * Inspeção de repositório Git para o projeto cadastrado com
 * `projectId`. Em runtime Tauri, executa `git` no diretório
 * do projeto e retorna `isRepo`, `branch`, lista de arquivos
 * modificados, totais de adições/remoções e, quando aplicável,
 * mensagem de erro.
 *
 * Fora do runtime Tauri, cai no mock preservando o formato.
 */
export async function inspectProjectGit(
  api: FluxoraAPI,
  projectId: string
): Promise<GitInspectionResult> {
  return invokeOrFallback<GitInspectionResult>(
    "git_summary",
    { projectId },
    async () => api.git.inspect(projectId)
  );
}

/**
 * Diff unificado de um arquivo específico em relação a `HEAD`.
 * Para arquivos não rastreados, retorna o conteúdo como diff
 * "novo". Em runtime Tauri, executa `git diff` no diretório
 * do projeto. O `filePath` deve ser relativo ao root do projeto
 * e é validado no backend contra path traversal.
 */
export async function diffProjectFile(
  api: FluxoraAPI,
  projectId: string,
  filePath: string
): Promise<string> {
  return invokeOrFallback<string>(
    "git_diff",
    { projectId, filePath },
    async () => api.git.diff(projectId, filePath)
  );
}

// ---------------------------------------------------------------------------
// Events (PR 005)
// ---------------------------------------------------------------------------
//
// Esta seção implementa a base real do barramento de eventos do
// FluxoraV1. Em runtime Tauri, escuta o canal único `fluxora-event`
// e despacha para todos os assinantes locais. Fora do runtime Tauri
// (modo navegador/Vite dev), o fallback é o ring buffer e os
// listeners do `mock-api.ts`, com a mesma forma de `FluxoraEvent`.
//
// Os métodos legados (`onWorkflowEvent`, `onJobUpdated`,
// `onApprovalChange`, `onOpenCodeStdout`, `onOpenCodeStderr`,
// `onOpenCodeJsonEvent`, `list`) permanecem via mock em ambos os
// modos — eles dependem do Mission Engine, que será migrado em PR
// dedicada.

/**
 * Conjunto de inscritos no barramento real. Mantido como estado
 * módulo-level para que múltiplas instâncias de bridge (em testes)
 * compartilhem os mesmos subscribers no runtime Tauri.
 */
const fluxoraEventListeners = new Set<(event: FluxoraEvent) => void>();

/**
 * Inscrição no canal Tauri `fluxora-event`. Criada preguiçosamente
 * na primeira chamada a `subscribeFluxoraEvent`, e referenciada por
 * todos os bridges em runtime Tauri.
 */
let tauriEventUnlisten: UnlistenFn | null = null;
let tauriEventListenerPromise: Promise<UnlistenFn> | null = null;

async function ensureTauriEventBridge(): Promise<UnlistenFn> {
  if (tauriEventUnlisten) return tauriEventUnlisten;
  if (tauriEventListenerPromise) return tauriEventListenerPromise;
  tauriEventListenerPromise = listen<FluxoraEvent>(
    FLUXORA_EVENT_CHANNEL,
    (event) => {
      const payload = event.payload;
      if (!payload) return;
      for (const listener of fluxoraEventListeners) {
        try {
          listener(payload);
        } catch (error) {
          console.warn("[desktopBridge] erro em listener de evento", error);
        }
      }
    }
  )
    .then((unlisten) => {
      tauriEventUnlisten = unlisten;
      return unlisten;
    })
    .catch((error) => {
      tauriEventListenerPromise = null;
      throw error;
    });
  return tauriEventListenerPromise;
}

export async function subscribeFluxoraEvent(
  api: FluxoraAPI,
  callback: (event: FluxoraEvent) => void
): Promise<() => void> {
  fluxoraEventListeners.add(callback);
  if (isTauriRuntime()) {
    try {
      await ensureTauriEventBridge();
    } catch (error) {
      console.warn(
        "[desktopBridge] não foi possível conectar ao canal Tauri fluxora-event",
        error
      );
    }
  }
  return () => {
    fluxoraEventListeners.delete(callback);
    // Não removemos a inscrição global do Tauri — ela é
    // compartilhada e barata, e remover exigiria coordenação
    // entre todos os bridges. O canal permanece ativo durante
    // toda a sessão do app.
  };
}

export function unsubscribeFluxoraEvent(unsub: () => void): void {
  try {
    unsub();
  } catch (error) {
    console.warn("[desktopBridge] erro ao remover inscrição de evento", error);
  }
}

export function onFluxoraEvent(
  api: FluxoraAPI,
  type: string,
  callback: (event: FluxoraEvent) => void
): () => void {
  const wrapped = (event: FluxoraEvent) => {
    if (event.type === type) callback(event);
  };
  return subscribeFluxoraEventSync(api, wrapped);
}

/**
 * Versão síncrona de `subscribeFluxoraEvent`. Usada por `on` para
 * preservar a forma `() => void` da API pública. A inscrição real
 * no canal Tauri é disparada em background, sem bloquear o caller.
 */
function subscribeFluxoraEventSync(
  api: FluxoraAPI,
  callback: (event: FluxoraEvent) => void
): () => void {
  fluxoraEventListeners.add(callback);
  if (isTauriRuntime()) {
    ensureTauriEventBridge().catch((error) => {
      console.warn(
        "[desktopBridge] não foi possível conectar ao canal Tauri fluxora-event",
        error
      );
    });
  }
  return () => {
    fluxoraEventListeners.delete(callback);
  };
}

export async function listRecentFluxoraEvents(
  api: FluxoraAPI,
  options?: ListRecentInput
): Promise<FluxoraEvent[]> {
  if (isTauriRuntime()) {
    try {
      return await invoke<FluxoraEvent[]>("events_list_recent", {
        input: {
          limit: options?.limit,
          type: options?.type,
        },
      });
    } catch (error) {
      console.warn(
        "[desktopBridge] events_list_recent falhou, usando mock",
        error
      );
    }
  }
  return api.events.listRecent(options);
}

export async function emitDiagnosticFluxoraEvent(
  api: FluxoraAPI,
  input: EmitDiagnosticInput
): Promise<FluxoraEvent> {
  if (isTauriRuntime()) {
    try {
      return await invoke<FluxoraEvent>("events_emit_diagnostic", {
        input: {
          message: input.message,
          level: input.level,
          source: input.source,
          projectId: input.projectId,
          missionId: input.missionId,
          agentId: input.agentId,
          payload: input.payload as never,
        },
      });
    } catch (error) {
      console.warn(
        "[desktopBridge] events_emit_diagnostic falhou, usando mock",
        error
      );
    }
  }
  return api.events.emitDiagnostic(input);
}

export async function clearRecentFluxoraEvents(api: FluxoraAPI): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke("events_clear_recent");
      return;
    } catch (error) {
      console.warn(
        "[desktopBridge] events_clear_recent falhou, usando mock",
        error
      );
    }
  }
  return api.events.clearRecent();
}

// ---------------------------------------------------------------------------
// Voice / Whisper (PR 006)
// ---------------------------------------------------------------------------
//
// Esta seção conecta o frontend ao backend Tauri real para
// transcrição de voz. A captura de áudio continua no renderer
// (`useMicCapture` → MediaRecorder). O frontend codifica os
// bytes em base64 e envia para o backend via `voice_transcribe`,
// que delega para o adapter HTTP do Whisper.
//
// Os métodos legados do mock (`saveAudio`, `getAudioPath`,
// `listRequests`, `cleanupOldAudio`, `getAudioStorageStats`,
// `openAudioFolder`, `getAudioRetentionSettings`,
// `updateAudioRetentionSettings`, `whisper.*`, `whisperLocal.*`)
// permanecem via mock nesta PR — persistência de áudio e
// download/gerência de modelos ficam para PRs futuras. O
// importante é o caminho "fala → transcrição real → texto
// para revisão" funcionar.

type BackendAudioSettings = {
  type: string;
  apiKeyEnv?: string | null;
  language?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  binaryPath?: string | null;
  modelPath?: string | null;
  threads?: number | null;
};

type BackendVoiceTranscriptionResult = {
  text: string;
  language?: string | null;
  durationMs?: number | null;
  provider: string;
  model?: string | null;
};

type BackendProviderTestResult = {
  ok: boolean;
  provider: string;
  baseUrl: string;
  model?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs: number;
};

function toFrontendAudioSettings(input: BackendAudioSettings): AudioProviderSettings {
  return {
    type: (input.type as AudioProviderSettings["type"]) || "manual",
    apiKeyEnv: input.apiKeyEnv ?? undefined,
    language: input.language ?? undefined,
    baseUrl: input.baseUrl ?? undefined,
    model: input.model ?? undefined,
    binaryPath: input.binaryPath ?? undefined,
    modelPath: input.modelPath ?? undefined,
    threads: input.threads ?? undefined,
  };
}

/**
 * Lê as configurações de áudio persistidas no backend.
 * Equivalente a `settings.getAudioProvider()`, mas a fonte
 * da verdade no runtime Tauri é o `voice.json`.
 */
export async function getAudioProviderSettings(
  api: FluxoraAPI
): Promise<AudioProviderSettings> {
  if (isTauriRuntime()) {
    try {
      const raw = await invoke<BackendAudioSettings>("voice_get_settings", {});
      return toFrontendAudioSettings(raw);
    } catch (error) {
      console.warn(
        "[desktopBridge] voice_get_settings falhou, usando mock",
        error
      );
    }
  }
  return api.settings.getAudioProvider();
}

/**
 * Persiste as configurações de áudio. Em runtime Tauri,
 * delega ao `voice_update_settings`. Fora, atualiza o mock.
 */
export async function setAudioProviderSettings(
  api: FluxoraAPI,
  patch: Partial<AudioProviderSettings>
): Promise<AudioProviderSettings> {
  if (isTauriRuntime()) {
    try {
      const payload: Record<string, unknown> = {};
      if (patch.type !== undefined) payload.providerType = patch.type;
      if (patch.apiKeyEnv !== undefined) payload.apiKeyEnv = patch.apiKeyEnv;
      if (patch.language !== undefined) payload.language = patch.language;
      if (patch.baseUrl !== undefined) payload.baseUrl = patch.baseUrl;
      if (patch.model !== undefined) payload.model = patch.model;
      if (patch.binaryPath !== undefined) payload.binaryPath = patch.binaryPath;
      if (patch.modelPath !== undefined) payload.modelPath = patch.modelPath;
      if (patch.threads !== undefined) payload.threads = patch.threads;
      const raw = await invoke<BackendAudioSettings>("voice_update_settings", {
        payload,
      });
      return toFrontendAudioSettings(raw);
    } catch (error) {
      console.warn(
        "[desktopBridge] voice_update_settings falhou, usando mock",
        error
      );
    }
  }
  return api.settings.setAudioProvider(patch);
}

/**
 * Faz a transcrição real. Em runtime Tauri, codifica os
 * bytes em base64 e chama `voice_transcribe`. Fora do Tauri,
 * cai no mock (que devolve texto vazio).
 */
export async function transcribeAudio(
  api: FluxoraAPI,
  input: AudioTranscriptionInput
): Promise<AudioTranscriptionResult> {
  if (isTauriRuntime()) {
    try {
      // Normaliza audio para Uint8Array
      let bytes: Uint8Array;
      if (input.audio instanceof Uint8Array) {
        bytes = input.audio;
      } else if (input.audio instanceof ArrayBuffer) {
        bytes = new Uint8Array(input.audio);
      } else if (typeof input.audio === "string") {
        // Pode ser base64 já codificado (fluxo incomum)
        // Encoda como bytes utf-8 para manter compatibilidade.
        bytes = new TextEncoder().encode(input.audio);
      } else {
        // Fallback: tenta converter via constructor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bytes = new Uint8Array((input.audio as any).buffer || input.audio);
      }
      const audioBase64 = bytesToBase64(bytes);
      const result = await invoke<BackendVoiceTranscriptionResult>(
        "voice_transcribe",
        {
          payload: {
            audioBase64,
            mimeType: input.mimeType,
            language: input.language,
            timeoutMs: 60_000,
          },
        }
      );
      return {
        text: result.text,
        language: result.language ?? input.language,
        durationMs: result.durationMs ?? undefined,
        provider: result.provider,
      };
    } catch (error) {
      console.warn(
        "[desktopBridge] voice_transcribe falhou, usando mock",
        error
      );
    }
  }
  return api.voice.transcribe(input);
}

/**
 * Health-check de provider (sem enviar áudio). Em runtime
 * Tauri, chama `voice_test_provider`. Fora, devolve `false`
 * (mock não testa).
 */
export async function testVoiceProvider(
  api: FluxoraAPI
): Promise<{ ok: boolean; message: string; details?: string }> {
  if (isTauriRuntime()) {
    try {
      const result = await invoke<BackendProviderTestResult>(
        "voice_test_provider",
        {}
      );
      return {
        ok: result.ok,
        message: result.ok
          ? `Provider ${result.provider} respondeu em ${result.baseUrl}.`
          : `Provider ${result.provider} não respondeu corretamente.`,
        details: result.errorMessage ?? undefined,
      };
    } catch (error) {
      return {
        ok: false,
        message: "Erro ao testar provider",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }
  // Mock fallback: chama `voice.probeServer()` que devolve boolean
  const probe = await api.voice.probeServer();
  return {
    ok: probe,
    message: probe ? "Provider (mock) disponível." : "Provider (mock) indisponível.",
  };
}

/**
 * Defaults de retenção de áudio. Mantidos no mock porque a
 * persistência de áudio em disco não é implementada nesta PR
 * (o áudio é descartado após a transcrição).
 */
const DEFAULT_AUDIO_RETENTION: AudioRetentionSettings = {
  saveAudio: false,
  retentionDays: 30,
};

// ---------------------------------------------------------------------------
// Providers (PR 007)
// ---------------------------------------------------------------------------
//
// Esta seção implementa o Provider Engine próprio do FluxoraV1.
// Em runtime Tauri, delega para o backend Rust real. Fora do
// runtime Tauri (modo navegador/Vite dev), cai no fallback do
// `mock-api.ts` (que devolve lista vazia + respostas simples).
//
// O `desktopBridge` também sobrescreve `opencode.getCatalog` /
// `getModelsForProvider` / `refreshCatalog` em runtime Tauri
// para que, quando houver providers cadastrados no Provider
// Engine, a UI passe a refletir a fonte de verdade nova
// (Provider Engine) em vez do catálogo hardcoded do Electron
// legado. A UI continua consumindo `window.fluxora.opencode.*`
// exatamente como antes — não há quebra de contrato.

type BackendProviderTestPayload = {
  ok: boolean;
  providerId: string;
  status: string;
  message?: string | null;
  durationMs: number;
  models: AiModelInfo[];
};

/**
 * Lista os providers configurados no Provider Engine.
 * Em runtime Tauri, chama `providers_list`. Fora, devolve `[]`
 * (o `desktopBridge` é quem decide; o mock também devolve `[]`).
 */
export async function listProviders(): Promise<AiProviderConfig[]> {
  if (isTauriRuntime()) {
    try {
      return await invoke<AiProviderConfig[]>("providers_list", {});
    } catch (error) {
      console.warn(
        "[desktopBridge] providers_list falhou, usando mock",
        error
      );
    }
  }
  return [];
}

export async function getProvider(id: string): Promise<AiProviderConfig | null> {
  if (isTauriRuntime()) {
    try {
      return await invoke<AiProviderConfig | null>("providers_get", { id });
    } catch (error) {
      console.warn("[desktopBridge] providers_get falhou, usando mock", error);
    }
  }
  return null;
}

export async function createProvider(
  input: Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">
): Promise<AiProviderConfig> {
  return invokeOrFallback<AiProviderConfig>(
    "providers_create",
    { payload: input },
    async () => {
      // Sem Tauri, devolvemos um stub. O mock-api também tem
      // uma versão, mas esta função é exposta diretamente.
      return {
        id: `mock-provider-${Date.now()}`,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

export async function updateProvider(
  id: string,
  input: Partial<Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">>
): Promise<AiProviderConfig> {
  return invokeOrFallback<AiProviderConfig>(
    "providers_update",
    { id, payload: input },
    async () => {
      return {
        id,
        name: input.name ?? "Mock Provider",
        kind: input.kind ?? "openai-compatible",
        baseUrl: input.baseUrl,
        apiKeyEnv: input.apiKeyEnv,
        defaultModel: input.defaultModel,
        enabled: input.enabled ?? true,
        capabilities: input.capabilities,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

export async function removeProvider(id: string): Promise<void> {
  return invokeOrFallback<void>(
    "providers_remove",
    { id },
    async () => {
      // noop no mock
    }
  );
}

/**
 * Testa um provider configurado. Em runtime Tauri, chama
 * `providers_test`. Fora, devolve `ok: false` com mensagem
 * clara.
 */
export async function testProvider(
  id: string
): Promise<ProviderTestResult> {
  if (isTauriRuntime()) {
    try {
      const result = await invoke<BackendProviderTestPayload>(
        "providers_test",
        { id }
      );
      return {
        ok: result.ok,
        providerId: result.providerId,
        status: result.status as ProviderTestResult["status"],
        message: result.message ?? undefined,
        durationMs: result.durationMs,
        models: result.models,
      };
    } catch (error) {
      return {
        ok: false,
        providerId: id,
        status: "unreachable",
        message: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      };
    }
  }
  return {
    ok: false,
    providerId: id,
    status: "unreachable",
    message: "Provider Engine só funciona em runtime Tauri.",
    durationMs: 0,
  };
}

/**
 * Lista modelos de um provider. Em runtime Tauri, chama
 * `providers_list_models`. Fora, devolve `[]`.
 */
export async function listProviderModels(id: string): Promise<AiModelInfo[]> {
  if (isTauriRuntime()) {
    try {
      const models = await invoke<AiModelInfo[]>("providers_list_models", {
        id,
      });
      // Garante que `providerId` está preenchido (o backend já
      // devolve, mas normalizamos para a UI).
      return models.map((m) => ({ ...m, providerId: m.providerId || id }));
    } catch (error) {
      console.warn(
        "[desktopBridge] providers_list_models falhou, usando mock",
        error
      );
    }
  }
  return [];
}

/**
 * Fundação técnica: faz uma chamada simples de chat. Apenas
 * para validação do adapter. O chat real fica para o Mission
 * Engine em PR futura.
 */
export async function chatOnce(
  input: ChatOnceRequest
): Promise<ChatOnceResult> {
  if (isTauriRuntime()) {
    try {
      return await invoke<ChatOnceResult>("providers_chat_once", {
        payload: input,
      });
    } catch (error) {
      return {
        text: "",
        model: input.model,
        providerId: input.providerId,
        durationMs: 0,
        usage: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  return {
    text: "",
    model: input.model,
    providerId: input.providerId,
    durationMs: 0,
    usage: { mock: true },
  };
}

/**
 * Constrói um `OpenCodeCatalogResult` a partir dos providers
 * reais do Provider Engine. Usado pelo `desktopBridge` para
 * sobrescrever `opencode.getCatalog` em runtime Tauri quando
 * há providers cadastrados.
 *
 * Estratégia:
 * - providers do `Provider Engine` viram entradas em
 *   `OpenCodeProvider.providers` com `id` no formato
 *   `provider/{id}` (mesmo padrão usado pelo OpenCode CLI).
 * - Os modelos de cada provider viram entradas em
 *   `OpenCodeModel` com `id` no formato
 *   `provider/{providerId}/{modelId}`.
 * - Se um provider não conseguir listar modelos, ele ainda
 *   aparece em `providers`, apenas sem modelos em
 *   `modelsByProvider`.
 */
async function buildCatalogFromProviders(): Promise<OpenCodeCatalogResult> {
  const providers = await listProviders();
  if (providers.length === 0) {
    return {
      providers: [],
      models: [],
      modelsByProvider: {},
      fetchedAt: new Date().toISOString(),
    };
  }
  const opencodeProviders: OpenCodeProvider[] = providers
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      displayName: p.name,
      authType: p.apiKeyEnv ? "api" : "none",
    }));
  const opencodeModels: OpenCodeModel[] = [];
  const modelsByProvider: Record<string, OpenCodeModel[]> = {};
  // Carrega modelos em paralelo.
  const modelLists = await Promise.all(
    providers
      .filter((p) => p.enabled)
      .map((p) => listProviderModels(p.id).catch(() => [] as AiModelInfo[]))
  );
  providers
    .filter((p) => p.enabled)
    .forEach((p, idx) => {
      const list = modelLists[idx] || [];
      const mapped: OpenCodeModel[] = list.map((m) => ({
        id: m.id,
        providerId: p.id,
        modelName: m.name,
        displayName: m.displayName,
      }));
      opencodeModels.push(...mapped);
      modelsByProvider[p.id] = mapped;
    });
  return {
    providers: opencodeProviders,
    models: opencodeModels,
    modelsByProvider,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// desktopBridge factory
// ---------------------------------------------------------------------------

export function createDesktopBridge(): FluxoraAPI {
  const mock = createMockAPI();

  return {
    ...mock,
    providers: {
      // PR 007 — Provider Engine próprio. Em runtime Tauri,
      // delega para o backend Rust. Fora, cai no mock
      // (que devolve lista vazia — o `opencode.getCatalog`
      // legado continua sendo a fonte no navegador).
      list() {
        return listProviders();
      },
      get(id: string) {
        return getProvider(id);
      },
      create(input) {
        return createProvider(input);
      },
      update(id, input) {
        return updateProvider(id, input);
      },
      remove(id: string) {
        return removeProvider(id);
      },
      test(id: string) {
        return testProvider(id);
      },
      listModels(id: string) {
        return listProviderModels(id);
      },
      chatOnce(input: ChatOnceRequest) {
        return chatOnce(input);
      },
    },
    projects: {
      ...mock.projects,
      async list() {
        return listProjects(mock);
      },
      async create(input: CreateProjectInput) {
        return createProject(mock, input);
      },
      async update(id: string, input: UpdateProjectInput) {
        return updateProject(mock, id, input);
      },
      async remove(id: string) {
        return removeProject(mock, id);
      },
      async selectDirectory(): Promise<SelectDirectoryResult> {
        return openProject(mock);
      },
      async validatePath(projectPath: string): Promise<ValidatePathResult> {
        return validateProjectPath(mock, projectPath);
      },
    },
    app: {
      ...mock.app,
      async getVersion() {
        return getAppVersion(mock);
      },
      async getGitInfo() {
        // Em runtime Tauri, o backend Rust fornece dados reais.
        // Fora do Tauri, o mock devolve valores estáticos para
        // o smoke-test em browser.
        if (isTauriRuntime()) {
          return getAppGitInfo();
        }
        return mock.app.getGitInfo();
      },
    },
    git: {
      ...mock.git,
      async inspect(projectId: string): Promise<GitInspectionResult> {
        return inspectProjectGit(mock, projectId);
      },
      async diff(projectId: string, filePath: string): Promise<string> {
        return diffProjectFile(mock, projectId, filePath);
      },
      // `changedFiles` e `fileDiff` continuam mockados porque
      // dependem do workflow engine, que será migrado em PR
      // dedicada (PR 007 — Mission Engine).
      changedFiles: mock.git.changedFiles.bind(mock.git),
      fileDiff: mock.git.fileDiff.bind(mock.git),
    },
    events: {
      // PR 005 — Os métodos legados (`list`, `onWorkflowEvent`,
      // `onJobUpdated`, `onApprovalChange`, `onOpenCodeStdout/Stderr/
      // JsonEvent`) permanecem exatamente como estavam no mock. Eles
      // só funcionam porque o Mission Engine gera os eventos; fora
      // do Electron/Tauri, o mock os simula localmente.
      list: mock.events.list.bind(mock.events),
      onWorkflowEvent: mock.events.onWorkflowEvent.bind(mock.events),
      onJobUpdated: mock.events.onJobUpdated.bind(mock.events),
      onApprovalChange: mock.events.onApprovalChange.bind(mock.events),
      onOpenCodeStdout: mock.events.onOpenCodeStdout.bind(mock.events),
      onOpenCodeStderr: mock.events.onOpenCodeStderr.bind(mock.events),
      onOpenCodeJsonEvent: mock.events.onOpenCodeJsonEvent.bind(mock.events),
      // PR 005 — Métodos do barramento real do FluxoraV1. Em
      // runtime Tauri, escutam o canal `fluxora-event` emitido
      // pelo backend Rust. Fora do runtime Tauri, caem no ring
      // buffer local do `mock-api.ts`.
      subscribe(callback: (event: FluxoraEvent) => void): () => void {
        // `subscribe` precisa devolver `() => void` síncrono para
        // casar com a API herdada; a inscrição Tauri é disparada
        // em background.
        return subscribeFluxoraEventSync(mock, callback);
      },
      unsubscribe(unsub: () => void): void {
        unsubscribeFluxoraEvent(unsub);
      },
      on(type: string, callback: (event: FluxoraEvent) => void): () => void {
        return onFluxoraEvent(mock, type, callback);
      },
      off(unsub: () => void): void {
        unsubscribeFluxoraEvent(unsub);
      },
      async listRecent(options?: { limit?: number; type?: string }) {
        return listRecentFluxoraEvents(mock, options);
      },
      async emitDiagnostic(input: EmitDiagnosticInput) {
        return emitDiagnosticFluxoraEvent(mock, input);
      },
      async clearRecent() {
        return clearRecentFluxoraEvents(mock);
      },
    },
    opencode: {
      // PR 007 — Provider Engine próprio. Em runtime Tauri,
      // quando há providers cadastrados no Provider Engine,
      // o catálogo passa a ser derivado de lá. A UI continua
      // consumindo `window.fluxora.opencode.getCatalog` etc.
      // exatamente como antes. Fora do runtime Tauri, o mock
      // legado (OpenCode CLI simulado) é preservado.
      detect: mock.opencode.detect.bind(mock.opencode),
      getSettings: mock.opencode.getSettings.bind(mock.opencode),
      updateSettings: mock.opencode.updateSettings.bind(mock.opencode),
      getStatus: mock.opencode.getStatus.bind(mock.opencode),
      diagnostics: mock.opencode.diagnostics,
      controlledExecution: mock.opencode.controlledExecution,
      async getCatalog(): Promise<OpenCodeCatalogResult> {
        if (isTauriRuntime()) {
          try {
            const catalog = await buildCatalogFromProviders();
            if (catalog.providers.length > 0) {
              return catalog;
            }
          } catch (error) {
            console.warn(
              "[desktopBridge] buildCatalogFromProviders falhou, usando mock",
              error
            );
          }
        }
        return mock.opencode.getCatalog();
      },
      async getModelsForProvider(providerId: string): Promise<OpenCodeModel[]> {
        if (isTauriRuntime()) {
          try {
            const catalog = await buildCatalogFromProviders();
            if (catalog.providers.length > 0) {
              return catalog.modelsByProvider[providerId] || [];
            }
          } catch (error) {
            console.warn(
              "[desktopBridge] getModelsForProvider falhou, usando mock",
              error
            );
          }
        }
        return mock.opencode.getModelsForProvider(providerId);
      },
      async refreshCatalog(): Promise<OpenCodeCatalogResult> {
        // Reaproveita o pipeline de `getCatalog`. Não há cache
        // persistente no Provider Engine — cada chamada faz
        // `GET /models` no adapter.
        return this.getCatalog();
      },
    },
    voice: {
      // PR 006 — `transcribe` agora é real em runtime Tauri
      // (delega ao backend Rust que faz HTTP para Whisper).
      // Os outros métodos (saveAudio, listRequests, retention,
      // cleanupOldAudio, etc.) permanecem mockados porque
      // persistência de áudio em disco não é implementada
      // nesta PR.
      createFromTranscript: mock.voice.createFromTranscript.bind(mock.voice),
      transcribe(input: AudioTranscriptionInput) {
        return transcribeAudio(mock, input);
      },
      listRequests: mock.voice.listRequests.bind(mock.voice),
      saveAudio: mock.voice.saveAudio.bind(mock.voice),
      saveAudioBytes: mock.voice.saveAudioBytes.bind(mock.voice),
      getAudioPath: mock.voice.getAudioPath.bind(mock.voice),
      getAudioRetentionSettings: async () => ({ ...DEFAULT_AUDIO_RETENTION }),
      updateAudioRetentionSettings: async (
        input: Partial<AudioRetentionSettings>
      ) => ({ ...DEFAULT_AUDIO_RETENTION, ...input }),
      cleanupOldAudio: async () => ({ deleted: 0, freedBytes: 0 }),
      getAudioStorageStats: async () => ({ count: 0, bytes: 0 }),
      openAudioFolder: async () => {
        // Stub — abre pasta é responsabilidade do shell Tauri
        // (PR futura: tauri-plugin-shell ou tauri-plugin-dialog).
      },
      probeServer: async () => {
        // Em runtime Tauri, faz health-check real via backend.
        const result = await testVoiceProvider(mock);
        return result.ok;
      },
    },
    settings: {
      ...mock.settings,
      // PR 006 — `getAudioProvider`/`setAudioProvider` agora
      // persistem no `voice.json` via backend Rust.
      getAudioProvider() {
        return getAudioProviderSettings(mock);
      },
      setAudioProvider(patch: Partial<AudioProviderSettings>) {
        return setAudioProviderSettings(mock, patch);
      },
    },
  };
}
