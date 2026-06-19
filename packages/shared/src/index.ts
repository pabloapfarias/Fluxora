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
/**
 * @deprecated Tipos legados da fase Electron. A PR 014
 * consolidou o Agent Engine real em `FluxoraAgentRole`
 * (`planner` | `developer` | `qa` | `finalizer` | `custom`).
 * O tipo `AgentRole` continua existindo por compatibilidade
 * com mocks e adaptadores legados, mas a UI ativa do FluxoraV1
 * não deve mais usar `backend-dev` / `frontend-dev` /
 * `mobile-dev` / `orchestrator` como agentes exigidos pela
 * missão. A readiness real (`MissionExecutionReadiness`) é a
 * única fonte de verdade.
 */
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
 *
 * @deprecated Legado — prefira `FluxoraAgentRole = "custom"`
 * (canônico novo do Agent Engine da PR 011) ao criar agentes
 * persistidos.
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

/**
 * @deprecated Legado da fase Electron. A PR 014 substituiu
 * esta função pela readiness real (`resolveExecutionReadiness`
 * no `shared` e `execution_resolver.rs` no backend). O
 * Agent Engine real sempre roda Planner / Developer / QA /
 * Finalizer, e o resultado desta função (`backend-dev` /
 * `frontend-dev` / `mobile-dev`) não é mais usado pela UI
 * ativa. Pode continuar sendo chamada em testes legados.
 */
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
 * @deprecated Legado da fase Electron. A PR 014 rebaixou a
 * recomendação por stack a papel decorativo — o Agent Engine
 * real sempre usa `FluxoraAgentRole = "developer"` (e
 * `planner` / `qa` / `finalizer`). Esta função existe apenas
 * para hints de foco no `MissionDiagnosticModal`.
 *
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

