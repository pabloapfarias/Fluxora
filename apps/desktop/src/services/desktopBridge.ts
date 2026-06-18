import { invoke } from "@tauri-apps/api/core";
import type {
  CreateProjectInput,
  FluxoraAPI,
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
  };
}
