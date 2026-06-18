// Project types
export type ProjectStatus =
  | "idle"
  | "planning"
  | "running"
  | "validating"
  | "waiting_approval"
  | "error"
  | "completed"
  | "cancelled";

export interface Project {
  id: string;
  name: string;
  path: string;
  stack: string[];
  status: ProjectStatus;
  currentAgent?: string;
  lastAction?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  stack: string[];
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  stack?: string[];
  status?: ProjectStatus;
  currentAgent?: string;
  lastAction?: string;
}

// Agent types
export type BuiltInAgentRole =
  | "orchestrator"
  | "planner"
  | "backend-dev"
  | "frontend-dev"
  | "mobile-dev"
  | "qa"
  | "devops";

/**
 * Custom roles keep the prefix "custom:" to avoid collision
 * with built-in agent roles.
 */
export type CustomAgentRole = `custom:${string}`;

export type AgentRole = BuiltInAgentRole | CustomAgentRole;

export const BUILT_IN_AGENT_ROLES: BuiltInAgentRole[] = [
  "orchestrator",
  "planner",
  "backend-dev",
  "frontend-dev",
  "mobile-dev",
  "qa",
  "devops",
];

export function isCustomAgentRole(role: AgentRole): role is CustomAgentRole {
  return typeof role === "string" && role.startsWith("custom:");
}

