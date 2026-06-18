import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CreateProjectInput,
  FluxoraAPI,
  FluxoraEvent,
  FluxoraEventLevel,
  FluxoraEventSource,
  GitInspectionResult,
  Project,
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
// desktopBridge factory
// ---------------------------------------------------------------------------

export function createDesktopBridge(): FluxoraAPI {
  const mock = createMockAPI();

  return {
    ...mock,
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
  };
}