export function deriveProviderEngineGlobalDefault(
  providers: Array<Pick<AiProviderConfig, "id" | "defaultModel" | "enabled">>
): GlobalDefaultAgentModel {
  const fallback = providers.find(
    (provider) =>
      provider.enabled &&
      typeof provider.defaultModel === "string" &&
      provider.defaultModel.trim().length > 0
  );
  if (!fallback) {
    return { providerId: null, modelName: null };
  }
  return {
    providerId: fallback.id,
    modelName: fallback.defaultModel!.trim(),
  };
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
  globalDefault: GlobalDefaultAgentModel
): ResolvedAgentModel | null {
  if (agent.modelProviderId && agent.modelName) {
    return {
      providerId: agent.modelProviderId,
      providerName: agent.modelProviderId,
      modelName: agent.modelName,
      source: "agent",
    };
  }
  if (globalDefault.providerId && globalDefault.modelName) {
    return {
      providerId: globalDefault.providerId,
      providerName: globalDefault.providerId,
      modelName: globalDefault.modelName,
      source: "global-default",
    };
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
}

export function buildMissionPrecheck(input: MissionPrecheckInput): MissionPrecheck {
  const { intent, suggestedAgents = [], activeProject, agents } = input;
  const pipeline = resolveMissionPipeline(intent);
  const requirements = getMissionAgentRequirements(intent, suggestedAgents);
  const hasEnabledProvider = agents.some((a) => Boolean(a.modelProviderId && a.modelName));
  const missingRoles: AgentRole[] = [];
  const recommendations: MissionPrecheck["recommendations"] = [];
  const blockingReasons: string[] = [];

  if (!hasEnabledProvider) {
    blockingReasons.push("Nenhum provider real disponível no Provider Engine.");
  }

  for (const req of requirements) {
    const agent = agents.find((entry) => entry.role === req.role);
    if (!agent) {
      missingRoles.push(req.role);
      blockingReasons.push(`Papel sem agente cadastrado: ${formatAgentRoleLabel(req.role)}.`);
    } else if (!isAgentConfiguredForRealExecution(agent)) {
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
        ready: matched ? isAgentConfiguredForRealExecution(matched) : false,
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
  agent: Pick<Agent, "modelProviderId" | "modelName" | "enabled">
): boolean {
  if (!agent.enabled) return false;
  if (!agent.modelProviderId) return false;
  if (!agent.modelName || !agent.modelName.trim()) return false;
  return true;
}

export function isAgentReadyWithFallback(
  agent: Pick<Agent, "modelProviderId" | "modelName" | "enabled">,
  globalDefault?: GlobalDefaultAgentModel
): boolean {
  if (isAgentConfiguredForRealExecution(agent)) return true;
  if (!agent.enabled) return false;
  return Boolean(globalDefault?.providerId && globalDefault.modelName);
}

export function getAgentReadiness(
  agent: Pick<Agent, "id" | "modelProviderId" | "modelName" | "enabled">,
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
      reasons.push("Nenhum fallback real do Mission Engine está disponível.");
    }
  }
  if (!agent.modelName || !agent.modelName.trim()) {
    if (fallback) {
      reasons.push("Sem modelo próprio. Usará o modelo global padrão.");
    } else {
      reasons.push("Nenhum modelo selecionado.");
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
   * Quando fornecido, persiste no engine.
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
/**
 * Status ampliado pela PR 009 (mantém os valores legados
 * para a UI existente e adiciona `expired` e `cancelled`
 * para a superfície canônica nova em runtime Tauri).
 */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

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

// ============================================================================
// PR 014 — Fonte única de resolução de execução
// ============================================================================
//
// A PR 014 introduz o contrato canônico que conecta o Agent Engine
// real (`agents.json` com Planner / Developer / QA / Finalizer), o
// Provider Engine real (`providers.json`) e o Mission Engine em
// uma única fonte de verdade.
//
// Toda a UI (AgentsPage, diagnóstico da missão, banner global) e
// toda a execução (`missions_run`) passam a consumir
// `resolveExecutionReadiness(...)`. O backend Rust implementa a
// mesma lógica em `execution_resolver.rs` e expõe via comando
// Tauri `missions_get_readiness`. Quando a UI roda em runtime
// Tauri ela sempre prefere a resposta do backend; quando roda no
// navegador (Vite dev) cai no fallback TS abaixo, que produz
// resultados idênticos.

/** Resolved provider/model/state for a single real agent. */
export interface EffectiveExecutionAgent {
  agentId: string;
  name: string;
  role: FluxoraAgentRole;
  order: number;
  enabled: boolean;
  providerId?: string;
  providerName?: string;
  model?: string;
  /** True when the agent does not declare its own provider/model. */
  inheritsProvider: boolean;
  /** True when the agent does not declare its own model. */
  inheritsModel: boolean;
  /** Whether the agent can run without issues right now. */
  ready: boolean;
  /** Human-readable issues blocking execution. */
  issues: string[];
}

export interface MissionExecutionReadiness {
  projectId?: string;
  missionId?: string;
  defaultProviderId?: string;
  defaultProviderName?: string;
  defaultModel?: string;
  /** Effective agents for the next mission run (always 4 in this PR). */
  agents: EffectiveExecutionAgent[];
  /** `true` only when all 4 agents are `ready`. */
  ready: boolean;
  /** Human-readable issues blocking mission execution overall. */
  issues: string[];
  /** ISO 8601 — useful to spot stale readiness in the UI. */
  resolvedAt: string;
}

export interface ResolveExecutionReadinessInput {
  agents: AgentConfig[];
  providers: AiProviderConfig[];
  projectId?: string;
  missionId?: string;
  /** Override of the default provider (e.g. the user picking one in the UI). */
  providerId?: string;
  /** Override of the default model (e.g. the user picking one in the UI). */
  model?: string;
}

const REAL_DEFAULT_ROLES: FluxoraAgentRole[] = ["planner", "developer", "qa", "finalizer"];

function findAgentForRole(
  agents: AgentConfig[],
  role: FluxoraAgentRole
): AgentConfig | undefined {
  return agents.find((agent) => agent.role === role);
}

function findAgentById(agents: AgentConfig[], agentId: string): AgentConfig | undefined {
  return agents.find((agent) => agent.id === agentId);
}

function describeProvider(
  providerId: string | undefined,
  providers: AiProviderConfig[]
): { id: string | undefined; name: string | undefined } {
  if (!providerId) return { id: undefined, name: undefined };
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) return { id: providerId, name: providerId };
  return { id: provider.id, name: provider.name };
}

function effectiveAgent(
  agent: AgentConfig,
  fallbackProviderId: string | undefined,
  fallbackModel: string | undefined,
  providers: AiProviderConfig[]
): EffectiveExecutionAgent {
  const issues: string[] = [];
  const inheritsProvider = !agent.providerId;
  const inheritsModel = !agent.model;
  const effectiveProviderId = inheritsProvider ? fallbackProviderId : agent.providerId;
  const effectiveModel = inheritsModel ? fallbackModel : agent.model;
  const enabled = agent.status === "enabled";
  if (!enabled) {
    issues.push("Agente desabilitado. Habilite o agente para executar a missão.");
  }
  if (!effectiveProviderId) {
    issues.push(
      "Nenhum provider configurado. Cadastre um provider em Configurações > Providers."
    );
  } else {
    const provider = providers.find((entry) => entry.id === effectiveProviderId);
    if (!provider) {
      issues.push(`Provider '${effectiveProviderId}' não encontrado no Provider Engine.`);
    } else if (!provider.enabled) {
      issues.push(`Provider '${provider.name}' está desabilitado.`);
    } else if (!provider.defaultModel && inheritsModel) {
      issues.push(
        `Provider '${provider.name}' sem modelo padrão. Defina um modelo padrão para executar missões.`
      );
    }
  }
  if (!effectiveModel || !effectiveModel.trim()) {
    issues.push(
      fallbackModel
        ? "Modelo não resolvido a partir do provider padrão."
        : "Nenhum modelo selecionado para este agente."
    );
  }
  const providerMeta = describeProvider(effectiveProviderId, providers);
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    order: agent.order,
    enabled,
    providerId: providerMeta.id,
    providerName: providerMeta.name,
    model: effectiveModel,
    inheritsProvider,
    inheritsModel,
    ready: enabled && Boolean(providerMeta.id) && Boolean(effectiveModel && effectiveModel.trim()),
    issues,
  };
}

/**
 * Single source of truth used by AgentsPage, mission diagnostic and
 * Mission Engine. Restores the 4 real default agents if `agents` is
 * empty, then resolves provider/model for each agent.
 */
export function resolveExecutionReadiness(
  input: ResolveExecutionReadinessInput
): MissionExecutionReadiness {
  const { agents, providers } = input;
  const explicitProviderId = input.providerId?.trim() || undefined;
  const explicitModel = input.model?.trim() || undefined;

  // Resolve fallback real provider/model from `providers.json`.
  const enabledProvider = providers.find((provider) => provider.enabled);
  const fallbackProviderId =
    explicitProviderId ||
    enabledProvider?.id;
  const fallbackProvider = fallbackProviderId
    ? providers.find((provider) => provider.id === fallbackProviderId)
    : undefined;
  const fallbackModel =
    explicitModel ||
    fallbackProvider?.defaultModel?.trim() ||
    undefined;

  const overallIssues: string[] = [];
  if (!fallbackProviderId) {
    overallIssues.push(
      "Nenhum provider configurado. Cadastre um provider em Configurações > Providers."
    );
  } else if (!fallbackProvider) {
    overallIssues.push(`Provider '${fallbackProviderId}' não encontrado no Provider Engine.`);
  } else if (!fallbackProvider.enabled) {
    overallIssues.push(`Provider '${fallbackProvider.name}' está desabilitado.`);
  } else if (!fallbackModel) {
    overallIssues.push(
      `Provider '${fallbackProvider.name}' sem modelo padrão. Defina um modelo padrão para executar missões.`
    );
  }

  // Build the agent list. If empty, the backend will create the
  // 4 defaults — but here we expose the resolved shape regardless.
  const orderedAgents: AgentConfig[] = [...agents].sort((a, b) => a.order - b.order);
  const resolvedAgents: EffectiveExecutionAgent[] = [];
  const missingRoles: FluxoraAgentRole[] = [];

  for (const role of REAL_DEFAULT_ROLES) {
    const matched = findAgentForRole(orderedAgents, role);
    if (matched) {
      resolvedAgents.push(
        effectiveAgent(matched, fallbackProviderId, fallbackModel, providers)
      );
    } else {
      missingRoles.push(role);
    }
  }
  // Surface any extra agents (custom) so they are visible too.
  for (const agent of orderedAgents) {
    if (REAL_DEFAULT_ROLES.includes(agent.role)) continue;
    if (!agent.id) continue;
    resolvedAgents.push(
      effectiveAgent(agent, fallbackProviderId, fallbackModel, providers)
    );
  }

  for (const role of missingRoles) {
    overallIssues.push(
      `Agente real ausente: ${role}. Restaure os agentes padrão na tela de Agentes.`
    );
  }

  const allAgentsReady = resolvedAgents.length > 0 && resolvedAgents.every((agent) => agent.ready);
  const ready = allAgentsReady && missingRoles.length === 0 && overallIssues.length === 0;

  return {
    projectId: input.projectId,
    missionId: input.missionId,
    defaultProviderId: fallbackProviderId,
    defaultProviderName: fallbackProvider?.name,
    defaultModel: fallbackModel,
    agents: resolvedAgents,
    ready,
    issues: overallIssues,
    resolvedAt: new Date().toISOString(),
  };
}

// ============================================================================
// PR 011 — Agent Engine próprio (Planner / Developer / QA / Finalizer)
// ============================================================================
//
// Esta PR introduz uma camada real de agentes no backend Tauri/Rust.
// Substitui os `AgentStepOutput` sintéticos (derivados dos logs pelo
// `buildSyntheticSteps` da PR 008) por steps reais persistidos em
// `<app_data_dir>/fluxora/agent_steps.json`.
//
// Os tipos legados (`Agent` / `MultiAgentRole` / `AgentStepOutput` /
// `AgentStepStatus` / `agentSteps.list`) continuam existindo para
// preservar a UI atual — o `desktopBridge` faz a ponte entre a nova
// superfície canônica e a forma legada consumida pelo
// `AgentStepOutputPanel`, `ExecutionDetailPage` e `useUsageStats`.

/** Papéis canônicos de agente no Agent Engine da PR 011. */
export type FluxoraAgentRole =
  | "planner"
  | "developer"
  | "qa"
  | "finalizer"
  | "custom";

/** Status (habilitado / desabilitado) de um agente configurado. */
export type FluxoraAgentStatus = "enabled" | "disabled";

/** Status do ciclo de vida de um `AgentStepRecord` (canônico novo). */
export type FluxoraAgentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/**
 * Configuração persistida de um agente (canônico novo, PR 011).
 * Diferente do tipo legado `Agent` (voltado para Electron): este é
 * mais simples, focado em definir o papel, o system prompt e o
 * par `providerId`/`model` opcional que sobrescreve o da missão.
 */
export interface AgentConfig {
  id: string;
  name: string;
  role: FluxoraAgentRole;
  description?: string;
  /** Provider opcional dedicado ao agente. Quando ausente, herda da missão. */
  providerId?: string;
  /** Modelo opcional dedicado ao agente. Quando ausente, herda da missão. */
  model?: string;
  status: FluxoraAgentStatus;
  /** System prompt interno seguro (não editável pelo usuário nesta PR). */
  systemPrompt?: string;
  /** Ordem de execução no pipeline (0=primeiro). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** Input aceito por `agents_create` (canônico novo). */
export interface CreateAgentConfigInput {
  name: string;
  role: FluxoraAgentRole;
  description?: string;
  providerId?: string;
  model?: string;
  status?: FluxoraAgentStatus;
  systemPrompt?: string;
  order?: number;
}

/** Input aceito por `agents_update` (canônico novo). */
export interface UpdateAgentConfigInput {
  name?: string;
  description?: string;
  providerId?: string;
  model?: string;
  status?: FluxoraAgentStatus;
  systemPrompt?: string;
  order?: number;
}

/**
 * Step real de um agente (canônico novo, PR 011). Persistido em
 * `<app_data_dir>/fluxora/agent_steps.json`. Diferente do
 * `AgentStepOutput` legado (voltado ao mock do Electron), este é
 * produzido e persistido pelo backend Rust.
 */
export interface AgentStepRecord {
  id: string;
  missionId: string;
  projectId: string;
  agentId: string;
  agentName: string;
  role: FluxoraAgentRole;
  status: FluxoraAgentStepStatus;
  /** Resumo curto do input enviado ao agente (truncado, sem chain-of-thought). */
  inputSummary?: string;
  /** Resumo curto do output do agente (truncado). */
  outputSummary?: string;
  /** Output completo retornado pelo provider (truncado em 256 KiB). */
  outputText?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  /** Metadados opcionais (ex.: `proposalId` quando o Developer gera patch). */
  metadata?: unknown;
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
// Execution mode, background jobs, commands, files
// ============================================================================

export type WorkflowExecutionMode = "simulated" | "real";

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

// ============================================================================
// PR 007 — Provider Engine próprio
// ============================================================================
//
// Tipos do motor de providers do FluxoraV1. Substitui o antigo adaptador
// externo como intermediário para chamadas a provedores de IA.
// Este bloco define a superfície canônica (`AiProviderConfig`,
// `AiModelInfo`, etc.) do Provider Engine.

/** Tipos de provider reconhecidos pelo Provider Engine. */
export type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "deepseek"
  | "minimax"
  | "local"
  | "custom";

/** Estados possíveis de um provider configurado. */
export type ProviderStatus =
  | "configured"
  | "missing-api-key"
  | "invalid"
  | "unreachable"
  | "disabled";

/** Capacidades suportadas por um provider/modelo. */
export interface ProviderCapabilities {
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsAudio?: boolean;
}

/** Configuração persistida de um provider no Provider Engine. */
export interface AiProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  /** URL base do endpoint. Para OpenAI-compatible: ex. https://api.openai.com/v1 */
  baseUrl?: string;
  /**
   * Nome de variável de ambiente (`OPENAI_API_KEY`) ou chave literal.
   * Por compatibilidade com a PR 006, ambos formatos são aceitos.
   * Não é exposto em eventos nem logs.
   */
  apiKeyEnv?: string;
  /** Modelo padrão sugerido para o provider. */
  defaultModel?: string;
  enabled: boolean;
  capabilities?: ProviderCapabilities;
  createdAt: string;
  updatedAt: string;
}

/** Modelo exposto por um provider (ex.: "gpt-4o-mini"). */
export interface AiModelInfo {
  id: string;
  providerId: string;
  name: string;
  displayName?: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsAudio?: boolean;
}

/** Resultado de `providers_test`. */
export interface ProviderTestResult {
  ok: boolean;
  providerId?: string;
  status: ProviderStatus;
  message?: string;
  durationMs?: number;
  models?: AiModelInfo[];
}

/** Mensagem de chat (papel + conteúdo). */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Request para `providers_chat_once` (fundação técnica; o chat real fica para o Mission Engine). */
export interface ChatOnceRequest {
  providerId: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/** Response de `providers_chat_once`. */
export interface ChatOnceResult {
  text: string;
  model?: string;
  providerId: string;
  durationMs: number;
  usage?: unknown;
}

// ============================================================================
// PR 012 — Streaming de providers
// ============================================================================
//
// Esta camada adiciona streaming OpenAI-compatible ao Provider
// Engine. O backend emite `provider/stream-*` no barramento
// `fluxora-event` e o Agent Engine emite `agent/step-chunk`
// para chunks incrementais por agente. O frontend expõe
// `window.fluxora.providers.chatStream` para testes manuais.
//
// **Esta PR NÃO implementa tool calling, execução de comandos
// ou cancelamento real de streams.** O fallback não-streaming
// (`chatOnce`) continua disponível para providers que não
// suportam `stream: true`.

/** Tipos canônicos para o ciclo de vida de um stream. */
export type ProviderStreamEventType =
  | "provider/stream-started"
  | "provider/stream-chunk"
  | "provider/stream-completed"
  | "provider/stream-failed";

/** Tipos canônicos para chunks incrementais por agente. */
export type AgentStreamEventType = "agent/step-chunk";

/** Request para `providers_chat_stream` (streaming OpenAI-compatible). */
export interface ChatStreamRequest {
  providerId: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Chunk incremental emitido por `provider/stream-chunk` no
 * barramento. Nunca inclui API key, prompt completo ou
 * `messages` completas — apenas o `delta` de saída do modelo
 * e metadados de progresso.
 */
export interface ProviderStreamChunk {
  requestId: string;
  providerId: string;
  providerName?: string;
  model?: string;
  /** Índice sequencial do chunk (0-based). */
  index: number;
  /** Texto incremental produzido pelo modelo neste chunk. */
  delta: string;
  /** Tamanho acumulado (em chars) do stream até este chunk. */
  accumulatedLength: number;
  /** `true` quando o provider sinalizou fim do stream. */
  done: boolean;
  /** ISO 8601 do momento da emissão. */
  createdAt: string;
}

/** Resultado final de `providers_chat_stream` (retornado ao caller). */
export interface ProviderStreamResult {
  requestId: string;
  providerId: string;
  providerName?: string;
  model?: string;
  text: string;
  durationMs: number;
  chunks: number;
  usage?: unknown;
}

/** Payload de `agent/step-chunk` no barramento (PR 012). */
export interface AgentStepChunkPayload {
  stepId: string;
  missionId: string;
  projectId: string;
  agentId: string;
  agentName: string;
  role: FluxoraAgentRole;
  /** Índice sequencial do chunk do step (0-based). */
  chunkIndex: number;
  /** Texto incremental do modelo neste chunk. */
  delta: string;
  accumulatedLength: number;
}

/** Payload discriminado dos eventos `provider/*` no barramento. */
export type ProviderEventType =
  | "provider/test-started"
  | "provider/test-completed"
  | "provider/test-failed"
  | "provider/models-loaded"
  | "provider/request-started"
  | "provider/request-completed"
  | "provider/request-failed"
  | "provider/stream-started"
  | "provider/stream-chunk"
  | "provider/stream-completed"
  | "provider/stream-failed"
  | "provider/settings-updated"
  | "provider/created"
  | "provider/updated"
  | "provider/removed";

export interface ProviderEventBase {
  kind: ProviderEventType;
  providerId?: string;
  providerName?: string;
  kind2?: ProviderKind;
}

export interface ProviderTestStartedPayload extends ProviderEventBase {
  kind: "provider/test-started";
}

export interface ProviderTestCompletedPayload extends ProviderEventBase {
  kind: "provider/test-completed";
  ok: boolean;
  durationMs: number;
  modelsCount?: number;
  status: ProviderStatus;
}

export interface ProviderTestFailedPayload extends ProviderEventBase {
  kind: "provider/test-failed";
  durationMs: number;
  errorCode: string;
  errorMessage: string;
}

export interface ProviderModelsLoadedPayload extends ProviderEventBase {
  kind: "provider/models-loaded";
  modelsCount: number;
  durationMs: number;
}

export interface ProviderRequestStartedPayload extends ProviderEventBase {
  kind: "provider/request-started";
  model?: string;
  messageCount: number;
}

export interface ProviderRequestCompletedPayload extends ProviderEventBase {
  kind: "provider/request-completed";
  model?: string;
  durationMs: number;
  textLength: number;
}

export interface ProviderRequestFailedPayload extends ProviderEventBase {
  kind: "provider/request-failed";
  model?: string;
  durationMs: number;
  errorCode: string;
  errorMessage: string;
}

export interface ProviderSettingsUpdatedPayload extends ProviderEventBase {
  kind: "provider/settings-updated";
}

export interface ProviderCreatedPayload extends ProviderEventBase {
  kind: "provider/created";
}

export interface ProviderUpdatedPayload extends ProviderEventBase {
  kind: "provider/updated";
}

export interface ProviderRemovedPayload extends ProviderEventBase {
  kind: "provider/removed";
}

export type ProviderEventPayload =
  | ProviderTestStartedPayload
  | ProviderTestCompletedPayload
  | ProviderTestFailedPayload
  | ProviderModelsLoadedPayload
  | ProviderRequestStartedPayload
  | ProviderRequestCompletedPayload
  | ProviderRequestFailedPayload
  | ProviderSettingsUpdatedPayload
  | ProviderCreatedPayload
  | ProviderUpdatedPayload
  | ProviderRemovedPayload;

// ============================================================================
// PR 008 — Mission Engine inicial
// ============================================================================
//
// Define o vocabulário novo para missões no FluxoraV1. A UI
// atual ainda consome `WorkflowRun` / `WorkflowEvent` (legado
// do mock) e o `desktopBridge` faz a adaptação entre as duas
// superfícies. Componentes novos podem usar `MissionRun` /
// `MissionLog` diretamente via `window.fluxora.missions.*`.

/** Estados possíveis de uma missão em runtime. */
export type MissionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Fases observáveis do Mission Engine durante a execução. */
export type MissionPhase =
  | "created"
  | "context"
  | "planning"
  | "provider-call"
  | "response"
  | "final-report"
  | "failed"
  | "patch-detected"
  | "patch-pending-approval"
  | "patch-applied"
  | "patch-failed";

/** Modo de execução da missão. */
export type MissionMode = "assistido" | "propositivo" | "piloto-automatico";

/** Modelo de missão persistido no backend. */
export interface MissionRun {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: MissionStatus;
  mode: MissionMode;
  providerId?: string;
  model?: string;
  currentPhase?: MissionPhase;
  resultText?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Linha de log/fase persistida para uma missão. */
export interface MissionLog {
  id: string;
  missionId: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  phase?: MissionPhase;
  payload?: unknown;
}

/** Input aceito por `missions_create` / `missions_create_and_run`. */
export interface CreateMissionInput {
  projectId: string;
  prompt: string;
  title?: string;
  providerId?: string;
  model?: string;
  mode?: MissionMode;
}

/** Input aceito por `missions_run`. */
export interface RunMissionInput {
  missionId: string;
}

// ============================================================================
// PR 009 — Piloto automático com permissões por projeto
// ============================================================================
//
// Esta camada adiciona:
// - Modos de execução por missão (já introduzidos como `MissionMode`).
// - Política de execução por projeto, com decisões `allow`/`ask`/`deny`.
// - Sistema de aprovações operacionais com persistência local.
// - Fila/scheduler mínima para missões (em memória nesta PR).
// - Integração entre Mission Engine, permissões e aprovações.
//
// O piloto automático, nesta PR, significa executar missões
// respeitando a política do projeto. A aplicação de patch/diff,
// comandos shell, Git write operations e tool calling continuam
// fora de escopo (ficam para a PR 010 e seguintes).

/** Modo de execução da missão (alias semântico de `MissionMode`). */
export type ExecutionMode = MissionMode;

/** Decisão de uma permissão individual dentro de uma `ProjectExecutionPolicy`. */
export type PermissionDecision = "allow" | "ask" | "deny";

/** Ações controladas pela política de execução do projeto. */
export type PermissionAction =
  | "read-files"
  | "write-files"
  | "create-files"
  | "delete-files"
  | "move-files"
  | "run-commands"
  | "install-dependencies"
  | "git-read"
  | "git-write"
  | "network-provider"
  | "apply-patch"
  | "commit"
  | "push";

/** Conjunto canônico de ações para iteração / UI. */
export const PERMISSION_ACTIONS: PermissionAction[] = [
  "read-files",
  "write-files",
  "create-files",
  "delete-files",
  "move-files",
  "run-commands",
  "install-dependencies",
  "git-read",
  "git-write",
  "network-provider",
  "apply-patch",
  "commit",
  "push",
];

/** Política padrão conservadora (piloto automático desativado). */
export const DEFAULT_PERMISSION_DECISIONS: Record<PermissionAction, PermissionDecision> = {
  "read-files": "allow",
  "git-read": "allow",
  "network-provider": "allow",
  "write-files": "ask",
  "create-files": "ask",
  "delete-files": "deny",
  "move-files": "ask",
  "run-commands": "ask",
  "install-dependencies": "ask",
  "git-write": "deny",
  "apply-patch": "ask",
  "commit": "deny",
  "push": "deny",
};

/**
 * Política de execução por projeto. Controla como o Mission Engine
 * e a UI devem se comportar diante de ações que tocam o projeto
 * (ler arquivos, escrever, rodar comandos, chamar provider etc.).
 *
 * Persistida em `<app_data_dir>/fluxora/permissions.json` pela
 * PR 009. Defaults conservadores; `autopilotEnabled: false` por
 * padrão para evitar execução automática sem opt-in explícito.
 */
export interface ProjectExecutionPolicy {
  projectId: string;
  defaultMode: ExecutionMode;
  permissions: Record<PermissionAction, PermissionDecision>;
  autopilotEnabled: boolean;
  requireApprovalForHighRisk: boolean;
  maxAutopilotSteps?: number;
  createdAt: string;
  updatedAt: string;
}

/** Resultado da checagem de uma `PermissionAction` para um projeto. */
export interface PermissionCheckResult {
  action: PermissionAction;
  decision: PermissionDecision;
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  reason?: string;
}

/**
 * Status ampliado de uma `ExecutionApproval`. O legado
 * `ApprovalStatus` ("pending" | "approved" | "rejected" |
 * "expired" | "cancelled") é compartilhado entre o legado e a
 * superfície canônica nova.
 */

/** Nível de risco de uma `ExecutionApproval`. */
export type ApprovalRisk = "low" | "medium" | "high";

/**
 * Aprovação operacional (canônica nova, PR 009). Inclui
 * `action`, `risk`, `payload` e `missionId` para ligar a
 * aprovação à missão/projeto que a originou.
 *
 * O `desktopBridge` converte `ExecutionApproval` para o
 * tipo legado `Approval` (sem `action`/`risk`/`payload`/
 * `missionId`/`requestedBy`) ao expor `approvals.*` para a
 * UI existente, preservando compatibilidade total.
 */
export interface ExecutionApproval {
  id: string;
  projectId?: string;
  missionId?: string;
  action: PermissionAction;
  title: string;
  description: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  requestedBy?: string;
  payload?: unknown;
}

/** Input aceito por `approvals_create`. */
export interface CreateApprovalInput {
  projectId?: string;
  missionId?: string;
  action: PermissionAction;
  title: string;
  description: string;
  risk: ApprovalRisk;
  requestedBy?: string;
  payload?: unknown;
}

/** Input aceito por `permissions_update_project_policy`. */
export interface UpdateProjectPolicyInput {
  defaultMode?: ExecutionMode;
  permissions?: Partial<Record<PermissionAction, PermissionDecision>>;
  autopilotEnabled?: boolean;
  requireApprovalForHighRisk?: boolean;
  maxAutopilotSteps?: number;
}

/**
 * Estado observável de um job de missão no scheduler/fila
 * básico da PR 009. Mantido em memória (não persistido
 * nesta PR; a `MissionRun` correspondente em `missions.json`
 * carrega o estado durável).
 */
export interface MissionJob {
  id: string;
  missionId: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  mode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Input aceito por `scheduler_cancel_job`. */
export interface CancelMissionJobInput {
  jobId: string;
  reason?: string;
}

// ============================================================================
// PR 010 — Aplicação controlada de patch/diff
// ============================================================================
//
// Esta camada adiciona o Patch Engine do FluxoraV1. Permite que
// missões proponham alterações em formato estruturado
// (bloco `fluxora_patch` na resposta do provider) e que essas
// alterações sejam aplicadas de forma controlada, respeitando
// a política do projeto e exigindo aprovação explícita quando
// a decisão da permissão for `ask`.
//
// O patch nunca é aplicado sem:
// 1. `apply-patch` / `write-files` / `create-files` /
//    `delete-files` serem permitidos pela política do projeto
//    (ou aprovados via `ExecutionApproval`).
// 2. Path do arquivo ser relativo, não conter `..` e não estar
//    em diretórios proibidos (`.git`, `node_modules`, `dist`,
//    `target`, etc.).
// 3. Limites de tamanho respeitados (256 KiB por arquivo,
//    1 MiB total, 20 arquivos por proposta).
//
// Esta PR NÃO faz commit, push, checkout, reset, merge, rebase
// ou qualquer operação destrutiva fora do diretório do projeto.
// A aplicação de patch é estritamente controlada e sempre
// registrada em eventos `patch/*` no barramento
// `fluxora-event`.

/** Tipo de operação de patch sobre um arquivo. */
export type PatchOperation = "create" | "modify" | "delete";

/** Status do ciclo de vida de uma `PatchProposal`. */
export type PatchProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "applied"
  | "rejected"
  | "failed";

/** Mudança proposta para um único arquivo dentro de uma `PatchProposal`. */
export interface PatchFileChange {
  path: string;
  operation: PatchOperation;
  /**
   * Conteúdo antes da alteração (snapshot do arquivo no momento
   * em que a proposta foi criada). Usado para validar que o
   * arquivo ainda está no estado esperado antes de aplicar o
   * `afterContent`. Opcional — quando ausente, o backend não
   * faz a checagem de pré-condição.
   */
  beforeContent?: string;
  /**
   * Conteúdo final desejado para o arquivo. Obrigatório para
   * `create` e `modify`. Não deve ser enviado para `delete`.
   */
  afterContent?: string;
  /**
   * Diff unificado opcional gerado pelo provider ou pelo
   * backend para exibição na UI. Quando ausente, o backend
   * calcula a partir de `beforeContent` / `afterContent`.
   */
  unifiedDiff?: string;
  /** Linhas adicionadas estimadas. Preenchido pelo backend se ausente. */
  additions?: number;
  /** Linhas removidas estimadas. Preenchido pelo backend se ausente. */
  deletions?: number;
  /** Conveniência derivada: `operation === "create"`. Preenchido pelo backend. */
  isNewFile?: boolean;
  /** Conveniência derivada: `operation === "delete"`. Preenchido pelo backend. */
  isDeletedFile?: boolean;
}

/** Proposta de patch vinculada a uma missão. */
export interface PatchProposal {
  id: string;
  missionId: string;
  projectId: string;
  status: PatchProposalStatus;
  title: string;
  summary?: string;
  files: PatchFileChange[];
  /** `ExecutionApproval` vinculada (quando status é `pending_approval`). */
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  /** Mensagem de erro quando `status === "failed"`. Nunca inclui API key. */
  error?: string;
}

/** Input aceito por `patches_create` (criação de proposta). */
export interface CreatePatchProposalInput {
  missionId: string;
  projectId: string;
  title: string;
  summary?: string;
  files: PatchFileChange[];
}

/** Input aceito por `patches_apply` (aplicação da proposta). */
export interface ApplyPatchInput {
  proposalId: string;
  /** `ExecutionApproval` aprovada que autorizou a aplicação. */
  approvalId?: string;
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
    /**
     * PR 010 — Aprova a aprovação final vinculada à missão
     * (`apply-patch` ou similar) e, se houver proposta de patch
     * pendente, dispara a aplicação segura. Em runtime Tauri
     * delega para `patches_apply` + `approvals_approve`; fora,
     * cai no mock legado (sem patch aplicado).
     */
    approveFinal(id: string): Promise<Approval>;
    /**
     * PR 010 — Rejeita a aprovação final vinculada à missão e
     * marca a proposta de patch como `rejected`. Em runtime
     * Tauri delega para `patches_reject` + `approvals_reject`;
     * fora, cai no mock legado.
     */
    rejectFinal(id: string, note?: string): Promise<Approval>;
    getStepOutputs(workflowRunId: string): Promise<AgentStepOutput[]>;
    listAgentOutputs(workflowRunId: string): Promise<AgentStepOutput[]>;
  };
  // ============================================================================
  // PR 008 — Mission Engine próprio (superfície canônica nova)
  // ============================================================================
  //
  // Esta superfície coexiste com `workflows.*` (legado). O
  // `desktopBridge` faz a adaptação: chamadas `workflows.create` /
  // `workflows.list` / `workflows.get` / `workflows.simulate` /
  // `workflows.runReal` / `workflows.runRealAsync` / `workflows.rerun`
  // são redirecionadas para os comandos `missions_*` quando em
  // runtime Tauri, convertendo os tipos conforme necessário. Os
  // métodos `workflows.approveFinal` / `rejectFinal` passam a
  // ser reais em runtime Tauri na PR 010 (aprovam/rejeitam
  // propostas de patch e disparam aplicação controlada).
  //
  // Componentes novos podem consumir `window.fluxora.missions.*`
  // diretamente para evitar a camada de adaptação.
  missions: {
    /** Health-check do Mission Engine. */
    ping(): Promise<string>;
    /** Lista missões persistidas (mais recentes primeiro). */
    list(): Promise<MissionRun[]>;
    /** Retorna uma missão por `id` (ou `null` se não existir). */
    get(missionId: string): Promise<MissionRun | null>;
    /** Cria uma missão (status inicial: "queued"). */
    create(input: CreateMissionInput): Promise<MissionRun>;
    /** Executa uma missão já criada. Atualiza o status persistido. */
    run(input: RunMissionInput): Promise<MissionRun>;
    /** Cria e executa uma missão em uma única chamada. */
    createAndRun(input: CreateMissionInput): Promise<MissionRun>;
    /** Lista logs/fases de uma missão (ordenados por timestamp crescente). */
    listLogs(missionId: string): Promise<MissionLog[]>;
    /** Limpa o arquivo de missões (apenas dev/debug). */
    clear(): Promise<void>;
    /**
     * PR 014 — Retorna a readiness agregada da missão
     * (defaultProviderId, defaultModel, agents efetivos,
     * issues). Usa a mesma fonte de verdade do `missions_run`
     * (Agent Engine + Provider Engine reais). No fallback
     * browser, computa localmente via `resolveExecutionReadiness`.
     */
    getReadiness(input?: {
      projectId?: string;
      missionId?: string;
      providerId?: string;
      model?: string;
    }): Promise<MissionExecutionReadiness>;
  };
  approvals: {
    listActionable(): Promise<Approval[]>;
    listPending(): Promise<Approval[]>;
    list(): Promise<Approval[]>;
    approve(id: string): Promise<Approval>;
    reject(id: string): Promise<Approval>;
    /**
     * PR 009 — Cancela uma aprovação pendente. Devolve
     * `null` quando a aprovação não está em estado
     * pendente. Em runtime Tauri, delega para
     * `approvals_cancel` (canônico novo); fora, devolve
     * `null` (sem cancelamento no mock legado).
     */
    cancel(id: string): Promise<Approval | null>;
  };
  // ============================================================================
  // PR 009 — Piloto automático: permissões, scheduler e aprovações operacionais
  // ============================================================================
  //
  // Superfícies canônicas novas expostas em runtime Tauri. O
  // `desktopBridge` é quem decide se delega para o backend Rust
  // (em runtime Tauri) ou cai no fallback do `mock-api.ts` (no
  // navegador/Vite dev).
  //
  // O `approvals.*` legado acima continua sendo a fonte que a
  // UI atual consome; a forma canônica nova
  // `ExecutionApproval` é exposta via `approvals.*` apenas
  // através do `desktopBridge` (que converte). O canônico
  // adicional para permissões é `permissions.*`.
  permissions: {
    /** Health-check do Permissions Engine. */
    ping(): Promise<string>;
    /** Retorna a política de um projeto (cria a default se não existir). */
    getProjectPolicy(projectId: string): Promise<ProjectExecutionPolicy>;
    /** Atualiza (merge) a política de um projeto. */
    updateProjectPolicy(
      projectId: string,
      input: UpdateProjectPolicyInput
    ): Promise<ProjectExecutionPolicy>;
    /** Lista todas as políticas persistidas. */
    listPolicies(): Promise<ProjectExecutionPolicy[]>;
    /** Reseta a política de um projeto para a default. */
    resetProjectPolicy(projectId: string): Promise<ProjectExecutionPolicy>;
    /**
     * Avalia uma `PermissionAction` para um projeto (e missão
     * opcional). Cria automaticamente uma `ExecutionApproval`
     * pendente quando a decisão for `ask`. Em runtime Tauri,
     * dispara os eventos `permission/check` /
     * `permission/allowed` / `permission/denied` /
     * `permission/approval-required` no barramento.
     */
    check(input: {
      projectId: string;
      action: PermissionAction;
      missionId?: string;
    }): Promise<PermissionCheckResult>;
  };
  scheduler: {
    /** Health-check do scheduler. */
    ping(): Promise<string>;
    /** Lista todos os jobs de missões conhecidos. */
    listJobs(): Promise<MissionJob[]>;
    /** Retorna um job por `id` (ou `null` se não existir). */
    getJob(jobId: string): Promise<MissionJob | null>;
    /**
     * Tenta cancelar um job. Se a missão já estiver em
     * `running`, a ação fica pendente de finalização
     * (missões são síncronas nesta PR). Se estiver
     * `queued`, o job transita para `cancelled` antes de
     * `missions_run` ser chamado.
     */
    cancelJob(input: CancelMissionJobInput): Promise<MissionJob | null>;
  };
  // ============================================================================
  // PR 010 — Patch Engine próprio
  // ============================================================================
  //
  // Superfície canônica nova para propostas de patch em runtime
  // Tauri. O `desktopBridge` decide se delega para o backend
  // Rust (em runtime Tauri) ou cai no fallback do `mock-api.ts`
  // (no navegador/Vite dev).
  //
  // Os métodos `git.changedFiles(workflowRunId)` e
  // `git.fileDiff(workflowRunId, filePath)` da UI atual
  // continuam sendo a forma consumida pelo Diff Viewer — o
  // `desktopBridge` faz a ponte para o Patch Engine em runtime
  // Tauri. Componentes novos podem usar `patches.*`
  // diretamente para evitar a camada de adaptação.
  patches: {
    /** Health-check do Patch Engine. */
    ping(): Promise<string>;
    /** Lista todas as propostas de patch persistidas (mais recentes primeiro). */
    list(): Promise<PatchProposal[]>;
    /** Retorna uma proposta de patch por `id` (ou `null` se não existir). */
    get(proposalId: string): Promise<PatchProposal | null>;
    /** Lista todas as propostas de patch de uma missão (mais recentes primeiro). */
    listByMission(missionId: string): Promise<PatchProposal[]>;
    /** Cria uma nova proposta de patch (status inicial: `draft` ou `pending_approval`). */
    create(input: CreatePatchProposalInput): Promise<PatchProposal>;
    /**
     * Aplica uma proposta de patch. Exige que a política do
     * projeto permita `apply-patch` / `write-files` /
     * `create-files` / `delete-files` (conforme cada operação)
     * OU que uma `ExecutionApproval` aprovada tenha autorizado
     * a ação. Aplica cada arquivo de forma atômica quando
     * possível; em caso de erro em um arquivo, marca a
     * proposta como `failed` e emite `patch/apply-failed`.
     */
    apply(input: ApplyPatchInput): Promise<PatchProposal>;
    /** Rejeita (cancela) uma proposta de patch pendente. Marca como `rejected`. */
    reject(proposalId: string, note?: string): Promise<PatchProposal>;
    /**
     * Equivalente a `git.changedFiles(workflowRunId)` no Patch
     * Engine. Converte os `PatchFileChange` da proposta em
     * `ChangedFile` legados consumidos pelo Diff Viewer.
     */
    getChangedFiles(workflowRunId: string): Promise<ChangedFile[]>;
    /**
     * Equivalente a `git.fileDiff(workflowRunId, filePath)` no
     * Patch Engine. Devolve um `FileDiff` legado com `diff`,
     * `additions` / `deletions` calculados, e o status
     * (`added` / `modified` / `deleted`).
     */
    getFileDiff(workflowRunId: string, filePath: string): Promise<FileDiff | null>;
  };
  agents: {
    list(): Promise<Agent[]>;
    create(input: CreateAgentInput): Promise<Agent>;
    update(id: string, input: UpdateAgentInput): Promise<Agent>;
    remove(id: string): Promise<void>;
    /**
     * PR 011 — Lista as configurações persistidas de agentes no
     * backend real (Planner / Developer / QA / Finalizer).
     * Em runtime Tauri, delega para `agents_list` no
     * `agents.rs`; fora, devolve `[]` (não há agentes reais
     * configurados no mock legado).
     */
    listConfigs(): Promise<AgentConfig[]>;
    /**
     * PR 011 — Retorna a configuração persistida de um agente
     * por `id`, ou `null` se não existir.
     */
    getConfig(id: string): Promise<AgentConfig | null>;
    /**
     * PR 011 — Cria (ou substitui) a configuração de um agente.
     */
    createConfig(input: CreateAgentConfigInput): Promise<AgentConfig>;
    /**
     * PR 011 — Atualiza a configuração de um agente existente.
     */
    updateConfig(
      id: string,
      input: UpdateAgentConfigInput
    ): Promise<AgentConfig>;
    /**
     * PR 011 — Recria os 4 agentes padrão (Planner / Developer /
     * QA / Finalizer) caso ainda não existam, ou substitui os
     * existentes se o caller quiser resetar. Devolve a lista
     * final de agentes.
     */
    resetDefaults(): Promise<AgentConfig[]>;
  };
  agentSteps: {
    list(workflowRunId: string): Promise<AgentStepOutput[]>;
    /**
     * PR 011 — Lista os `AgentStepRecord` reais persistidos de
     * uma missão, ordenados por `order` crescente. Em runtime
     * Tauri, delega para `agent_steps_list_by_mission` no
     * `agents.rs`; fora, devolve `[]` (sem steps reais no mock).
     */
    listByMission(missionId: string): Promise<AgentStepRecord[]>;
    /**
     * PR 011 — Retorna um `AgentStepRecord` real persistido por
     * `id`, ou `null` se não existir.
     */
    get(stepId: string): Promise<AgentStepRecord | null>;
  };
  models: {
    updateAgentModel(agentId: string, input: AgentModelSettingInput): Promise<Agent>;
    /**
     * PR 011 — Atualiza o `providerId` e/ou `model` de um agente
     * configurado no Agent Engine real (passa `null` para
     * limpar e herdar da missão). Devolve a configuração
     * atualizada. Em runtime Tauri, delega para
     * `agents_update_config` no `agents.rs`; fora, cai no
     * mock legado (atualiza o `Agent` em memória).
     */
    updateAgentConfigModel(
      agentId: string,
      input: { providerId?: string | null; model?: string | null }
    ): Promise<AgentConfig>;
  };
  // ============================================================================
  // PR 007 — Provider Engine próprio
  // ============================================================================
  //
  // Superfície canônica do Provider Engine do FluxoraV1.
  providers: {
    /** Lista todos os providers configurados. */
    list(): Promise<AiProviderConfig[]>;
    list(): Promise<AiProviderConfig[]>;
    /** Retorna um provider pelo `id`. */
    get(id: string): Promise<AiProviderConfig | null>;
    /** Cria um novo provider. */
    create(input: Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">): Promise<AiProviderConfig>;
    /** Atualiza um provider existente. */
    update(id: string, input: Partial<Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">>): Promise<AiProviderConfig>;
    /** Remove um provider. */
    remove(id: string): Promise<void>;
    /** Testa a conexão com o provider (health-check). */
    test(id: string): Promise<ProviderTestResult>;
    /** Lista modelos do provider (via `/models` quando suportado). */
    listModels(id: string): Promise<AiModelInfo[]>;
    /**
     * Fundação técnica: faz uma chamada simples de chat.
     * Apenas para validação do adapter. O chat real fica para
     * o Mission Engine em PR futura.
     */
    chatOnce(input: ChatOnceRequest): Promise<ChatOnceResult>;
    /**
     * PR 012 — Faz uma chamada de chat com streaming
     * OpenAI-compatible. O backend emite `provider/stream-*`
     * no barramento `fluxora-event` durante a execução e
     * devolve o `ProviderStreamResult` consolidado ao final.
     *
     * Em runtime Tauri, delega para `providers_chat_stream`
     * no `providers.rs`. Fora, cai no mock legado (sem chunks
     * reais).
     *
     * **Não implementa tool calling, cancelamento real de
     * stream ou execução de comandos.** O `chatOnce` continua
     * sendo a forma não-streaming.
     */
    chatStream(input: ChatStreamRequest): Promise<ProviderStreamResult>;
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