export function formatAgentRoleLabel(role: AgentRole): string {
  if (role === "backend-dev") return "Backend Dev";
  if (role === "frontend-dev") return "Frontend Dev";
  if (role === "mobile-dev") return "Mobile Dev";
  if (role === "devops") return "DevOps";
  if (role === "orchestrator") return "Orquestrador";
  if (role === "planner") return "Planner";
  if (role === "qa") return "QA";
  if (role.startsWith("custom:")) {
    const label = role.slice("custom:".length).replace(/[-_]/g, " ").trim();
    if (!label) return "Personalizado";
    return label
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return role;
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  canEditFiles: boolean;
  canRunCommands: boolean;
  requiresApproval: boolean;
  modelProviderId?: string;
  modelName?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  role: AgentRole;
  description: string;
  canEditFiles: boolean;
  canRunCommands: boolean;
  requiresApproval: boolean;
  enabled?: boolean;
  modelProviderId?: string;
  modelName?: string;
}

export interface AgentReadiness {
  agentId: string;
  ready: boolean;
  reasons: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  canEditFiles?: boolean;
  canRunCommands?: boolean;
  requiresApproval?: boolean;
  modelProviderId?: string;
  modelName?: string;
  enabled?: boolean;
}

// === OpenCode catalog types (PR 009) ===
// The OpenCode CLI is the single source of truth for providers and models.
// The Fluxora UI reflects exactly what the CLI exposes — no hardcoded catalog.

/** Provider retornado por `opencode providers list`. */
export interface OpenCodeProvider {
  /** Identificador único no OpenCode (ex.: "opencode-go", "openai", "alibaba-cn"). */
  id: string;
  /** Nome legível retornado pelo CLI (ex.: "OpenCode Go", "OpenAI"). */
  displayName: string;
  /** Tipo de autenticação ("oauth", "api", etc.). */
  authType: string;
}

/** Modelo retornado por `opencode models` ou `opencode models <provider>`. */
export interface OpenCodeModel {
  /** Identificador completo no formato provider/model (ex.: "opencode-go/glm-5.1"). */
  id: string;
  /** ID do provider ao qual o modelo pertence. */
  providerId: string;
  /** Nome do modelo sem o prefixo do provider (ex.: "glm-5.1"). */
  modelName: string;
  /** Nome amigável quando disponível via --verbose. */
  displayName?: string;
}

/** Resultado da consulta de catálogo ao OpenCode CLI. */
export interface OpenCodeCatalogResult {
  providers: OpenCodeProvider[];
  models: OpenCodeModel[];
  modelsByProvider: Record<string, OpenCodeModel[]>;
  /** Timestamp ISO 8601 da captura. */
  fetchedAt: string;
  /** Mensagem de erro quando o catálogo não pôde ser obtido. */
  error?: string;
}

export interface AgentModelSettingInput {
  modelProviderId?: string;
  modelName?: string;
}

export type MissionIntent =
  | "project_recognition"
  | "validation"
  | "bug_fix"
  | "feature_request"
  | "improvement"
  | "refactor"
  | "removal"
  | "investigation"
  | "general";

export type MissionPipeline = "recognition" | "validation" | "delivery";

export function resolveDeveloperRole(suggestedAgents: AgentRole[] = []): AgentRole {
  if (suggestedAgents.includes("backend-dev")) return "backend-dev";
  if (suggestedAgents.includes("frontend-dev")) return "frontend-dev";
  if (suggestedAgents.includes("mobile-dev")) return "mobile-dev";
  // Custom developers can also act as the developer for the mission
  // if no built-in developer role is suggested.
  const customDeveloper = suggestedAgents.find((role) => role.startsWith("custom:"));
  if (customDeveloper) return customDeveloper;
  return "backend-dev";
}

export function getRequiredAgentRolesForMission(
  intent: MissionIntent,
  suggestedAgents: AgentRole[] = []
): AgentRole[] {
  const pipeline = resolveMissionPipeline(intent);
  if (pipeline === "recognition") return ["planner"];
  if (pipeline === "validation") return ["planner", "qa"];
  return ["planner", resolveDeveloperRole(suggestedAgents), "qa"];
}

export interface MissionAgentRequirement {
  role: AgentRole;
  /** Whether this role is mandatory for the mission pipeline. */
  mandatory: boolean;
  /** Reason the role is required, used for diagnostic messages. */
  reason: string;
}

export function getMissionAgentRequirements(
  intent: MissionIntent,
  suggestedAgents: AgentRole[] = []
): MissionAgentRequirement[] {
  const pipeline = resolveMissionPipeline(intent);
  if (pipeline === "recognition") {
    return [
      { role: "planner", mandatory: true, reason: "Reconhece e produz relatório técnico da missão." },
    ];
  }
  if (pipeline === "validation") {
    return [
      { role: "planner", mandatory: true, reason: "Estrutura plano técnico antes da validação." },
      { role: "qa", mandatory: true, reason: "Executa validação e testes read-only." },
    ];
  }
  return [
    { role: "planner", mandatory: true, reason: "Analisa o pedido e cria o plano de execução." },
    { role: resolveDeveloperRole(suggestedAgents), mandatory: true, reason: "Responsável pela implementação da mudança." },
    { role: "qa", mandatory: true, reason: "Valida a entrega antes da aprovação final." },
  ];
}

export const DEFAULT_FALLBACK_AGENT_ROLE: AgentRole = "backend-dev";

/**
 * Recommendation map between a project's stack tags and the best-suited
 * developer role to handle a delivery mission in that stack.
 */
const STACK_DEVELOPER_RECOMMENDATION: Array<{ patterns: RegExp[]; role: BuiltInAgentRole }> = [
  { patterns: [/laravel/i, /php/i, /symfony/i, /nestjs/i, /node\.?js/i, /express/i, /django/i, /flask/i, /spring/i, /go/i, /rails/i, /fastapi/i], role: "backend-dev" },
  { patterns: [/vue/i, /nuxt/i, /react/i, /next\.?js/i, /svelte/i, /angular/i, /admin/i, /typescript/i, /javascript/i, /frontend/i, /web/i, /html/i, /css/i, /tailwind/i, /tailwindcss/i, /static/i], role: "frontend-dev" },
  { patterns: [/flutter/i, /dart/i, /swift/i, /kotlin/i, /react native/i, /android/i, /ios/i, /mobile/i, /ionic/i, /expo/i], role: "mobile-dev" },
];

export function recommendDeveloperRoleForStack(stack: string[] | undefined): BuiltInAgentRole {
  const list = (stack || []).map((entry) => entry.toLowerCase());
  if (list.length === 0) return DEFAULT_FALLBACK_AGENT_ROLE as BuiltInAgentRole;
  for (const entry of list) {
    for (const rule of STACK_DEVELOPER_RECOMMENDATION) {
      if (rule.patterns.some((pattern) => pattern.test(entry))) {
        return rule.role;
      }
    }
  }
  return DEFAULT_FALLBACK_AGENT_ROLE as BuiltInAgentRole;
}

export function recommendProjectStackLabel(stack: string[] | undefined): string {
  if (!stack || stack.length === 0) return "stack não definida";
  return stack.slice(0, 3).join(", ");
}

export interface AgentAutoSuggestion {
  suggestedRole: BuiltInAgentRole;
  /** Whether a project stack was used to drive the suggestion. */
  inferredFromStack: boolean;
  /** Recommended permissions for the suggested role. */
  permissions: { canEditFiles: boolean; canRunCommands: boolean; requiresApproval: boolean };
}

const ROLE_PERMISSIONS: Record<BuiltInAgentRole, AgentAutoSuggestion["permissions"]> = {
  orchestrator: { canEditFiles: false, canRunCommands: false, requiresApproval: true },
  planner: { canEditFiles: false, canRunCommands: false, requiresApproval: false },
  "backend-dev": { canEditFiles: true, canRunCommands: true, requiresApproval: true },
  "frontend-dev": { canEditFiles: true, canRunCommands: true, requiresApproval: true },
  "mobile-dev": { canEditFiles: true, canRunCommands: true, requiresApproval: true },
  qa: { canEditFiles: false, canRunCommands: true, requiresApproval: false },
  devops: { canEditFiles: false, canRunCommands: true, requiresApproval: true },
};

export function suggestAgentDefaults(stack: string[] | undefined): AgentAutoSuggestion {
  const hasStack = Boolean(stack && stack.length > 0);
  if (hasStack) {
    const developerRole = recommendDeveloperRoleForStack(stack);
    return {
      suggestedRole: developerRole,
      inferredFromStack: true,
      permissions: ROLE_PERMISSIONS[developerRole],
    };
  }
  return {
    suggestedRole: "backend-dev",
    inferredFromStack: false,
    permissions: ROLE_PERMISSIONS["backend-dev"],
  };
}

export interface ProjectRecommendation {
  projectId: string;
  developerRole: AgentRole;
  plannerRole?: AgentRole;
  qaRole?: AgentRole;
  appliedAt: string;
}

export interface GlobalDefaultAgentModel {
  providerId: string | null;
  modelName: string | null;
  updatedAt?: string;
}

export const GLOBAL_DEFAULT_AGENT_MODEL_KEY = "fluxora:globalDefaultAgentModel";

export function readGlobalDefaultAgentModel(
  storage: Storage | null | undefined
): GlobalDefaultAgentModel {
  if (!storage) return { providerId: null, modelName: null };
  try {
    const raw = storage.getItem(GLOBAL_DEFAULT_AGENT_MODEL_KEY);
    if (!raw) return { providerId: null, modelName: null };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        providerId: typeof parsed.providerId === "string" ? parsed.providerId : null,
        modelName: typeof parsed.modelName === "string" ? parsed.modelName : null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    // ignore parse errors
  }
  return { providerId: null, modelName: null };
}

export function writeGlobalDefaultAgentModel(
  storage: Storage | null | undefined,
  value: GlobalDefaultAgentModel
): void {
  if (!storage) return;
  try {
    storage.setItem(GLOBAL_DEFAULT_AGENT_MODEL_KEY, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export interface ResolvedAgentModel {
  providerId: string;
  providerName: string;
  modelName: string;
  source: "agent" | "global-default" | "project-recommendation";
}

export function resolveAgentModel(
  agent: Pick<Agent, "modelProviderId" | "modelName">,
  catalog: OpenCodeCatalogResult | null | undefined,
  globalDefault: GlobalDefaultAgentModel
): ResolvedAgentModel | null {
  if (agent.modelProviderId && agent.modelName) {
    // Verifica contra o catálogo se ele estiver disponível.
    if (catalog) {
      const provider = catalog.providers.find((p) => p.id === agent.modelProviderId);
      const model = catalog.models.find((m) => m.id === agent.modelName);
      if (provider && model) {
        return {
          providerId: provider.id,
          providerName: provider.displayName,
          modelName: agent.modelName,
          source: "agent",
        };
      }
    } else {
      // Sem catálogo, aceita o que está salvo.
      return {
        providerId: agent.modelProviderId,
        providerName: agent.modelProviderId,
        modelName: agent.modelName,
        source: "agent",
      };
    }
  }
  if (globalDefault.providerId && globalDefault.modelName) {
    if (catalog) {
      const provider = catalog.providers.find((p) => p.id === globalDefault.providerId);
      const model = catalog.models.find((m) => m.id === globalDefault.modelName);
      if (provider && model) {
        return {
          providerId: provider.id,
          providerName: provider.displayName,
          modelName: globalDefault.modelName,
          source: "global-default",
        };
      }
    } else {
      return {
        providerId: globalDefault.providerId,
        providerName: globalDefault.providerId,
        modelName: globalDefault.modelName,
        source: "global-default",
      };
    }
  }
  return null;
}

export function readProjectRecommendations(storage: Storage | null | undefined): Record<string, ProjectRecommendation> {
  if (!storage) return {};
  try {
    const raw = storage.getItem("fluxora:projectRecommendations");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, ProjectRecommendation>;
    }
  } catch {
    return {};
  }
  return {};
}

export function writeProjectRecommendations(
  storage: Storage | null | undefined,
  map: Record<string, ProjectRecommendation>
): void {
  if (!storage) return;
  try {
    storage.setItem("fluxora:projectRecommendations", JSON.stringify(map));
  } catch {
    // ignore storage errors (quota, private mode)
  }
}

export function recordProjectRecommendation(
  storage: Storage | null | undefined,
  recommendation: ProjectRecommendation
): Record<string, ProjectRecommendation> {
  const current = readProjectRecommendations(storage);
  current[recommendation.projectId] = recommendation;
  writeProjectRecommendations(storage, current);
  return current;
}

export interface ProjectRecommendationHistoryEntry {
  id: string;
  developerRole: AgentRole;
  plannerRole?: AgentRole;
  qaRole?: AgentRole;
  appliedAt: string;
  source: "mission" | "manual" | "stack-inference";
}

export function readProjectRecommendationHistory(
  storage: Storage | null | undefined,
  projectId: string
): ProjectRecommendationHistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(`fluxora:projectRecommendations:history:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ProjectRecommendationHistoryEntry[];
  } catch {
    return [];
  }
  return [];
}

export function appendProjectRecommendationHistory(
  storage: Storage | null | undefined,
  projectId: string,
  entry: ProjectRecommendationHistoryEntry
): ProjectRecommendationHistoryEntry[] {
  const current = readProjectRecommendationHistory(storage, projectId);
  const next = [entry, ...current].slice(0, 10);
  try {
    storage?.setItem(`fluxora:projectRecommendations:history:${projectId}`, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

/**
 * Heuristics to pick a more specific Planner or QA agent role from a
 * project's stack tags. Returns null when no specialised match exists,
 * letting the orchestrator fall back to the default roles.
 */
const STACK_PLANNER_RECOMMENDATION: Array<{ patterns: RegExp[]; role: BuiltInAgentRole }> = [
  { patterns: [/security/i, /auth/i, /payment/i, /finance/i, /infra/i, /devops/i, /kubernetes/i, /terraform/i, /cloud/i], role: "devops" },
  { patterns: [/data/i, /ml/i, /analytics/i, /science/i], role: "planner" },
];

const STACK_QA_RECOMMENDATION: Array<{ patterns: RegExp[]; role: BuiltInAgentRole }> = [
  { patterns: [/mobile/i, /flutter/i, /android/i, /ios/i], role: "qa" },
  { patterns: [/frontend/i, /vue/i, /react/i, /angular/i, /web/i, /ui/i], role: "qa" },
  { patterns: [/api/i, /laravel/i, /node/i, /backend/i, /microservice/i], role: "qa" },
];

export function recommendPlannerRoleForStack(stack: string[] | undefined): BuiltInAgentRole | null {
  const list = (stack || []).map((entry) => entry.toLowerCase());
  for (const entry of list) {
    for (const rule of STACK_PLANNER_RECOMMENDATION) {
      if (rule.patterns.some((pattern) => pattern.test(entry))) {
        return rule.role;
      }
    }
  }
  return null;
}

export function recommendQaRoleForStack(stack: string[] | undefined): BuiltInAgentRole | null {
  const list = (stack || []).map((entry) => entry.toLowerCase());
  for (const entry of list) {
    for (const rule of STACK_QA_RECOMMENDATION) {
      if (rule.patterns.some((pattern) => pattern.test(entry))) {
        return rule.role;
      }
    }
  }
  return null;
}

export interface MissionPrecheck {
  intent: MissionIntent;
  pipeline: MissionPipeline;
  requirements: MissionAgentRequirement[];
  missingRoles: AgentRole[];
  missingProvider: boolean;
  blockingReasons: string[];
  recommendations: Array<{ role: AgentRole; agentName?: string; ready: boolean }>;
}

export interface MissionPrecheckInput {
  text: string;
  intent: MissionIntent;
  suggestedAgents?: AgentRole[];
  activeProject?: { stack?: string[] };
  agents: Pick<Agent, "id" | "name" | "role" | "modelProviderId" | "modelName" | "enabled">[];
  catalog?: OpenCodeCatalogResult | null;
}

export function buildMissionPrecheck(input: MissionPrecheckInput): MissionPrecheck {
  const { intent, suggestedAgents = [], activeProject, agents, catalog = null } = input;
  const pipeline = resolveMissionPipeline(intent);
  const requirements = getMissionAgentRequirements(intent, suggestedAgents);
  const hasEnabledProvider = catalog ? catalog.providers.length > 0 : agents.some((a) => Boolean(a.modelProviderId && a.modelName));
  const missingRoles: AgentRole[] = [];
  const recommendations: MissionPrecheck["recommendations"] = [];
  const blockingReasons: string[] = [];

  if (!hasEnabledProvider) {
    blockingReasons.push("Nenhum provider disponível no OpenCode. Configure credenciais via `opencode providers`.");
  }

  for (const req of requirements) {
    const agent = agents.find((entry) => entry.role === req.role);
    if (!agent) {
      missingRoles.push(req.role);
      blockingReasons.push(`Papel sem agente cadastrado: ${formatAgentRoleLabel(req.role)}.`);
    } else if (!isAgentConfiguredForRealExecution(agent, catalog)) {
      blockingReasons.push(`${agent.name} (${formatAgentRoleLabel(req.role)}) sem provider/modelo ativo.`);
    }
  }

  // Build skill-based recommendations when the agent is missing
  if (activeProject?.stack && activeProject.stack.length > 0) {
    const devRole = recommendDeveloperRoleForStack(activeProject.stack);
    const plannerRole = recommendPlannerRoleForStack(activeProject.stack);
    const qaRole = recommendQaRoleForStack(activeProject.stack);
    for (const role of [devRole, plannerRole, qaRole].filter((value): value is BuiltInAgentRole => Boolean(value))) {
      const matched = agents.find((entry) => entry.role === role);
      recommendations.push({
        role,
        agentName: matched?.name,
        ready: matched ? isAgentConfiguredForRealExecution(matched, catalog) : false,
      });
    }
  }

  return {
    intent,
    pipeline,
    requirements,
    missingRoles,
    missingProvider: !hasEnabledProvider,
    blockingReasons,
    recommendations,
  };
}

export function isAgentConfiguredForRealExecution(
  agent: Pick<Agent, "modelProviderId" | "modelName" | "enabled">,
  catalog?: OpenCodeCatalogResult | null
): boolean {
  if (!agent.enabled) return false;
  if (!agent.modelProviderId) return false;
  if (!agent.modelName || !agent.modelName.trim()) return false;
  // Sem catálogo carregado, aceitamos o que está salvo (não bloqueamos a UI).
  if (!catalog) return true;
  // O catálogo é a fonte da verdade: o provider precisa existir e o modelo
  // precisa estar disponível nesse provider.
  const providerExists = catalog.providers.some((p) => p.id === agent.modelProviderId);
  if (!providerExists) return false;
  const modelExists = catalog.models.some((m) => m.id === agent.modelName);
  return modelExists;
}

export function isAgentReadyWithFallback(
  agent: Pick<Agent, "modelProviderId" | "modelName" | "enabled">,
  catalog?: OpenCodeCatalogResult | null,
  globalDefault?: GlobalDefaultAgentModel
): boolean {
  if (isAgentConfiguredForRealExecution(agent, catalog)) return true;
  if (!agent.enabled) return false;
  return Boolean(globalDefault?.providerId && globalDefault.modelName);
}

export function getAgentReadiness(
  agent: Pick<Agent, "id" | "modelProviderId" | "modelName" | "enabled">,
  catalog?: OpenCodeCatalogResult | null,
  globalDefault?: GlobalDefaultAgentModel
): AgentReadiness {
  const reasons: string[] = [];
  const fallback = hasFallback(globalDefault);
  if (!agent.enabled) reasons.push("Agente desabilitado.");
  if (!agent.modelProviderId) {
    if (fallback) {
      reasons.push("Sem provider próprio. Usará o provider/modelo global padrão.");
    } else {
      reasons.push("Nenhum provider selecionado.");
      reasons.push("Defina um provider/modelo global padrão nas Configurações.");
    }
  } else {
    const providerExists = !catalog || catalog.providers.some((p) => p.id === agent.modelProviderId);
    if (!providerExists) {
      reasons.push("Provider selecionado não está disponível no OpenCode atual.");
    }
  }
  if (!agent.modelName || !agent.modelName.trim()) {
    if (fallback) {
      reasons.push("Sem modelo próprio. Usará o modelo global padrão.");
    } else {
      reasons.push("Nenhum modelo selecionado.");
    }
  } else if (catalog) {
    const modelExists = catalog.models.some((m) => m.id === agent.modelName);
    if (!modelExists) {
      reasons.push("Modelo selecionado não está disponível no OpenCode atual.");
    }
  }
  const blocking = !agent.enabled || (!fallback && (!agent.modelProviderId || !agent.modelName?.trim()));
  return { agentId: agent.id, ready: !blocking, reasons };
}

function hasFallback(globalDefault?: GlobalDefaultAgentModel): boolean {
  return Boolean(globalDefault?.providerId && globalDefault.modelName);
}

// Workflow types
export type WorkflowRunStatus =
  | "pending_approval"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

export type WorkflowStepType = "planner" | "developer" | "qa" | "finalization";
export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface WorkflowRun {
  id: string;
  projectId?: string;
  title: string;
  prompt: string;
  generatedContext?: string;
  status: WorkflowRunStatus;
  currentStepId?: string;
  executionMode?: WorkflowExecutionMode;
  realStrategy?: RealWorkflowStrategy;
  finalApprovalId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkflowStep {
  id: string;
  workflowRunId: string;
  name: string;
  type: WorkflowStepType;
  agentId?: string;
  status: WorkflowStepStatus;
  startedAt?: string;
  completedAt?: string;
  output?: string;
}

export interface WorkflowEvent {
  id: string;
  workflowRunId?: string;
  projectId?: string;
  type: string;
  message: string;
  metadata?: string;
  createdAt: string;
}

export interface WorkflowRunDetail extends WorkflowRun {
  steps: WorkflowStep[];
  events: WorkflowEvent[];
}

export interface CreateWorkflowInput {
  projectId?: string;
  title: string;
  prompt: string;
  generatedContext: string;
  executionMode?: WorkflowExecutionMode;
  realStrategy?: RealWorkflowStrategy;
  steps: Array<{
    name: string;
    type: WorkflowStepType;
    agentId?: string;
  }>;
}

/**
 * Overrides aceitos ao reexecutar uma missão a partir de uma execução
 * anterior (normalmente `failed`, `cancelled` ou `timeout`). Todos os
 * campos são opcionais — quando ausentes, reutiliza o que estava no
 * `WorkflowRun` original.
 */
export interface WorkflowRerunInput {
  /** Substitui o prompt original (caso o usuário tenha editado). */
  prompt?: string;
  /** Substitui o modo de execução (ex.: rebaixar para `simulated`). */
  executionMode?: WorkflowExecutionMode;
  /** Substitui a estratégia real (`single` | `multi_agent`). */
  realStrategy?: RealWorkflowStrategy;
  /**
   * Override do timeout (ms) aplicado apenas a esta reexecução.
   * Quando fornecido, atualiza temporariamente o default do engine
   * e persiste nas configurações do OpenCode.
   */
  defaultTimeoutMs?: number;
}

/** Retorno padrão de operações que disparam um job em background. */
export interface WorkflowRunJobResult {
  jobId: string;
  workflowRunId: string;
}

// Approval types
export type ApprovalImpact = "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  title: string;
  description: string;
  impact: ApprovalImpact;
  status: ApprovalStatus;
  projectId?: string;
  workflowRunId?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ─── Rastreabilidade (PR 008) ─────────────────────────────────────────

/**
 * Contexto validado de uma aprovação.
 * Usado pela UI para decidir se mostra botões Aprovar/Rejeitar.
 */
export interface ApprovalContext {
  id: string;
  runId?: string;
  title: string;
  missionTitle: string;
  reason: string;
  generatedBy: string;
  impact: ApprovalImpact;
  changedFiles: ChangedFileSummary[];
  diffSummary: string;
  remainingIssues: string[];
  qaSummary: string;
  automaticAttempts: string[];
  canApprove: boolean;
  invalidReason?: string;
}

/**
 * Valida se uma aprovação tem contexto acionável.
 * Retorna ApprovalContext com canApprove=false se faltar dados essenciais.
 */
export function validateApprovalContext(
  approval: Approval,
  opts?: { changedFiles?: ChangedFileSummary[]; agentOutputs?: AgentStepOutput[]; runPrompt?: string }
): ApprovalContext {
  const description = approval.description || "";
  const lines = description.split("\n");

  // Extrair seções da descrição
  const missionLine = lines.find((l) => l.startsWith("Missão:")) || "";
  const reasonLine = lines.find((l) => l.startsWith("Motivo:")) || "";
  const agentLine = lines.find((l) => l.startsWith("Agente:")) || "";
  const summaryLine = lines.find((l) => l.startsWith("Resumo:")) || "";

  // Prompt/missão do workflow (se o caller passar via opts) é fonte mais
  // confiável de contexto do que a descrição da aprovação — especialmente
  // para pedidos simples vindos de voz/comando direto.
  const runPrompt = opts?.runPrompt?.trim() || "";

  const missionTitle =
    missionLine.replace("Missão:", "").trim() ||
    (runPrompt ? runPrompt.split("\n")[0].slice(0, 120) : "") ||
    approval.title;
  const reason =
    reasonLine.replace("Motivo:", "").trim() ||
    (runPrompt ? runPrompt : "");
  const generatedBy = agentLine.replace("Agente:", "").trim() || "Desconhecido";
  const diffSummary = summaryLine.replace("Resumo:", "").trim() || "";

  // Extrair arquivos da descrição (linhas que começam com "- ")
  const fileLines = lines.filter((l) => l.startsWith("- ") && (l.includes("/") || l.includes("\\")));
  const changedFiles: ChangedFileSummary[] =
    opts?.changedFiles ||
    fileLines.map((l) => {
      const match = l.match(/^- (.+?)\s*\((\w+),\s*\+(\d+)\/-(\d+)\)/);
      if (match) {
        return {
          path: match[1],
          status: match[2] as ChangedFileSummary["status"],
          additions: parseInt(match[3], 10),
          deletions: parseInt(match[4], 10),
        };
      }
      return { path: l.replace(/^- /, "").trim(), status: "modified" as const, additions: 0, deletions: 0 };
    });

  // Extrair tentativas automáticas
  const attemptsStart = lines.findIndex((l) => l.includes("Tentativas automáticas") || l.includes("Tentativas de correção"));
  const automaticAttempts: string[] = [];
  if (attemptsStart >= 0) {
    for (let i = attemptsStart + 1; i < lines.length; i++) {
      if (lines[i].match(/^\d+\.\s/)) automaticAttempts.push(lines[i]);
      else if (lines[i].trim() && !lines[i].startsWith(" ")) break;
    }
  }

  // Extrair problemas restantes
  const issuesStart = lines.findIndex((l) => l.includes("Problemas restantes"));
  const remainingIssues: string[] = [];
  if (issuesStart >= 0) {
    for (let i = issuesStart + 1; i < lines.length; i++) {
      if (lines[i].startsWith("- ")) remainingIssues.push(lines[i]);
      else if (lines[i].trim()) break;
    }
  }

  // Extrair resumo do QA (pode estar na mesma linha ou na próxima)
  const qaStart = lines.findIndex((l) => l.startsWith("QA:"));
  let qaSummary = "";
  if (qaStart >= 0) {
    const sameLine = lines[qaStart].replace("QA:", "").trim();
    if (sameLine) {
      qaSummary = sameLine;
    } else if (qaStart + 1 < lines.length && lines[qaStart + 1].trim()) {
      qaSummary = lines[qaStart + 1].trim();
    }
  }

  // Validar se tem contexto acionável
  // Heurística antiga exigia arquivos/diff/QA/etc. — muito estrita para
  // pedidos simples (ex.: "criar página HTML para advogados"). Aceitamos
  // também um prompt/missão legível como contexto suficiente.
  const promptLength = (runPrompt || reason).length;
  const hasPrompt = promptLength >= 12;
  const hasMission = Boolean(missionTitle && missionTitle.length >= 6);
  const hasReason = promptLength >= 12;
  const hasFiles = changedFiles.length > 0;
  const hasDiff = Boolean(diffSummary);
  const hasQa = Boolean(qaSummary);
  const hasIssues = remainingIssues.length > 0;
  const hasAttempts = automaticAttempts.length > 0;
  const hasError = description.toLowerCase().includes("erro") || description.toLowerCase().includes("falha");

  const hasActionableContext = hasFiles || hasDiff || hasQa || hasIssues || hasAttempts || hasError;

  let canApprove = true;
  let invalidReason: string | undefined;

  if (!hasReason && !hasActionableContext) {
    canApprove = false;
    invalidReason = "Aprovação inválida: contexto insuficiente. O sistema não conseguiu determinar o que precisa ser aprovado.";
  } else if (hasReason && promptLength < 32 && !hasFiles && !hasDiff && !hasQa && !hasIssues && !hasAttempts) {
    // Prompt curto demais (ex.: "Criar landing"). Permite aprovar mas
    // avisa para o usuário expandir o pedido.
    canApprove = true;
    invalidReason = "Contexto mínimo: descreva brevemente o que deve ser feito para melhorar a auditoria.";
  }

  return {
    id: approval.id,
    runId: approval.workflowRunId,
    title: approval.title,
    missionTitle,
    reason,
    generatedBy,
    impact: approval.impact,
    changedFiles,
    diffSummary,
    remainingIssues,
    qaSummary,
    automaticAttempts,
    canApprove,
    invalidReason,
  };
}

// Voice types
export interface VoiceContextResult {
  intent: MissionIntent;
  title: string;
  summary: string;
  suggestedProjects: string[];
  suggestedAgents: AgentRole[];
  risk: ApprovalImpact;
  requiresApproval: boolean;
}

export function classifyMissionIntent(text: string): MissionIntent {
  const lower = text.toLowerCase();

  if (
    /reconhec(imento|er|a)|analis(e|ar)|entend(a|er)|descrev(a|er)|explic(a|ar)|mape(a|ar)|levant(e|ar).*(projeto|código|codigo|repositório|repositorio|estrutura)/i.test(lower)
  ) {
    return "project_recognition";
  }

  if (
    /valid(ar|e)|test(ar|e)|verific(ar|e)|chec(ar|k)|auditar|revis(ar|e)|inspecion(ar|e)/i.test(lower)
    && !/(criar|adicionar|implementar|corrigir|alterar|modificar|refatorar|remover)/i.test(lower)
  ) {
    return "validation";
  }

  if (/investig(ar|ue)|diagnostic(ar|o)|descobrir causa|causa raiz|root cause/i.test(lower)) {
    return "investigation";
  }

  if (/refator(ar|e)|reestrutur(ar|e)|reorganiz(ar|e)/i.test(lower)) {
    return "refactor";
  }

  if (/corrigir|corrija|bug|erro|falha|hotfix|fix/i.test(lower)) {
    return "bug_fix";
  }

  if (/\b(cri(e|ar|ando|ado|amos|am|ação|acao)|criar|adicionar|novo|nova|implementar|desenvolver|construi(r|do|da|m|mos)|montar|gerar|produzir|fazer|faça|faca|preciso de|preciso que|preciso que voce|quer(o|ia|emos)? que|quer(o|ia|emos)? uma|quer(o|ia|emos)? um)\b/i.test(lower)) {
    return "feature_request";
  }

  if (/melhor(ar|e)|otimiz(ar|e)|aperfeiço(ar|e)|aprimor(ar|e)/i.test(lower)) {
    return "improvement";
  }

  if (/remover|deletar|excluir|eliminar/i.test(lower)) {
    return "removal";
  }

  return "general";
}

export function resolveMissionPipeline(intent: MissionIntent): MissionPipeline {
  if (intent === "project_recognition" || intent === "investigation") return "recognition";
  if (intent === "validation") return "validation";
  return "delivery";
}

export interface VoiceRequest {
  id: string;
  transcript: string;
  generatedContext?: string;
  status: string;
  createdAt: string;
  audioPath?: string;
  audioMimeType?: string;
  durationMs?: number;
}

// Settings
export interface Setting {
  key: string;
  value: string;
  updatedAt: string;
}

// ============================================================================
// PR 003 — Multiagente, Whisper, JSON parsing, áudio persistido
// ============================================================================

export type RealWorkflowStrategy = "single" | "multi_agent";

export type MultiAgentRole = "planner" | "developer" | "qa" | "fixer";

export type AgentStepStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentStepOutput {
  id: string;
  workflowRunId: string;
  projectId: string;
  stepId?: string;
  agentRole: MultiAgentRole | string;
  agentName?: string;
  prompt: string;
  output?: string;
  parsedOutput?: string;
  status: AgentStepStatus;
  startedAt: string;
  completedAt?: string;
}

export type WhisperProviderType = "manual" | "whisper_local_managed" | "openai_whisper" | "whisper_http" | "whisper_local";

export interface WhisperHttpConfig {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  language?: string;
}

export interface WhisperSettings {
  type: WhisperProviderType;
  baseUrl?: string;
  apiKeyEnv?: string;
  model?: string;
  language?: string;
}

export interface VoiceAudioRecord {
  voiceRequestId: string;
  audioPath: string;
  audioMimeType: string;
  durationMs: number;
}

// ============================================================================
// PR 002 — OpenCode, Git, Audio, Execution Mode
// ============================================================================

export type WorkflowExecutionMode = "simulated" | "real";
export type OpenCodeStatus = "not_configured" | "not_detected" | "detected" | "running" | "error";

export interface OpenCodeSettings {
  binaryPath: string;
  defaultTimeoutMs: number;
  enabled: boolean;
}

export interface OpenCodeDetection {
  status: OpenCodeStatus;
  binaryPath: string;
  version?: string;
  message?: string;
  checkedAt: string;
}

export type OpenCodeOutputFormat = "default" | "json";

export type OpenCodeDiagnosticStatus =
  | "not_installed"
  | "detected"
  | "usable"
  | "smoke_test_failed"
  | "environment_mismatch"
  | "session_warning"
  | "misconfigured"
  | "auth_error"
  | "provider_error"
  | "permission_error"
  | "unknown_error";

export type OpenCodeDiagnosticSeverity = "success" | "warning" | "error";

export interface OpenCodeDiagnosticCheck {
  name: string;
  command: string;
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  severity: "info" | "warning" | "error";
  interpretation: string;
}

export interface OpenCodeDiagnosticEnvironment {
  platform: string;
  arch: string;
  cwd: string;
  execPath: string;
  home?: string;
  path?: string;
  shell?: string;
  resolvedBinaryPath?: string;
}

export interface OpenCodeDiagnosticResult {
  status: OpenCodeDiagnosticStatus;
  severity: OpenCodeDiagnosticSeverity;
  binaryPath: string;
  resolvedPath?: string;
  version?: string;
  providersDetected?: string[];
  supportsRun: boolean;
  supportsFormatJson: boolean;
  supportsAgent: boolean;
  supportsModel: boolean;
  supportsDir: boolean;
  isCliUsable: boolean;
  isRunCommandAvailable: boolean;
  isSmokeTestBlocking: boolean;
  runSmokeTest?: {
    attempted: boolean;
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    errorMessage?: string;
  };
  controlledRunTest?: {
    attempted: boolean;
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    jsonEvents?: unknown[];
    changedFilesDetected?: boolean;
  };
  checks: OpenCodeDiagnosticCheck[];
  environment: OpenCodeDiagnosticEnvironment;
  recommendations: string[];
  checkedAt: string;
}

export interface OpenCodeDiagnosticInput {
  binaryPath: string;
  projectPath?: string;
  runSmokeTest?: boolean;
  timeoutMs?: number;
  format?: OpenCodeOutputFormat;
  controlledRunTest?: boolean;
  environmentOverrides?: Record<string, string | undefined>;
  environment?: Partial<OpenCodeDiagnosticEnvironment>;
}

export interface BackgroundWorkflowJob {
  id: string;
  workflowRunId: string;
  projectId: string;
  strategy: "single" | "multi_agent" | "controlled_execution";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
}

export interface CommandRun {
  id: string;
  workflowRunId?: string;
  projectId?: string;
  command: string;
  args: string[];
  cwd: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";
  stdout: string;
  stderr: string;
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ChangedFile {
  id: string;
  workflowRunId: string;
  projectId: string;
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  createdAt: string;
}

export interface FileDiff {
  id: string;
  workflowRunId: string;
  projectId: string;
  filePath: string;
  diff: string;
  createdAt: string;
}

export interface OpenCodeSession {
  id: string;
  workflowRunId: string;
  projectId: string;
  commandRunId?: string;
  prompt: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
}

export interface ControlledExecutionRunInput {
  workflowRunId: string;
}

export interface ControlledExecutionRunResult {
  status: "completed" | "failed" | "cancelled";
  workflowRunId: string;
  projectId: string;
  projectRoot: string;
  projectPath: string;
  sandboxReadmePath: string;
  changedFiles: ChangedFileSummary[];
  outOfScopeFiles: string[];
  finalApprovalId?: string;
}

export interface ControlledExecutionRunJob {
  jobId: string;
  workflowRunId: string;
}

export type AudioProviderType = "manual" | "whisper_local_managed" | "whisper_http" | "whisper_local" | "openai_whisper";

export type WhisperModelQuality = "low" | "medium" | "high" | "very_high";
export type WhisperModelSpeed = "fast" | "medium" | "slow";
export type WhisperDownloadStatus = "idle" | "downloading" | "completed" | "error";

export interface WhisperModelInfo {
  id: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  recommendedRamGb: number;
  language: "multi" | "en";
  quality: WhisperModelQuality;
  speed: WhisperModelSpeed;
  url: string;
  sha256?: string;
  installed: boolean;
  localPath?: string;
}

export interface WhisperDownloadProgress {
  modelId: string;
  status: WhisperDownloadStatus;
  downloadedBytes: number;
  totalBytes?: number;
  error?: string;
}

export interface WhisperInstallStatus {
  ok: boolean;
  binaryPath?: string;
  modelsDir: string;
  installedModels: string[];
  selectedModel?: string;
  message: string;
}

export interface AudioRetentionSettings {
  saveAudio: boolean;
  retentionDays: 7 | 15 | 30 | 90;
}

export interface AudioStorageStats {
  count: number;
  bytes: number;
}

export interface AudioProviderSettings {
  type: AudioProviderType;
  apiKeyEnv?: string;
  language?: string;
  baseUrl?: string;
  model?: string;
  binaryPath?: string;
  modelPath?: string;
  threads?: number;
}

export interface AudioTranscriptionInput {
  audio: ArrayBuffer | Uint8Array | string;
  mimeType: string;
  language?: string;
  providerType?: AudioProviderType;
}

export interface AudioTranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
  provider: string;
}

export interface VoiceRequestRecord {
  id: string;
  transcript: string;
  generatedContext?: string;
  audioProvider: AudioProviderType;
  status: string;
  createdAt: string;
}

// ============================================================================
// PR 006 — Contrato do barramento de voz
// ============================================================================
//
// Tipos auxiliares para o payload dos eventos `voice/*` no
// barramento `fluxora-event`. Backend emite, frontend
// consome via `events.subscribe` ou `events.on("voice/...")`.

/** Tipos canônicos de provider reconhecidos pelo backend. */
export type VoiceProviderKind =
  | "whisper-http"
  | "whisper-local"
  | "whisper-local-managed"
  | "openai-whisper"
  | "manual";

/** Payload base comum a todos os eventos `voice/*`. */
export interface VoiceEventBase {
  kind: VoiceEventType;
  provider: VoiceProviderKind;
  model?: string;
  language?: string;
}

/** Payload emitido no início da transcrição. */
export interface VoiceTranscriptionStartedPayload extends VoiceEventBase {
  kind: "voice/transcription-started";
  bytes: number;
  mimeType?: string;
}

/** Payload emitido no fim bem-sucedido da transcrição. */
export interface VoiceTranscriptionCompletedPayload extends VoiceEventBase {
  kind: "voice/transcription-completed";
  durationMs: number;
  textLength: number;
  language?: string;
}

/** Payload emitido quando a transcrição falha. */
export interface VoiceTranscriptionFailedPayload extends VoiceEventBase {
  kind: "voice/transcription-failed";
  durationMs: number;
  errorCode: string;
  /** Mensagem de erro já com secrets removidos. */
  errorMessage: string;
}

/** Payload emitido pelo `voice_test_provider` ou auto-teste. */
export interface VoiceProviderTestedPayload extends VoiceEventBase {
  kind: "voice/provider-tested";
  ok: boolean;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}

/** Payload emitido quando `AudioProviderSettings` é atualizado. */
export interface VoiceSettingsUpdatedPayload {
  kind: "voice/settings-updated";
  provider: VoiceProviderKind;
}

/** União discriminada de todos os payloads `voice/*`. */
export type VoiceEventPayload =
  | VoiceTranscriptionStartedPayload
  | VoiceTranscriptionCompletedPayload
  | VoiceTranscriptionFailedPayload
  | VoiceProviderTestedPayload
  | VoiceSettingsUpdatedPayload;

export interface ChangedFileSummary {
  path: string;
  status: ChangedFile["status"];
  additions: number;
  deletions: number;
}

export interface DiffStat {
  files: ChangedFileSummary[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface GitInspectionResult {
  isRepo: boolean;
  branch?: string;
  files: ChangedFileSummary[];
  totalAdditions: number;
  totalDeletions: number;
  error?: string;
}

export interface SelectDirectoryResult {
  canceled: boolean;
  path?: string;
}

export interface ValidatePathResult {
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  hasGit: boolean;
  normalizedPath?: string;
  detectedStack?: string[];
  relevantFiles?: string[];
  error?: string;
}

// ============================================================================
// PR 005 — Contrato de evento do barramento real
// ============================================================================
//
// O barramento do FluxoraV1 trafega por um único canal do Tauri
// (`fluxora-event`) e usa `type` para diferenciar o significado de
// cada evento. A UI consome via `window.fluxora.events.subscribe(...)`
// e filtra por `event.type`.
//
// O conjunto de `type` é aberto: backend e frontend podem adicionar
// novos valores sem alterar o tipo base. Os valores abaixo são
// recomendados pela PR 005 e formam o vocabulário mínimo que as
// próximas PRs (Voice, Provider Engine, Mission Engine, Piloto
// Automático) já podem assumir como existente.

/** Origem do evento no FluxoraV1. */
export type FluxoraEventSource =
  | "app"
  | "project"
  | "mission"
  | "agent"
  | "voice"
  | "system";

/** Nível de severidade do evento. */
export type FluxoraEventLevel = "debug" | "info" | "warn" | "error";

/** Tipos canônicos recomendados para a PR 005. Outros valores são livres. */
export type FluxoraEventType =
  | "app/ready"
  | "app/diagnostic"
  | "project/opened"
  | "project/updated"
  | "project/removed"
  | "mission/event"
  | "mission/log"
  | "mission/phase"
  | "agent/event"
  | "voice/event"
  | "system/error";

/**
 * Sub-tipos do `FluxoraEvent` quando `source === "voice"`.
 *
 * O barramento do FluxoraV1 trafega por um único canal do Tauri
 * (`fluxora-event`). Para eventos de voz, o `type` segue o padrão
 * `voice/<kind>` e o `payload` traz metadados específicos do
 * provedor (provider, model, durationMs etc.).
 *
 * Esses tipos são introduzidos na PR 006 (Voice/Whisper) mas
 * definidos no contrato compartilhado para que o Mission Engine
 * (PR 008) e o piloto automático (PR 009) possam reagir a eles.
 */
export type VoiceEventType =
  | "voice/transcription-started"
  | "voice/transcription-completed"
  | "voice/transcription-failed"
  | "voice/provider-tested"
  | "voice/settings-updated";

/** Evento genérico do barramento do FluxoraV1. */
export interface FluxoraEvent {
  /** Identificador único do evento. */
  id: string;
  /** Tipo semântico do evento (ex.: "app/ready", "project/updated"). */
  type: string;
  /** Momento de emissão em ISO 8601. */
  timestamp: string;
  /** Origem do evento no sistema. */
  source: FluxoraEventSource;
  /** Nível de severidade. */
  level: FluxoraEventLevel;
  /** ID do projeto associado, quando aplicável. */
  projectId?: string;
  /** ID da missão associada, quando aplicável. */
  missionId?: string;
  /** ID do agente associado, quando aplicável. */
  agentId?: string;
  /** Mensagem curta, legível, para UI/logs. */
  message?: string;
  /** Payload arbitrário para dados específicos do evento. */
  payload?: unknown;
}

// IPC API types
export interface FluxoraAPI {
  projects: {
    list(): Promise<Project[]>;
    create(input: CreateProjectInput): Promise<Project>;
    update(id: string, input: UpdateProjectInput): Promise<Project>;
    remove(id: string): Promise<void>;
    selectDirectory(): Promise<SelectDirectoryResult>;
    validatePath(projectPath: string): Promise<ValidatePathResult>;
  };
  workflows: {
    list(): Promise<WorkflowRun[]>;
    create(input: CreateWorkflowInput): Promise<WorkflowRun>;
    get(id: string): Promise<WorkflowRunDetail>;
    simulate(id: string): Promise<void>;
    runReal(id: string): Promise<void>;
    runRealAsync(id: string): Promise<{ jobId: string; workflowRunId: string }>;
    /**
     * Reexecuta uma missão a partir de um WorkflowRun existente, criando um
     * novo registro vinculado ao original (via `generatedContext` com
     * `kind: "rerun"` e `parentRunId`). Aceita overrides opcionais de
     * prompt, modo, estratégia e timeout.
     */
    rerun(workflowRunId: string, overrides?: WorkflowRerunInput): Promise<WorkflowRunJobResult>;
    getJob(jobId: string): Promise<BackgroundWorkflowJob | null>;
    listJobs(): Promise<BackgroundWorkflowJob[]>;
    cancelJob(jobId: string): Promise<void>;
    approveFinal(id: string): Promise<Approval>;
    rejectFinal(id: string, note?: string): Promise<Approval>;
    getStepOutputs(workflowRunId: string): Promise<AgentStepOutput[]>;
    listAgentOutputs(workflowRunId: string): Promise<AgentStepOutput[]>;
  };
  approvals: {
    listActionable(): Promise<Approval[]>;
    listPending(): Promise<Approval[]>;
    list(): Promise<Approval[]>;
    approve(id: string): Promise<Approval>;
    reject(id: string): Promise<Approval>;
  };
  agents: {
    list(): Promise<Agent[]>;
    create(input: CreateAgentInput): Promise<Agent>;
    update(id: string, input: UpdateAgentInput): Promise<Agent>;
    remove(id: string): Promise<void>;
  };
  models: {
    updateAgentModel(agentId: string, input: AgentModelSettingInput): Promise<Agent>;
  };
  voice: {
    createFromTranscript(input: string | { transcript: string; activeProject?: { id: string; name: string } | null; availableProjects?: Array<{ id: string; name: string }> }): Promise<VoiceContextResult>;
    transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult>;
    listRequests(): Promise<VoiceRequestRecord[]>;
    saveAudio(input: VoiceAudioRecord): Promise<{ audioPath: string }>;
    saveAudioBytes(voiceRequestId: string, bytes: ArrayBuffer | Uint8Array, mimeType: string, durationMs: number): Promise<{ audioPath: string }>;
    getAudioPath(voiceRequestId: string): Promise<string | null>;
    getAudioRetentionSettings(): Promise<AudioRetentionSettings>;
    updateAudioRetentionSettings(input: Partial<AudioRetentionSettings>): Promise<AudioRetentionSettings>;
    cleanupOldAudio(): Promise<{ deleted: number; freedBytes: number }>;
    getAudioStorageStats(): Promise<AudioStorageStats>;
    openAudioFolder(): Promise<void>;
    probeServer(): Promise<boolean>;
  };
  // ============================================================================
  // PR 005 — Barramento de eventos do FluxoraV1 (Tauri event system)
  // ============================================================================
  //
  // Os métodos `list`/`onWorkflowEvent`/`onJobUpdated`/`onApprovalChange`/
  // `onOpenCodeStdout`/`onOpenCodeStderr`/`onOpenCodeJsonEvent` são o legado
  // do mock do Electron, preservados para a UI existente. Eles só têm
  // emissores reais quando o Mission Engine estiver em produção.
  //
  // Os métodos `subscribe`/`on`/`listRecent`/`emitDiagnostic`/`clearRecent`/
  // `unsubscribe`/`off` formam a base real do barramento do FluxoraV1. Em
  // runtime Tauri, escutam o canal `fluxora-event` emitido pelo backend
  // Rust via `@tauri-apps/api/event`. Fora do runtime Tauri, voltam a
  // emitir localmente em memória, mantendo a UI funcional no modo
  // navegador/Vite dev.
  events: {
    /** Lista eventos de workflow armazenados (legado/mock). */
    list(workflowRunId?: string): Promise<WorkflowEvent[]>;
    /** Listener legado: eventos de workflow. Mock até o Mission Engine. */
    onWorkflowEvent(callback: (event: WorkflowEvent) => void): () => void;
    /** Listener legado: atualização de job. Mock até o Mission Engine. */
    onJobUpdated(callback: (job: BackgroundWorkflowJob) => void): () => void;
    /** Listener legado: mudança em aprovação. Mock até o Mission Engine. */
    onApprovalChange(callback: (approval: Approval) => void): () => void;
    /** Listener legado: stdout do OpenCode. Mock até o Mission Engine. */
    onOpenCodeStdout(callback: (payload: { workflowRunId: string; jobId?: string; chunk: string }) => void): () => void;
    /** Listener legado: stderr do OpenCode. Mock até o Mission Engine. */
    onOpenCodeStderr(callback: (payload: { workflowRunId: string; jobId?: string; chunk: string }) => void): () => void;
    /** Listener legado: json-event do OpenCode. Mock até o Mission Engine. */
    onOpenCodeJsonEvent(callback: (payload: { workflowRunId: string; jobId?: string; event: unknown }) => void): () => void;
    /** Assina o barramento real de eventos do FluxoraV1. */
    subscribe(callback: (event: FluxoraEvent) => void): () => void;
    /** Remove uma inscrição retornada por `subscribe`/`on`. */
    unsubscribe(unsub: () => void): void;
    /** Assina eventos do barramento real filtrando por `type` (ex.: "app/ready"). */
    on(type: string, callback: (event: FluxoraEvent) => void): () => void;
    /** Atalho para `unsubscribe`. */
    off(unsub: () => void): void;
    /** Lista os eventos recentes em memória no backend (ring buffer). */
    listRecent(options?: { limit?: number; type?: string }): Promise<FluxoraEvent[]>;
    /** Emite um evento de diagnóstico pelo backend e o devolve para o caller. */
    emitDiagnostic(input: {
      message: string;
      level?: FluxoraEventLevel;
      source?: FluxoraEventSource;
      projectId?: string;
      missionId?: string;
      agentId?: string;
      payload?: unknown;
    }): Promise<FluxoraEvent>;
    /** Limpa o ring buffer de eventos recentes. */
    clearRecent(): Promise<void>;
  };
  opencode: {
    detect(): Promise<OpenCodeDetection>;
    getSettings(): Promise<OpenCodeSettings>;
    updateSettings(input: Partial<OpenCodeSettings>): Promise<OpenCodeSettings>;
    getStatus(): Promise<OpenCodeStatus>;
    diagnostics: {
      run(input: OpenCodeDiagnosticInput): Promise<OpenCodeDiagnosticResult>;
      copyLastResult(): Promise<boolean>;
    };
    controlledExecution: {
      run(input: ControlledExecutionRunInput): Promise<ControlledExecutionRunJob>;
      getResult(jobId: string): Promise<ControlledExecutionRunResult | null>;
    };
    /** Retorna o catálogo completo (providers + modelos) vindo do OpenCode CLI. */
    getCatalog(): Promise<OpenCodeCatalogResult>;
    /** Retorna os modelos de um provider específico. */
    getModelsForProvider(providerId: string): Promise<OpenCodeModel[]>;
    /** Força refresh do catálogo (invalida o cache do backend). */
    refreshCatalog(): Promise<OpenCodeCatalogResult>;
  };
  git: {
    inspect(projectId: string): Promise<GitInspectionResult>;
    diff(projectId: string, filePath: string): Promise<string>;
    changedFiles(workflowRunId: string): Promise<ChangedFile[]>;
    fileDiff(workflowRunId: string, filePath: string): Promise<FileDiff | null>;
  };
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    getAudioProvider(): Promise<AudioProviderSettings>;
    setAudioProvider(input: Partial<AudioProviderSettings>): Promise<AudioProviderSettings>;
  };
  commands: {
    list(workflowRunId?: string): Promise<CommandRun[]>;
    get(id: string): Promise<CommandRun | null>;
  };
  agentSteps: {
    list(workflowRunId: string): Promise<AgentStepOutput[]>;
  };
  app: {
    getGitInfo(): Promise<{ branch: string; commit: string }>;
    getVersion(): Promise<string>;
  };
  whisperLocal: {
    listModels(): Promise<WhisperModelInfo[]>;
    downloadModel(modelId: string): Promise<WhisperModelInfo>;
    deleteModel(modelId: string): Promise<{ ok: boolean }>;
    validateInstall(): Promise<WhisperInstallStatus>;
    getDownloadProgress(modelId: string): Promise<WhisperDownloadProgress>;
    onDownloadProgress(callback: (payload: WhisperDownloadProgress) => void): () => void;
  };
  whisper: {
    detect(): Promise<{
      python: { available: boolean; version?: string; command?: string };
      pip: { available: boolean; version?: string; command?: string };
    }>;
    install(options?: { pipCommand?: string }): Promise<{ ok: boolean; error?: string }>;
    start(options?: { port?: number; command?: string; useBundled?: boolean }): Promise<
      { ok: boolean; port?: number; alreadyRunning?: boolean; error?: string; message?: string; usedBinary?: string }
    >;
    stop(): Promise<{ ok: boolean; alreadyStopped?: boolean }>;
    getLogs(): Promise<{ logs: string[] }>;
    onInstallProgress(callback: (payload: { phase: string; message: string; percent?: number }) => void): () => void;
    // Bundle (binário + modelo embedded, sem precisar de Python)
    bundleStatus(): Promise<{
      ok: boolean;
      bundleDir: string;
      binary: { installed: boolean; path?: string; sizeBytes?: number };
      model: { installed: boolean; path?: string; sizeBytes?: number; name?: string };
      ready: boolean;
      message: string;
      lastError?: string;
      error?: string;
    }>;
    bundleDownload(): Promise<{
      ok: boolean;
      bundleDir: string;
      binary: { installed: boolean; path?: string; sizeBytes?: number };
      model: { installed: boolean; path?: string; sizeBytes?: number; name?: string };
      ready: boolean;
      message: string;
      error?: string;
    }>;
    bundleRemove(): Promise<{ ok: boolean; error?: string }>;
    bundleInfo(): Promise<{
      bundleDir: string;
      binaryUrl: string;
      modelUrl: string;
      versions: { whisperCpp: string; model: string };
      binaryPath: string;
      modelPath: string;
    }>;
    onBundleProgress(callback: (payload: { phase: string; message: string; percent?: number; bytesDownloaded?: number; bytesTotal?: number }) => void): () => void;
  };
  env: {
    /** Retorna o valor de uma variável de ambiente, ou null se não existir. */
    get(key: string): string | null;
    /** Retorna true se a variável existe e tem valor não-vazio. */
    has(key: string): boolean;
  };
}

declare global {
  interface Window {
    fluxora: FluxoraAPI;
  }
}
