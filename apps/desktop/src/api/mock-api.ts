import type {
  Project, Agent, WorkflowRun, WorkflowRunDetail,
  WorkflowEvent, Approval, ApprovalImpact, CreateProjectInput,
  UpdateProjectInput, UpdateAgentInput,
  AgentModelSettingInput, CreateWorkflowInput, FluxoraAPI,
  OpenCodeSettings, OpenCodeDetection, OpenCodeStatus,
  OpenCodeProvider, OpenCodeModel, OpenCodeCatalogResult,
  AudioProviderSettings, AudioTranscriptionInput, AudioTranscriptionResult,
  CommandRun, ChangedFile, FileDiff, GitInspectionResult, VoiceRequestRecord,
  WorkflowExecutionMode, RealWorkflowStrategy, AgentStepOutput, AgentStepStatus,
  WorkflowRerunInput,
  BackgroundWorkflowJob, OpenCodeDiagnosticResult, AudioRetentionSettings, AudioStorageStats,
  WhisperDownloadProgress, WhisperModelInfo,
  FluxoraEvent, FluxoraEventLevel, FluxoraEventSource,
  AiProviderConfig, AiModelInfo, ChatOnceRequest, ChatOnceResult,
  ChatStreamRequest, ProviderStreamResult,
  ProviderTestResult,
  ProjectExecutionPolicy, PermissionAction, PermissionDecision,
  UpdateProjectPolicyInput, PermissionCheckResult, MissionJob,
  CancelMissionJobInput,
  PatchProposal, CreatePatchProposalInput, ApplyPatchInput,
  AgentConfig, CreateAgentConfigInput, UpdateAgentConfigInput,
  AgentStepRecord,
} from "@fluxora/shared";
import { buildVoiceContext } from "@fluxora/voice-context";

const now = new Date().toISOString();

const mockProjects: Project[] = [
  { id: "proj-1", name: "eBig Food API", path: "/projects/ebig-food-api", stack: ["Laravel", "PHP", "API"], status: "idle", createdAt: now, updatedAt: now },
  { id: "proj-2", name: "eBig Food App", path: "/projects/ebig-food-app", stack: ["Flutter", "Dart", "Mobile"], status: "idle", createdAt: now, updatedAt: now },
  { id: "proj-3", name: "eBig Admin", path: "/projects/ebig-admin", stack: ["Vue", "TypeScript", "Admin"], status: "idle", createdAt: now, updatedAt: now },
  { id: "proj-4", name: "eBig Web", path: "/projects/ebig-web", stack: ["Next.js", "React", "Web"], status: "idle", createdAt: now, updatedAt: now },
  { id: "proj-5", name: "Pagamentos Service", path: "/projects/pagamentos-service", stack: ["Node.js", "TypeScript", "API"], status: "idle", createdAt: now, updatedAt: now },
];

const mockAgents: Agent[] = [
  { id: "agent-orchestrator", name: "Orquestrador", role: "orchestrator", description: "Coordena e gerencia todos os outros agentes", canEditFiles: false, canRunCommands: false, requiresApproval: true, enabled: true, modelProviderId: "openai", modelName: "openai/gpt-5.5", createdAt: now, updatedAt: now },
  { id: "agent-planner", name: "Planner", role: "planner", description: "Analisa requisitos e cria planos de implementação", canEditFiles: false, canRunCommands: false, requiresApproval: false, enabled: true, modelProviderId: "opencode-go", modelName: "opencode-go/glm-5.1", createdAt: now, updatedAt: now },
  { id: "agent-backend", name: "Backend Dev", role: "backend-dev", description: "Desenvolve APIs, serviços e lógica de servidor", canEditFiles: true, canRunCommands: true, requiresApproval: true, enabled: true, modelProviderId: "opencode-go", modelName: "opencode-go/glm-5.1", createdAt: now, updatedAt: now },
  { id: "agent-frontend", name: "Frontend Dev", role: "frontend-dev", description: "Desenvolve interfaces web e componentes visuais", canEditFiles: true, canRunCommands: true, requiresApproval: true, enabled: true, modelProviderId: "opencode-go", modelName: "opencode-go/mimo-v2.5", createdAt: now, updatedAt: now },
  { id: "agent-mobile", name: "Mobile Dev", role: "mobile-dev", description: "Desenvolve aplicativos móveis nativos e híbridos", canEditFiles: true, canRunCommands: true, requiresApproval: true, enabled: true, modelProviderId: "google", modelName: "google/gemini-2.5-pro", createdAt: now, updatedAt: now },
  { id: "agent-qa", name: "QA", role: "qa", description: "Executa testes e valida a qualidade do código", canEditFiles: false, canRunCommands: true, requiresApproval: false, enabled: true, modelProviderId: "openai", modelName: "openai/gpt-5.4", createdAt: now, updatedAt: now },
  { id: "agent-devops", name: "DevOps", role: "devops", description: "Gerencia infraestrutura, CI/CD e deploy", canEditFiles: false, canRunCommands: true, requiresApproval: true, enabled: false, createdAt: now, updatedAt: now },
];

// Catálogo mock — simula o que o OpenCode CLI retornaria em um ambiente
// com providers comuns configurados. O mock existe apenas para que a UI
// funcione em modo navegador; no Electron o catálogo vem do CLI real.
const mockProviders: OpenCodeProvider[] = [
  { id: "openai", displayName: "OpenAI", authType: "oauth" },
  { id: "opencode-go", displayName: "OpenCode Go", authType: "api" },
  { id: "google", displayName: "Google", authType: "api" },
];

const mockModels: OpenCodeModel[] = [
  { id: "openai/gpt-5.5", providerId: "openai", modelName: "gpt-5.5" },
  { id: "openai/gpt-5.4", providerId: "openai", modelName: "gpt-5.4" },
  { id: "opencode-go/glm-5.1", providerId: "opencode-go", modelName: "glm-5.1" },
  { id: "opencode-go/mimo-v2.5", providerId: "opencode-go", modelName: "mimo-v2.5" },
  { id: "opencode-go/qwen3.7-plus", providerId: "opencode-go", modelName: "qwen3.7-plus" },
  { id: "google/gemini-2.5-pro", providerId: "google", modelName: "gemini-2.5-pro" },
];

const mockModelsByProvider: Record<string, OpenCodeModel[]> = mockModels.reduce((acc, m) => {
  if (!acc[m.providerId]) acc[m.providerId] = [];
  acc[m.providerId].push(m);
  return acc;
}, {} as Record<string, OpenCodeModel[]>);

const mockCatalog: OpenCodeCatalogResult = {
  providers: mockProviders,
  models: mockModels,
  modelsByProvider: mockModelsByProvider,
  fetchedAt: new Date().toISOString(),
};

let projects = [...mockProjects];
let agents = [...mockAgents];
let workflowRuns: WorkflowRun[] = [];
let workflowSteps: Map<string, any[]> = new Map();
let workflowEvents: WorkflowEvent[] = [];
let approvals: Approval[] = [];
let approvalIdCounter = 0;
let workflowIdCounter = 0;
let eventIdCounter = 0;
let stepIdCounter = 0;

let commandRuns: CommandRun[] = [];
let commandRunCounter = 0;
let changedFilesByWorkflow: Map<string, ChangedFile[]> = new Map();
let fileDiffsByWorkflow: Map<string, FileDiff[]> = new Map();
let voiceRequests: VoiceRequestRecord[] = [];
let voiceRequestCounter = 0;
let agentStepsByWorkflow: Map<string, AgentStepOutput[]> = new Map();
let agentStepCounter = 0;

let opencodeSettings: OpenCodeSettings = {
  binaryPath: "opencode",
  defaultTimeoutMs: 5 * 60 * 1000,
  enabled: true,
};
let opencodeStatus: OpenCodeStatus = "not_detected";
let audioProvider: AudioProviderSettings = { type: "manual" };
let audioRetentionSettings: AudioRetentionSettings = { saveAudio: true, retentionDays: 30 };
let whisperModels: WhisperModelInfo[] = [
  { id: "tiny", label: "Tiny", fileName: "ggml-tiny.bin", sizeBytes: 75_000_000, recommendedRamGb: 1, language: "multi", quality: "low", speed: "fast", url: "", installed: false },
  { id: "base", label: "Base", fileName: "ggml-base.bin", sizeBytes: 142_000_000, recommendedRamGb: 1, language: "multi", quality: "medium", speed: "fast", url: "", installed: true, localPath: "/tmp/ggml-base.bin" },
];
const whisperProgress: Record<string, WhisperDownloadProgress> = {};
let settingsStore: Map<string, string> = new Map();
let jobs: BackgroundWorkflowJob[] = [];
let lastDiagnosticResult: OpenCodeDiagnosticResult | null = null;

const workflowEventListeners = new Set<(event: WorkflowEvent) => void>();
const jobListeners = new Set<(job: BackgroundWorkflowJob) => void>();
const stdoutListeners = new Set<(payload: { workflowRunId: string; jobId?: string; chunk: string }) => void>();
const stderrListeners = new Set<(payload: { workflowRunId: string; jobId?: string; chunk: string }) => void>();
const jsonListeners = new Set<(payload: { workflowRunId: string; jobId?: string; event: unknown }) => void>();
const approvalListeners = new Set<(approval: Approval) => void>();

// PR 005 — Barramento de eventos do FluxoraV1 (fallback do mock).
// Mantém um ring buffer em memória e um Set de listeners que recebem
// o `FluxoraEvent` gerado localmente. Fora do runtime Tauri, o
// `desktopBridge` roteia `events.subscribe`/`events.emitDiagnostic`/
// `events.listRecent`/`events.clearRecent` para estas funções.
const MOCK_RECENT_CAPACITY = 200;
let mockRecentEvents: FluxoraEvent[] = [];
let mockEventCounter = 0;
const fluxoraEventListeners = new Set<(event: FluxoraEvent) => void>();

function buildMockEvent(input: {
  message: string;
  level?: FluxoraEventLevel;
  source?: FluxoraEventSource;
  projectId?: string;
  missionId?: string;
  agentId?: string;
  payload?: unknown;
  type?: string;
}): FluxoraEvent {
  mockEventCounter += 1;
  return {
    id: `mock-evt-${mockEventCounter}`,
    type: input.type || "app/diagnostic",
    timestamp: new Date().toISOString(),
    source: input.source || "app",
    level: input.level || "info",
    projectId: input.projectId,
    missionId: input.missionId,
    agentId: input.agentId,
    message: input.message,
    payload: input.payload,
  };
}

function pushMockEvent(event: FluxoraEvent) {
  mockRecentEvents.push(event);
  if (mockRecentEvents.length > MOCK_RECENT_CAPACITY) {
    mockRecentEvents = mockRecentEvents.slice(-MOCK_RECENT_CAPACITY);
  }
  for (const listener of fluxoraEventListeners) listener(event);
}

function emitWorkflowEvent(event: WorkflowEvent) {
  workflowEvents.push(event);
  for (const listener of workflowEventListeners) listener(event);
}

function createWorkflowEvent(input: Omit<WorkflowEvent, "id" | "createdAt">) {
  const event: WorkflowEvent = {
    id: `evt-${++eventIdCounter}`,
    createdAt: new Date().toISOString(),
    ...input,
  };
  emitWorkflowEvent(event);
  return event;
}

function updateJob(jobId: string, patch: Partial<BackgroundWorkflowJob>) {
  jobs = jobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job));
  const job = jobs.find((entry) => entry.id === jobId);
  if (job) {
    for (const listener of jobListeners) listener(job);
  }
}

function subscribe<T>(set: Set<(payload: T) => void>, callback: (payload: T) => void) {
  set.add(callback);
  return () => set.delete(callback);
}

function emitApprovalChange(approval: Approval) {
  for (const listener of approvalListeners) listener(approval);
}

async function simulateWorkflow(runId: string) {
  const run = workflowRuns.find((r) => r.id === runId);
  if (!run) return;

  run.status = "running";
  const steps = workflowSteps.get(runId) || [];

  const durations: Record<string, number> = { planner: 800, developer: 1200, qa: 800, finalization: 400 };

  for (const step of steps) {
    step.status = "running";
    step.startedAt = new Date().toISOString();
    run.currentStepId = step.id;
    createWorkflowEvent({ workflowRunId: runId, type: "step.started", message: `${step.name} iniciado` });

    await new Promise((r) => setTimeout(r, durations[step.type] || 800));

    step.status = "completed";
    step.completedAt = new Date().toISOString();
    step.output = `${step.name} concluído com sucesso`;
    createWorkflowEvent({ workflowRunId: runId, type: "step.completed", message: `${step.name} concluído` });
  }

  run.status = "completed";
  run.completedAt = new Date().toISOString();
  createWorkflowEvent({ workflowRunId: runId, type: "workflow.completed", message: "Workflow concluído com sucesso" });
}

async function simulateRealWorkflow(runId: string) {
  const run = workflowRuns.find((r) => r.id === runId);
  if (!run) return;
  run.status = "running";
  run.executionMode = "real";
  createWorkflowEvent({ workflowRunId: runId, type: "mission.received", message: `Missão recebida: ${run.title}` });

  const project = run.projectId ? projects.find((p) => p.id === run.projectId) : undefined;
  const isReadOnly = /reconhec(imento|er)\s+(do\s+)?(projeto|aplicativo|aplicação|sistema)|analis(e|ar)\s+(este\s+)?(projeto|código)|reconhec(e|a)\s+(a\s+)?estrutura/i.test(run.prompt);

  createWorkflowEvent({ workflowRunId: runId, type: "mission.type", message: `Tipo: ${isReadOnly ? "Reconhecimento do projeto" : "Execução"}` });
  createWorkflowEvent({ workflowRunId: runId, type: "mission.project", message: `Projeto selecionado: ${project?.name || "(sem projeto)"}` });
  createWorkflowEvent({ workflowRunId: runId, type: "mission.path", message: `Caminho: ${project?.path || "/"}` });
  createWorkflowEvent({ workflowRunId: runId, type: "mission.mode", message: `Modo: Real / ${isReadOnly ? "Read-only" : "Read-write"}` });
  createWorkflowEvent({ workflowRunId: runId, type: "workflow.real.started", message: "Execução real iniciada (modo browser mock)" });

  const cmd: CommandRun = {
    id: `cmd-${++commandRunCounter}`,
    workflowRunId: runId,
    projectId: run.projectId,
    command: opencodeSettings.binaryPath,
    args: ["run", run.prompt, "--dir", project?.path || "/"],
    cwd: project?.path || "/",
    status: "running",
    stdout: "",
    stderr: "",
    startedAt: new Date().toISOString(),
  };
  commandRuns.push(cmd);

  await new Promise((r) => setTimeout(r, 1200));

  // mock stdout
  const stdoutLines = isReadOnly ? [
    "OpenCode CLI v0.4.2 (simulado)",
    `Carregando projeto: ${project?.name || "(sem projeto)"}`,
    `Modo: read-only`,
    "Analisando estrutura do projeto...",
    "Lendo package.json...",
    "Lendo diretórios...",
    "Gerando relatório de reconhecimento...",
    "Finalizado com sucesso.",
  ] : [
    "OpenCode CLI v0.4.2 (simulado)",
    `Carregando projeto: ${project?.name || "(sem projeto)"}`,
    `Prompt: ${run.prompt.slice(0, 80)}...`,
    "Executando...",
    "Finalizado com sucesso.",
  ];
  for (const line of stdoutLines) {
    cmd.stdout += line + "\n";
    createWorkflowEvent({ workflowRunId: runId, type: "opencode.stdout", message: line });
    for (const listener of stdoutListeners) listener({ workflowRunId: runId, chunk: `${line}\n` });
    await new Promise((r) => setTimeout(r, 200));
  }

  cmd.status = "completed";
  cmd.completedAt = new Date().toISOString();
  cmd.exitCode = 0;
  cmd.durationMs = Date.now() - new Date(cmd.startedAt).getTime();

  // Read-only mission: no files changed, complete directly
  if (isReadOnly) {
    const resultText = [
      "# Relatório de Reconhecimento do Projeto",
      "",
      "## 1. Visão geral do projeto",
      `${project?.name || "Projeto"} é um aplicativo de exemplo para demonstração.`,
      "",
      "## 2. Tecnologias detectadas",
      `- Stack: ${project?.stack?.join(", ") || "Não identificada"}`,
      "",
      "## 3. Estrutura principal de pastas",
      "- src/ — código fonte",
      "- tests/ — testes",
      "- docs/ — documentação",
      "",
      "## 4. Componentes ou módulos importantes",
      "- Módulo principal de aplicação",
      "- Configuração de ambiente",
      "",
      "## 5. Como o projeto parece executar",
      "O projeto é iniciado via scripts do package.json.",
      "",
      "## 6. Pontos de atenção",
      "- Verificar dependências desatualizadas",
      "- Cobertura de testes pode ser melhorada",
      "",
      "## 7. Próximos passos recomendados",
      "- Revisar documentação",
      "- Executar testes automatizados",
      "- Verificar configuração de CI/CD",
    ].join("\n");

    const responseEvent: WorkflowEvent = {
      id: `resp-${Date.now()}`,
      workflowRunId: runId,
      type: "mission.result",
      message: resultText,
      createdAt: new Date().toISOString(),
    };
    workflowEvents.push(responseEvent);
    for (const listener of workflowEventListeners) listener(responseEvent);

    createWorkflowEvent({ workflowRunId: runId, type: "mission.result", message: "Missão concluída. Nenhum arquivo alterado." });
    createWorkflowEvent({ workflowRunId: runId, type: "workflow.real.completed", message: "Execução real finalizada — nenhum arquivo alterado" });
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    return;
  }

  // Non-read-only: mock diff detection
  const changedFiles: ChangedFile[] = [
    { id: `cf-${Date.now()}-1`, workflowRunId: runId, projectId: run.projectId || "", path: "app/Http/Controllers/CouponController.php", status: "modified", additions: 32, deletions: 4, createdAt: new Date().toISOString() },
    { id: `cf-${Date.now()}-2`, workflowRunId: runId, projectId: run.projectId || "", path: "database/migrations/2026_06_11_create_coupons_table.php", status: "added", additions: 28, deletions: 0, createdAt: new Date().toISOString() },
    { id: `cf-${Date.now()}-3`, workflowRunId: runId, projectId: run.projectId || "", path: "lib/screens/coupon/coupon_banner.dart", status: "modified", additions: 18, deletions: 2, createdAt: new Date().toISOString() },
    { id: `cf-${Date.now()}-4`, workflowRunId: runId, projectId: run.projectId || "", path: "tests/Feature/CouponTest.php", status: "added", additions: 41, deletions: 0, createdAt: new Date().toISOString() },
  ];
  changedFilesByWorkflow.set(runId, changedFiles);

  fileDiffsByWorkflow.set(runId, changedFiles.map((f) => ({
    id: `fd-${f.id}`,
    workflowRunId: runId,
    projectId: run.projectId || "",
    filePath: f.path,
    diff: `--- a/${f.path}\n+++ b/${f.path}\n@@ -1,3 +1,${f.additions} @@\n+ // alterado pelo OpenCode (simulado)\n+ public function apply() {\n+   return true;\n+ }\n`,
    createdAt: new Date().toISOString(),
  })));

  createWorkflowEvent({ workflowRunId: runId, type: "git.changed_files.detected", message: `Detectados ${changedFiles.length} arquivo(s) alterado(s)` });
  createWorkflowEvent({ workflowRunId: runId, type: "git.diff.generated", message: `Diff gerado para ${changedFiles.length} arquivo(s)` });

  // Cria aprovação final com contexto rico
  const totalAdd = changedFiles.reduce((s, f) => s + f.additions, 0);
  const totalDel = changedFiles.reduce((s, f) => s + f.deletions, 0);
  const impact: ApprovalImpact = changedFiles.length > 3 ? "high" : changedFiles.length > 1 ? "medium" : "low";
  const fileList = changedFiles.map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join("\n");
  const approval: Approval = {
    id: `appr-${++approvalIdCounter}`,
    title: `Aprovar alterações: ${changedFiles.length} arquivo(s)`,
    description: [
      `Missão: ${run.title}`,
      `Motivo: Foram detectadas alterações em arquivos.`,
      ``,
      `Arquivos alterados:`,
      fileList,
      ``,
      `Resumo: +${totalAdd}/-${totalDel} linhas em ${changedFiles.length} arquivo(s)`,
      `Impacto: ${impact === "high" ? "Alto" : impact === "medium" ? "Médio" : "Baixo"}`,
      `Agente: OpenCode CLI (modo real)`,
    ].join("\n"),
    impact,
    status: "pending",
    projectId: run.projectId,
    workflowRunId: runId,
    createdAt: new Date().toISOString(),
  };
  approvals.unshift(approval);
  run.finalApprovalId = approval.id;
  createWorkflowEvent({ workflowRunId: runId, type: "approval.final.required", message: `Aprovação final requerida — ${changedFiles.length} arquivo(s) alterado(s)` });
  emitApprovalChange(approval);

  // Run fica pendente de aprovação final até que o usuário resolva.
  run.status = "pending_approval";
  createWorkflowEvent({ workflowRunId: runId, type: "workflow.real.completed", message: "Execução real finalizada — aguardando aprovação final" });
}

async function simulateMultiAgentWorkflow(runId: string) {
  const run = workflowRuns.find((r) => r.id === runId);
  if (!run) return;
  run.status = "running";
  run.executionMode = "real";
  createWorkflowEvent({ workflowRunId: runId, type: "workflow.multi_agent.started", message: "Execução multiagente iniciada (mock)" });

  const project = run.projectId ? projects.find((p) => p.id === run.projectId) : undefined;

  // Etapa 1: Planner
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "planner.started", message: "Planner iniciado", createdAt: new Date().toISOString() });
  const plannerStep: AgentStepOutput = {
    id: `step-${++agentStepCounter}`,
    workflowRunId: runId,
    projectId: run.projectId || "",
    agentRole: "planner",
    agentName: "Planner",
    prompt: "[mock] plano de execução",
    output: "Plano:\n1. Criar migration\n2. Adicionar controller\n3. Atualizar app\n4. Adicionar testes",
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  agentStepsByWorkflow.set(runId, [plannerStep]);
  await new Promise((r) => setTimeout(r, 500));
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "planner.completed", message: "Planner concluído", createdAt: new Date().toISOString() });

  // Etapa 2: Developer
  const hasBackend = /api|laravel|backend|server|banco|node|payment/i.test(run.prompt + (run.generatedContext || ""));
  const hasFrontend = /site|tela|painel|react|vue|web|interface/i.test(run.prompt + (run.generatedContext || ""));
  const hasMobile = /app|flutter|mobile|celular/i.test(run.prompt + (run.generatedContext || ""));
  let devVariant = "backend-dev";
  if (hasMobile && !hasBackend && !hasFrontend) devVariant = "mobile-dev";
  else if (hasFrontend && !hasBackend) devVariant = "frontend-dev";
  const devName = devVariant === "backend-dev" ? "Backend Dev" : devVariant === "frontend-dev" ? "Frontend Dev" : "Mobile Dev";
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "developer.selected", message: `Developer selecionado: ${devName}`, createdAt: new Date().toISOString() });
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "developer.started", message: `${devName} iniciado`, createdAt: new Date().toISOString() });
  const devStep: AgentStepOutput = {
    id: `step-${++agentStepCounter}`,
    workflowRunId: runId,
    projectId: run.projectId || "",
    agentRole: devVariant,
    agentName: devName,
    prompt: "[mock] prompt do developer",
    output: "Implementei:\n- app/Http/Controllers/CouponController.php\n- database/migrations/2026_06_11_create_coupons_table.php\n- tests/Feature/CouponTest.php",
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  agentStepsByWorkflow.set(runId, [...(agentStepsByWorkflow.get(runId) || []), devStep]);
  await new Promise((r) => setTimeout(r, 700));
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "developer.completed", message: `${devName} concluído`, createdAt: new Date().toISOString() });

  // Etapa 3: QA
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "qa.started", message: "QA iniciado", createdAt: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 500));
  const qaStep: AgentStepOutput = {
    id: `step-${++agentStepCounter}`,
    workflowRunId: runId,
    projectId: run.projectId || "",
    agentRole: "qa",
    agentName: "QA",
    prompt: "[mock] prompt do qa",
    output: "Status: aprovado\nMotivos: testes passando\nTestes executados: pnpm test",
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  agentStepsByWorkflow.set(runId, [...(agentStepsByWorkflow.get(runId) || []), qaStep]);
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "qa.completed", message: "QA concluído", createdAt: new Date().toISOString() });
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "qa.approved", message: "QA aprovou a entrega", createdAt: new Date().toISOString() });

  // Aprovação final
  const changedFiles: ChangedFile[] = [
    { id: `cf-${Date.now()}-1`, workflowRunId: runId, projectId: run.projectId || "", path: "app/Http/Controllers/CouponController.php", status: "modified", additions: 32, deletions: 4, createdAt: new Date().toISOString() },
    { id: `cf-${Date.now()}-2`, workflowRunId: runId, projectId: run.projectId || "", path: "database/migrations/2026_06_11_create_coupons_table.php", status: "added", additions: 28, deletions: 0, createdAt: new Date().toISOString() },
    { id: `cf-${Date.now()}-3`, workflowRunId: runId, projectId: run.projectId || "", path: "tests/Feature/CouponTest.php", status: "added", additions: 41, deletions: 0, createdAt: new Date().toISOString() },
  ];
  changedFilesByWorkflow.set(runId, changedFiles);
  fileDiffsByWorkflow.set(runId, changedFiles.map((f) => ({
    id: `fd-${f.id}`,
    workflowRunId: runId,
    projectId: run.projectId || "",
    filePath: f.path,
    diff: `--- a/${f.path}\n+++ b/${f.path}\n@@ -1,3 +1,${f.additions} @@\n+ // mock\n`,
    createdAt: new Date().toISOString(),
  })));
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "git.changed_files.detected", message: `Detectados ${changedFiles.length} arquivo(s)`, createdAt: new Date().toISOString() });
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "git.diff.generated", message: `Diff gerado`, createdAt: new Date().toISOString() });

  const totalAdd = changedFiles.reduce((s, f) => s + f.additions, 0);
  const totalDel = changedFiles.reduce((s, f) => s + f.deletions, 0);
  const fileList = changedFiles.map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join("\n");
  const approval: Approval = {
    id: `appr-${++approvalIdCounter}`,
    title: `Aprovar alterações: ${changedFiles.length} arquivo(s)`,
    description: [
      `Missão: ${run.title}`,
      `Motivo: Foram detectadas alterações em arquivos.`,
      ``,
      `Arquivos alterados:`,
      fileList,
      ``,
      `Resumo: +${totalAdd}/-${totalDel} linhas em ${changedFiles.length} arquivo(s)`,
      `Impacto: Médio`,
      `Agente: Multiagente (Planner → Dev → QA)`,
    ].join("\n"),
    impact: "medium",
    status: "pending",
    projectId: run.projectId,
    workflowRunId: runId,
    createdAt: new Date().toISOString(),
  };
  approvals.unshift(approval);
  run.finalApprovalId = approval.id;
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "approval.final.required", message: "Aprovação final requerida", createdAt: new Date().toISOString() });
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "approval.created", message: `Aprovação final criada: ${approval.title}`, createdAt: new Date().toISOString() });
  emitApprovalChange(approval);
  // Run fica pendente de aprovação final até que o usuário resolva.
  run.status = "pending_approval";
  workflowEvents.push({ id: `evt-${++eventIdCounter}`, workflowRunId: runId, type: "workflow.multi_agent.awaiting_approval", message: "Execução multiagente concluída — aguardando aprovação final", createdAt: new Date().toISOString() });
}

export function createMockAPI(): FluxoraAPI {
  return {
    projects: {
      list: async () => [...projects],
      create: async (input: CreateProjectInput) => {
        const p: Project = { id: `proj-${Date.now()}`, name: input.name, path: input.path, stack: input.stack, status: "idle", createdAt: now, updatedAt: now };
        projects.push(p);
        return p;
      },
      update: async (id: string, input: UpdateProjectInput) => {
        const p = projects.find((pr) => pr.id === id);
        if (p) { Object.assign(p, input, { updatedAt: new Date().toISOString() }); }
        return p!;
      },
      remove: async (id: string) => {
        projects = projects.filter((p) => p.id !== id);
      },
      selectDirectory: async () => ({ canceled: true }),
      validatePath: async (projectPath: string) => {
        if (!projectPath || !projectPath.trim()) {
          return { valid: false, exists: false, isDirectory: false, hasGit: false, error: "O caminho não pode estar vazio." };
        }
        return { valid: true, exists: true, isDirectory: true, hasGit: true };
      },
    },
    workflows: {
      list: async () => [...workflowRuns],
      create: async (input: CreateWorkflowInput & { executionMode?: WorkflowExecutionMode; realStrategy?: RealWorkflowStrategy }) => {
        const id = `wf-${++workflowIdCounter}`;
        const mode = input.executionMode || "simulated";
        const run: WorkflowRun = {
          id,
          projectId: input.projectId,
          title: input.title,
          prompt: input.prompt,
          generatedContext: input.generatedContext,
          status: "pending_approval",
          executionMode: mode,
          createdAt: now,
          updatedAt: now,
        };
        (run as any).realStrategy = input.realStrategy || (mode === "real" ? "multi_agent" : undefined);
        workflowRuns.unshift(run);
        const steps = input.steps.map((s) => ({
          id: `step-${++stepIdCounter}`,
          workflowRunId: id,
          name: s.name,
          type: s.type,
          agentId: s.agentId,
          status: "pending" as const,
        }));
        workflowSteps.set(id, steps);
        const strategyNote = mode === "real" ? `, estratégia: ${(run as any).realStrategy}` : "";
        createWorkflowEvent({ workflowRunId: id, type: "workflow.created", message: `Workflow "${input.title}" criado (modo: ${mode}${strategyNote})` });

        const approval: Approval = {
          id: `appr-${++approvalIdCounter}`,
          title: `Aprovar: ${input.title}`,
          description: `Execução de "${input.prompt}"`,
          impact: "medium",
          status: "pending",
          projectId: input.projectId,
          workflowRunId: id,
          createdAt: now,
        };
        approvals.unshift(approval);
        createWorkflowEvent({ workflowRunId: id, type: "approval.required", message: `Aprovação pendente: ${input.title}` });
        createWorkflowEvent({ workflowRunId: id, type: "approval.created", message: `Aprovação criada: ${input.title}` });
        emitApprovalChange(approval);

        return run;
      },
      get: async (id: string) => {
        const run = workflowRuns.find((r) => r.id === id);
        if (!run) throw new Error("Not found");
        return {
          ...run,
          steps: workflowSteps.get(id) || [],
          events: workflowEvents.filter((e) => e.workflowRunId === id),
        } as WorkflowRunDetail;
      },
      simulate: async (id: string) => {
        await simulateWorkflow(id);
      },
      runReal: async (id: string) => {
        const run = workflowRuns.find((r) => r.id === id);
        const strategy = (run as any)?.realStrategy;
        await createMockAPI().workflows.runRealAsync(id);
      },
      runRealAsync: async (id: string) => {
        const run = workflowRuns.find((r) => r.id === id);
        if (!run?.projectId) throw new Error("Workflow sem projeto no mock");
        const jobId = `job-${id}-${Date.now()}`;
        const strategy = run.realStrategy || "single";
        const job: BackgroundWorkflowJob = { id: jobId, workflowRunId: id, projectId: run.projectId, strategy, status: "queued" };
        jobs.unshift(job);
        updateJob(jobId, { status: "queued" });
        setTimeout(async () => {
          updateJob(jobId, { status: "running", startedAt: new Date().toISOString() });
          if (strategy === "multi_agent") {
            await simulateMultiAgentWorkflow(id);
          } else {
            await simulateRealWorkflow(id);
          }
          const latest = jobs.find((entry) => entry.id === jobId);
          if (latest?.status !== "cancelled") {
            updateJob(jobId, { status: "completed", completedAt: new Date().toISOString() });
          }
        }, 10);
        return { jobId, workflowRunId: id };
      },
      rerun: async (originalId: string, overrides?: WorkflowRerunInput) => {
        const original = workflowRuns.find((r) => r.id === originalId);
        if (!original) throw new Error("Workflow original não encontrado");
        if (!original.projectId) throw new Error("Workflow original sem projeto");

        const mode: WorkflowExecutionMode = overrides?.executionMode || original.executionMode || "real";
        const strategy: RealWorkflowStrategy =
          overrides?.realStrategy || original.realStrategy || (mode === "real" ? "single" : "multi_agent");
        const prompt = overrides?.prompt?.trim() || original.prompt;

        if (overrides?.defaultTimeoutMs && overrides.defaultTimeoutMs > 0) {
          opencodeSettings = { ...opencodeSettings, defaultTimeoutMs: overrides.defaultTimeoutMs };
        }

        let rerunContext: Record<string, unknown> = {};
        try {
          rerunContext = original.generatedContext ? JSON.parse(original.generatedContext) : {};
        } catch {
          rerunContext = {};
        }
        rerunContext.kind = "rerun";
        rerunContext.parentRunId = original.id;
        rerunContext.parentStatus = original.status;
        rerunContext.reranAt = new Date().toISOString();

        const newId = `wf-${++workflowIdCounter}`;
        const newRun: WorkflowRun = {
          id: newId,
          projectId: original.projectId,
          title: original.title,
          prompt,
          generatedContext: JSON.stringify(rerunContext, null, 2),
          status: "pending_approval",
          executionMode: mode,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        (newRun as any).realStrategy = strategy;
        workflowRuns.unshift(newRun);

        const steps = [
          { id: `step-${++stepIdCounter}`, workflowRunId: newId, name: "Planejamento", type: "planner", agentId: "agent-planner", status: "pending" as const },
          { id: `step-${++stepIdCounter}`, workflowRunId: newId, name: "Desenvolvimento", type: "developer", agentId: "agent-backend", status: "pending" as const },
          { id: `step-${++stepIdCounter}`, workflowRunId: newId, name: "Testes e Validação", type: "qa", agentId: "agent-qa", status: "pending" as const },
          { id: `step-${++stepIdCounter}`, workflowRunId: newId, name: "Finalização", type: "finalization", agentId: "agent-orchestrator", status: "pending" as const },
        ];
        workflowSteps.set(newId, steps);

        createWorkflowEvent({
          workflowRunId: newId,
          projectId: original.projectId,
          type: "workflow.created",
          message: `Workflow "${original.title}" recriado (modo: ${mode}, estratégia: ${strategy})`,
        });
        createWorkflowEvent({
          workflowRunId: newId,
          projectId: original.projectId,
          type: "workflow.rerun.started",
          message: `Reexecutando a partir de ${original.id}`,
        });

        // Auto-aprovação inicial para iniciar o runner
        const pending = approvals.find((a) => a.workflowRunId === newId && a.status === "pending");
        if (pending) {
          pending.status = "approved";
          pending.resolvedAt = new Date().toISOString();
          newRun.status = "approved";
          emitApprovalChange(pending);
        }

        // Despacha para o runner mock (simulado ou real)
        const jobId = `job-${newId}-${Date.now()}`;
        const job: BackgroundWorkflowJob = { id: jobId, workflowRunId: newId, projectId: original.projectId, strategy, status: "queued" };
        jobs.unshift(job);
        updateJob(jobId, { status: "queued" });
        setTimeout(async () => {
          updateJob(jobId, { status: "running", startedAt: new Date().toISOString() });
          if (mode === "simulated") {
            await simulateWorkflow(newId);
          } else if (strategy === "multi_agent") {
            await simulateMultiAgentWorkflow(newId);
          } else {
            await simulateRealWorkflow(newId);
          }
          const latest = jobs.find((entry) => entry.id === jobId);
          if (latest?.status !== "cancelled") {
            updateJob(jobId, { status: "completed", completedAt: new Date().toISOString() });
          }
        }, 10);

        return { jobId, workflowRunId: newId };
      },
      getJob: async (jobId: string) => jobs.find((job) => job.id === jobId) || null,
      listJobs: async () => [...jobs],
      cancelJob: async (jobId: string) => {
        const job = jobs.find((entry) => entry.id === jobId);
        if (!job) return;
        updateJob(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
        const run = workflowRuns.find((entry) => entry.id === job.workflowRunId);
        if (run) {
          run.status = "cancelled";
          createWorkflowEvent({ workflowRunId: run.id, projectId: run.projectId, type: "opencode.process.cancelled", message: "Processo OpenCode cancelado pelo usuário" });
          createWorkflowEvent({ workflowRunId: run.id, projectId: run.projectId, type: "workflow.cancelled", message: "Execução cancelada pelo usuário" });
        }
      },
      getStepOutputs: async (id: string) => {
        return agentStepsByWorkflow.get(id) || [];
      },
      listAgentOutputs: async (id: string) => agentStepsByWorkflow.get(id) || [],
      approveFinal: async (id: string) => {
        const run = workflowRuns.find((r) => r.id === id);
        if (!run || !run.finalApprovalId) throw new Error("Aprovação final não encontrada");
        const a = approvals.find((x) => x.id === run.finalApprovalId);
        if (!a) throw new Error("Aprovação final não encontrada");
        a.status = "approved";
        a.resolvedAt = new Date().toISOString();
        // Após aprovação final, run transita para "completed".
        run.status = "completed";
        run.completedAt = new Date().toISOString();
        createWorkflowEvent({ workflowRunId: id, type: "approval.final.approved", message: "Aprovação final concedida" });
        createWorkflowEvent({ workflowRunId: id, type: "workflow.completed", message: "Workflow concluído após aprovação final" });
        emitApprovalChange(a);
        return a;
      },
      rejectFinal: async (id: string, note?: string) => {
        const run = workflowRuns.find((r) => r.id === id);
        if (!run || !run.finalApprovalId) throw new Error("Aprovação final não encontrada");
        const a = approvals.find((x) => x.id === run.finalApprovalId);
        if (!a) throw new Error("Aprovação final não encontrada");
        a.status = "rejected";
        a.resolvedAt = new Date().toISOString();
        // Após rejeição final, run transita para "rejected".
        run.status = "rejected";
        run.completedAt = new Date().toISOString();
        const msg = note ? `Aprovação final rejeitada: ${note}` : "Aprovação final rejeitada";
        createWorkflowEvent({ workflowRunId: id, type: "approval.final.rejected", message: msg });
        createWorkflowEvent({ workflowRunId: id, type: "security.warning", message: "As alterações permanecem no diretório do projeto. Use git diff/git checkout manualmente para revisar ou descartar." });
        emitApprovalChange(a);
        return a;
      },
    },
    approvals: {
      listActionable: async () => {
        // Reconcile orphaned pending_approval workflows
        const orphanedRuns = workflowRuns.filter(
          (r) => r.status === "pending_approval" && !approvals.some((a) => a.workflowRunId === r.id)
        );
        for (const run of orphanedRuns) {
          // Check for simple conversation
          const text = `${run.title} ${run.prompt}`.trim().toLowerCase();
          const isSimple = /^(oi|olá|ola|teste|hello|hi|hey|test|ok|tchau|bye|vlw|yo|eai|e aí|fala)([\s!.?,;:'-]+(oi|olá|ola|teste|hello|hi|hey|test|ok|tchau|bye|vlw|yo|eai|e aí|fala))*[\s!.?]*$/i.test(text);
          const hasFiles = changedFilesByWorkflow.has(run.id);
          const steps = workflowSteps.get(run.id) || [];
          const hasCompletedSteps = steps.some((s) => s.status === "completed");

          if (isSimple && !hasFiles && !hasCompletedSteps) {
            run.status = "completed";
            run.completedAt = new Date().toISOString();
            createWorkflowEvent({ workflowRunId: run.id, type: "conversation.reconciled", message: "Conversa simples marcada como concluída" });
            continue;
          }

          const approval: Approval = {
            id: `appr-${++approvalIdCounter}`,
            title: `Aprovar: ${run.title}`,
            description: run.prompt,
            impact: "medium",
            status: "pending",
            projectId: run.projectId,
            workflowRunId: run.id,
            createdAt: new Date().toISOString(),
          };
          approvals.unshift(approval);
          createWorkflowEvent({ workflowRunId: run.id, type: "approval.reconciled", message: `Aprovação reconciliada: ${run.title}` });
          emitApprovalChange(approval);
        }
        return approvals.filter((a) => a.status === "pending");
      },
      listPending: async () => approvals.filter((a) => a.status === "pending"),
      list: async () => [...approvals],
      approve: async (id: string) => {
        const a = approvals.find((ap) => ap.id === id);
        if (!a) throw new Error("Approval not found");
        a.status = "approved";
        a.resolvedAt = new Date().toISOString();
        if (a.workflowRunId) {
          const run = workflowRuns.find((r) => r.id === a.workflowRunId);
          if (run) {
            run.status = "approved";
            createWorkflowEvent({ workflowRunId: a.workflowRunId, type: "approval.approved", message: `Aprovação concedida: ${a.title}` });
            const executionMode = (run as any).executionMode;
            if (executionMode === "controlled_execution") {
              // Apenas transitar para approved; sem disparar simulateWorkflow nem runRealAsync.
            } else if (run.executionMode === "real") {
              void createMockAPI().workflows.runRealAsync(a.workflowRunId);
            } else {
              void simulateWorkflow(a.workflowRunId);
            }
          }
        }
        emitApprovalChange(a);
        return a;
      },
      reject: async (id: string) => {
        const a = approvals.find((ap) => ap.id === id);
        if (!a) throw new Error("Approval not found");
        a.status = "rejected";
        a.resolvedAt = new Date().toISOString();
        if (a.workflowRunId) {
          const run = workflowRuns.find((r) => r.id === a.workflowRunId);
          if (run) {
            run.status = "rejected";
            createWorkflowEvent({ workflowRunId: a.workflowRunId, type: "approval.rejected", message: `Aprovação rejeitada: ${a.title}` });
          }
        }
        emitApprovalChange(a);
        return a;
      },
      // PR 009 — Cancelamento real só existe em runtime
      // Tauri. No mock, devolve `null` (a UI trata a
      // ausência como "operação não suportada aqui").
      cancel: async (_id: string): Promise<Approval | null> => null,
    },
    agents: {
      list: async () => [...agents],
      create: async (input: {
        name: string;
        role: Agent["role"];
        description: string;
        canEditFiles: boolean;
        canRunCommands: boolean;
        requiresApproval: boolean;
        enabled?: boolean;
        modelProviderId?: string;
        modelName?: string;
      }) => {
        const agent: Agent = {
          id: `agent-${Date.now()}`,
          name: input.name,
          role: input.role,
          description: input.description,
          canEditFiles: input.canEditFiles,
          canRunCommands: input.canRunCommands,
          requiresApproval: input.requiresApproval,
          enabled: input.enabled !== false,
          modelProviderId: input.modelProviderId,
          modelName: input.modelName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        agents.push(agent);
        return agent;
      },
      update: async (id: string, input: UpdateAgentInput) => {
        const a = agents.find((ag) => ag.id === id);
        if (a) Object.assign(a, input, { updatedAt: new Date().toISOString() });
        return a!;
      },
      remove: async (id: string) => {
        const index = agents.findIndex((ag) => ag.id === id);
        if (index < 0) throw new Error(`Agent ${id} not found`);
        agents.splice(index, 1);
      },
      // PR 011 — Métodos canônicos novos sobre `AgentConfig`.
      // Em runtime browser, devolvem stubs sem persistência.
      listConfigs: async () => [],
      getConfig: async (id: string) => null,
      createConfig: async (input: CreateAgentConfigInput) => ({
        id: `mock-agent-config-${Date.now()}`,
        name: input.name,
        role: input.role,
        description: input.description,
        providerId: input.providerId,
        model: input.model,
        status: input.status ?? "enabled",
        systemPrompt: input.systemPrompt,
        order: input.order ?? 99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      updateConfig: async (id: string, input: UpdateAgentConfigInput) => ({
        id,
        name: input.name ?? "Mock Agent",
        role: "custom" as const,
        description: input.description,
        providerId: input.providerId,
        model: input.model,
        status: input.status ?? "enabled",
        systemPrompt: input.systemPrompt,
        order: input.order ?? 99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      resetDefaults: async () => [],
    },
    models: {
      updateAgentModel: async (agentId: string, input: AgentModelSettingInput) => {
        const a = agents.find((ag) => ag.id === agentId);
        if (a) Object.assign(a, { modelProviderId: input.modelProviderId, modelName: input.modelName, updatedAt: new Date().toISOString() });
        return a!;
      },
      // PR 011 — Forma canônica nova para atualização de
      // provider/model no `AgentConfig`. Em runtime browser,
      // devolve um stub.
      updateAgentConfigModel: async (
        agentId: string,
        input: { providerId?: string | null; model?: string | null },
      ) => ({
        id: agentId,
        name: "Mock Agent",
        role: "custom" as const,
        providerId: input.providerId ?? undefined,
        model: input.model ?? undefined,
        status: "enabled" as const,
        order: 99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    },
    // PR 007 — Provider Engine próprio (fallback mock).
    // Quando rodando fora do runtime Tauri, devolve listas vazias
    // e respostas simples. O `desktopBridge` é quem decide se a
    // chamada cai aqui ou vai para o backend Rust.
    providers: {
      list: async () => {
        // Em browser, o mock é vazio. O `opencode.getCatalog`
        // continua sendo a fonte de verdade no navegador.
        return [] as AiProviderConfig[];
      },
      get: async (id: string) => null,
      create: async (input): Promise<AiProviderConfig> => ({
        id: `mock-provider-${Date.now()}`,
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl,
        apiKeyEnv: input.apiKeyEnv,
        defaultModel: input.defaultModel,
        enabled: input.enabled,
        capabilities: input.capabilities,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      update: async (id, input) => ({
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
      }),
      remove: async () => {
        // noop
      },
      test: async (id: string): Promise<ProviderTestResult> => ({
        ok: false,
        providerId: id,
        status: "unreachable",
        message: "Provider Engine só funciona em runtime Tauri.",
        durationMs: 0,
      }),
      listModels: async () => [] as AiModelInfo[],
      chatOnce: async (input: ChatOnceRequest): Promise<ChatOnceResult> => ({
        text: "",
        providerId: input.providerId,
        model: input.model,
        durationMs: 0,
        usage: { mock: true },
      }),
      // PR 012 — Streaming de providers. Mock sem chunks
      // reais (devolve `text` vazio). A UI fora do runtime
      // Tauri não recebe chunks incrementais — comportamento
      // simétrico ao `chatOnce`.
      chatStream: async (input: ChatStreamRequest): Promise<ProviderStreamResult> => ({
        requestId: "mock-stream",
        providerId: input.providerId,
        providerName: undefined,
        model: input.model,
        text: "",
        durationMs: 0,
        chunks: 0,
        usage: { mock: true },
      }),
    },
    // PR 008 — Mission Engine (fallback mock fora do runtime Tauri).
    // Em runtime Tauri, o `desktopBridge` sobrescreve este namespace
    // com os comandos `missions_*` reais. Aqui, devolvemos um
    // stub que aceita `create` (no-op) e devolve listas vazias
    // para o resto, para a UI não quebrar no smoke-test em browser.
    missions: {
      ping: async () => new Date().toISOString(),
      list: async () => [],
      get: async (_id: string) => null,
      create: async (input: any) => ({
        id: `mock-mission-${Date.now()}`,
        projectId: input.projectId,
        title: input.title || input.prompt.slice(0, 60),
        prompt: input.prompt,
        status: "queued" as const,
        mode: input.mode || "propositivo",
        providerId: input.providerId,
        model: input.model,
        currentPhase: "created" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      run: async (input: { missionId: string }) => {
        // No mock, marca como completed com texto vazio.
        return {
          id: input.missionId,
          projectId: "mock",
          title: "Mock Mission",
          prompt: "",
          status: "completed" as const,
          mode: "propositivo" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
      createAndRun: async (input: any) => ({
        id: `mock-mission-${Date.now()}`,
        projectId: input.projectId,
        title: input.title || input.prompt.slice(0, 60),
        prompt: input.prompt,
        status: "completed" as const,
        mode: input.mode || "propositivo",
        providerId: input.providerId,
        model: input.model,
        currentPhase: "final-report" as const,
        resultText: "(Mission Engine só funciona em runtime Tauri.)",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      listLogs: async (_missionId: string) => [],
      clear: async () => {
        // noop
      },
    },
    voice: {
      createFromTranscript: async (input: any) => buildVoiceContext(typeof input === "string" ? { transcript: input } : input),
      transcribe: async (input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> => {
        // No browser mock, simula transcrição vazia — usuário pode editar o texto antes de gerar contexto
        const record: VoiceRequestRecord = {
          id: `vr-${++voiceRequestCounter}`,
          transcript: "",
          generatedContext: undefined,
          audioProvider: input.providerType || "manual",
          status: "transcribed",
          createdAt: new Date().toISOString(),
        };
        voiceRequests.unshift(record);
        return {
          text: "",
          language: input.language,
          durationMs: undefined,
          provider: input.providerType || "manual",
        };
      },
      listRequests: async () => [...voiceRequests],
      saveAudio: async (input: any) => ({ audioPath: `(mock) audio/${input?.voiceRequestId || "x"}.webm` }),
      saveAudioBytes: async (voiceRequestId: string) => ({ audioPath: audioRetentionSettings.saveAudio ? `(mock) audio/${voiceRequestId}.webm` : "" }),
      getAudioPath: async (voiceRequestId: string) => `(mock) audio/${voiceRequestId}.webm`,
      getAudioRetentionSettings: async () => ({ ...audioRetentionSettings }),
      updateAudioRetentionSettings: async (input: Partial<AudioRetentionSettings>) => {
        audioRetentionSettings = { ...audioRetentionSettings, ...input } as AudioRetentionSettings;
        return { ...audioRetentionSettings };
      },
      cleanupOldAudio: async () => ({ deleted: 0, freedBytes: 0 }),
      getAudioStorageStats: async (): Promise<AudioStorageStats> => ({ count: 0, bytes: 0 }),
      openAudioFolder: async () => {},
      probeServer: async () => false,
    },
    events: {
      list: async (workflowRunId?: string) => {
        if (workflowRunId) return workflowEvents.filter((e) => e.workflowRunId === workflowRunId);
        return [...workflowEvents].reverse().slice(0, 50);
      },
      onWorkflowEvent: (callback: (event: WorkflowEvent) => void) => subscribe(workflowEventListeners, callback),
      onJobUpdated: (callback: (job: BackgroundWorkflowJob) => void) => subscribe(jobListeners, callback),
      onApprovalChange: (callback: (approval: Approval) => void) => subscribe(approvalListeners, callback),
      onOpenCodeStdout: () => { throw new Error("OpenCode foi removido do FluxoraV1. Use events.subscribe com provider/stream-* e agent/step-* ."); },
      onOpenCodeStderr: () => { throw new Error("OpenCode foi removido do FluxoraV1. Use events.subscribe com provider/stream-* e agent/step-* ."); },
      onOpenCodeJsonEvent: () => { throw new Error("OpenCode foi removido do FluxoraV1. Use events.subscribe com provider/stream-* e agent/step-* ."); },
      // PR 005 — Barramento real do FluxoraV1 (fallback mock fora do
      // runtime Tauri). Mantém a mesma forma do barramento Tauri para
      // que o `desktopBridge` apenas roteie.
      subscribe: (callback: (event: FluxoraEvent) => void) =>
        subscribe(fluxoraEventListeners, callback),
      unsubscribe: (unsub: () => void) => {
        try { unsub(); } catch { /* ignore */ }
      },
      on: (type: string, callback: (event: FluxoraEvent) => void) => {
        const wrapped = (event: FluxoraEvent) => {
          if (event.type === type) callback(event);
        };
        return subscribe(fluxoraEventListeners, wrapped);
      },
      off: (unsub: () => void) => {
        try { unsub(); } catch { /* ignore */ }
      },
      listRecent: async (options?: { limit?: number; type?: string }) => {
        const limit = options?.limit ?? 50;
        const typeFilter = options?.type;
        let events = [...mockRecentEvents].reverse();
        if (typeFilter) events = events.filter((event) => event.type === typeFilter);
        if (limit > 0) events = events.slice(0, limit);
        return events;
      },
      emitDiagnostic: async (input: {
        message: string;
        level?: FluxoraEventLevel;
        source?: FluxoraEventSource;
        projectId?: string;
        missionId?: string;
        agentId?: string;
        payload?: unknown;
      }) => {
        const event = buildMockEvent({ ...input, type: "app/diagnostic" });
        pushMockEvent(event);
        return event;
      },
      clearRecent: async () => {
        mockRecentEvents = [];
      },
    },
    opencode: {
      detect: async (): Promise<OpenCodeDetection> => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      getSettings: async () => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      updateSettings: async (_input: Partial<OpenCodeSettings>) => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      getStatus: async () => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      diagnostics: {
        run: async (_input: { binaryPath: string; runSmokeTest?: boolean; format?: "default" | "json"; controlledRunTest?: boolean }) => { throw new Error("OpenCode foi removido do FluxoraV1."); },
        copyLastResult: async () => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      },
      controlledExecution: {
        run: async (_input: { workflowRunId: string }) => { throw new Error("OpenCode foi removido do FluxoraV1."); },
        getResult: async (_jobId: string) => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      },
      getCatalog: async () => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      getModelsForProvider: async (_providerId: string) => { throw new Error("OpenCode foi removido do FluxoraV1."); },
      refreshCatalog: async () => { throw new Error("OpenCode foi removido do FluxoraV1."); },
    },
    git: {
      inspect: async (projectId: string): Promise<GitInspectionResult> => {
        const project = projects.find((p) => p.id === projectId);
        if (!project) return { isRepo: false, files: [], totalAdditions: 0, totalDeletions: 0, error: "Projeto não encontrado" };
        // Simulação no browser mock
        return {
          isRepo: true,
          branch: "main",
          files: [
            { path: "app/Http/Controllers/CouponController.php", status: "modified", additions: 32, deletions: 4 },
            { path: "database/migrations/2026_06_11_create_coupons_table.php", status: "added", additions: 28, deletions: 0 },
            { path: "lib/screens/coupon/coupon_banner.dart", status: "modified", additions: 18, deletions: 2 },
            { path: "tests/Feature/CouponTest.php", status: "added", additions: 41, deletions: 0 },
          ],
          totalAdditions: 119,
          totalDeletions: 6,
        };
      },
      diff: async (projectId: string, filePath: string) => {
        return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,3 +1,32 @@\n+ // alterado (simulado)\n+ public function apply() {\n+   return true;\n+ }\n`;
      },
      changedFiles: async (workflowRunId: string) => {
        return changedFilesByWorkflow.get(workflowRunId) || [];
      },
      fileDiff: async (workflowRunId: string, filePath: string) => {
        const list = fileDiffsByWorkflow.get(workflowRunId) || [];
        return list.find((d) => d.filePath === filePath) || null;
      },
    },
    settings: {
      get: async (key: string) => settingsStore.get(key) || null,
      set: async (key: string, value: string) => {
        settingsStore.set(key, value);
      },
      getAudioProvider: async () => ({ ...audioProvider }),
      setAudioProvider: async (input: Partial<AudioProviderSettings>) => {
        audioProvider = { ...audioProvider, ...input };
        return { ...audioProvider };
      },
    },
    commands: {
      list: async (workflowRunId?: string) => {
        if (workflowRunId) return commandRuns.filter((c) => c.workflowRunId === workflowRunId);
        return [...commandRuns];
      },
      get: async (id: string) => commandRuns.find((c) => c.id === id) || null,
    },
    agentSteps: {
      list: async (workflowRunId: string) => agentStepsByWorkflow.get(workflowRunId) || [],
      // PR 011 — Métodos canônicos novos sobre `AgentStepRecord`.
      // Em runtime browser (sem Tauri), devolvem stubs.
      listByMission: async (_missionId: string) => [],
      get: async (_stepId: string) => null,
    },
    app: {
      getGitInfo: async () => ({ branch: "main", commit: "abc1234" }),
      getVersion: async () => "0.7.0",
    },
    whisperLocal: {
      listModels: async () => [...whisperModels],
      downloadModel: async (modelId: string) => {
        whisperProgress[modelId] = { modelId, status: "completed", downloadedBytes: 1, totalBytes: 1 };
        whisperModels = whisperModels.map((model) => model.id === modelId ? { ...model, installed: true, localPath: `/tmp/${model.fileName}` } : model);
        const model = whisperModels.find((entry) => entry.id === modelId);
        if (!model) throw new Error("Modelo desconhecido");
        return model;
      },
      deleteModel: async (modelId: string) => {
        whisperModels = whisperModels.map((model) => model.id === modelId ? { ...model, installed: false, localPath: undefined } : model);
        return { ok: true };
      },
      validateInstall: async () => ({
        ok: audioProvider.type === "whisper_local_managed" && Boolean(audioProvider.model),
        binaryPath: "/tmp/whisper-cli",
        modelsDir: "/tmp",
        installedModels: whisperModels.filter((model) => model.installed).map((model) => model.id),
        selectedModel: audioProvider.model,
        message: "mock",
      }),
      getDownloadProgress: async (modelId: string) => whisperProgress[modelId] || { modelId, status: "idle", downloadedBytes: 0 },
      onDownloadProgress: () => () => undefined,
    },
    whisper: {
      detect: async () => ({
        python: { available: false },
        pip: { available: false },
      }),
      install: async () => ({ ok: false, error: "not_available_in_mock" }),
      start: async () => ({ ok: false, error: "not_available_in_mock" }),
      stop: async () => ({ ok: true, alreadyStopped: true }),
      onInstallProgress: () => () => undefined,
      bundleStatus: async () => ({
        ok: true,
        bundleDir: "/tmp/whisper",
        binary: { installed: false },
        model: { installed: false, name: "ggml-tiny.bin" },
        ready: false,
        message: "Clique em 'Baixar voz offline' para começar",
      }),
      bundleDownload: async () => ({
        ok: false,
        bundleDir: "/tmp/whisper",
        binary: { installed: false },
        model: { installed: false, name: "ggml-tiny.bin" },
        ready: false,
        message: "not_available_in_mock",
        error: "not_available_in_mock",
      }),
      bundleRemove: async () => ({ ok: true }),
      bundleInfo: async () => ({
        bundleDir: "/tmp/whisper",
        binaryUrl: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip",
        modelUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        versions: { whisperCpp: "v1.9.0", model: "ggml-tiny.bin" },
        binaryPath: "/tmp/whisper/whisper-server",
        modelPath: "/tmp/whisper/ggml-tiny.bin",
      }),
      onBundleProgress: () => () => undefined,
      getLogs: async () => ({ logs: [] }),
    },
    env: {
      get: (key: string) => (typeof process !== "undefined" && process.env ? process.env[key] ?? null : null),
      has: (key: string) => Boolean(typeof process !== "undefined" && process.env && process.env[key]),
    },
    // PR 009 — Piloto automático (fallback mock fora do runtime
    // Tauri). Os namespaces `permissions` e `scheduler` ficam
    // disponíveis para a UI consumir em modo navegador; em
    // runtime Tauri o `desktopBridge` sobrescreve estes
    // namespaces com os comandos `permissions_*` e
    // `scheduler_*` reais.
    permissions: {
      ping: async () => new Date().toISOString(),
      getProjectPolicy: async (projectId: string): Promise<ProjectExecutionPolicy> => ({
        projectId,
        defaultMode: "propositivo",
        permissions: {
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
        },
        autopilotEnabled: false,
        requireApprovalForHighRisk: true,
        maxAutopilotSteps: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      updateProjectPolicy: async (
        projectId: string,
        input: UpdateProjectPolicyInput,
      ): Promise<ProjectExecutionPolicy> => ({
        projectId,
        defaultMode: input.defaultMode ?? "propositivo",
        permissions: {
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
          ...(input.permissions ?? {}),
        } as Record<PermissionAction, PermissionDecision>,
        autopilotEnabled: input.autopilotEnabled ?? false,
        requireApprovalForHighRisk: input.requireApprovalForHighRisk ?? true,
        maxAutopilotSteps: input.maxAutopilotSteps ?? 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      listPolicies: async (): Promise<ProjectExecutionPolicy[]> => [],
      resetProjectPolicy: async (projectId: string): Promise<ProjectExecutionPolicy> => ({
        projectId,
        defaultMode: "propositivo",
        permissions: {
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
        },
        autopilotEnabled: false,
        requireApprovalForHighRisk: true,
        maxAutopilotSteps: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      check: async (input: {
        projectId: string;
        action: PermissionAction;
        missionId?: string;
      }): Promise<PermissionCheckResult> => {
        // No browser mock, todas as permissões de leitura
        // básica são `allow` para não bloquear o smoke-test
        // da UI fora do Tauri.
        const decision: PermissionDecision = "allow";
        return {
          action: input.action,
          decision,
          allowed: true,
          requiresApproval: false,
          reason: "Mock: todas as permissões liberadas no navegador.",
        };
      },
    },
    scheduler: {
      ping: async () => new Date().toISOString(),
      listJobs: async (): Promise<MissionJob[]> => [],
      getJob: async (_jobId: string) => null,
      cancelJob: async (
        _input: CancelMissionJobInput,
      ): Promise<MissionJob | null> => null,
    },
    // PR 010 — Patch Engine (fallback mock fora do runtime
    // Tauri). Os namespaces `patches` ficam disponíveis para
    // a UI consumir em modo navegador; em runtime Tauri o
    // `desktopBridge` sobrescreve este namespace com os
    // comandos `patches_*` reais.
    patches: {
      ping: async () => new Date().toISOString(),
      list: async (): Promise<PatchProposal[]> => [],
      get: async (_id: string): Promise<PatchProposal | null> => null,
      listByMission: async (
        _missionId: string,
      ): Promise<PatchProposal[]> => [],
      create: async (
        _input: CreatePatchProposalInput,
      ): Promise<PatchProposal> => {
        throw new Error(
          "Patch Engine só funciona em runtime Tauri. Crie propostas via missions.createAndRun.",
        );
      },
      apply: async (
        _input: ApplyPatchInput,
      ): Promise<PatchProposal> => {
        throw new Error(
          "Patch Engine só funciona em runtime Tauri. Aplique patches via approvals.approve em runtime Tauri.",
        );
      },
      reject: async (
        _id: string,
        _note?: string,
      ): Promise<PatchProposal> => {
        throw new Error(
          "Patch Engine só funciona em runtime Tauri.",
        );
      },
      getChangedFiles: async (
        _workflowRunId: string,
      ): Promise<ChangedFile[]> => [],
      getFileDiff: async (
        _workflowRunId: string,
        _filePath: string,
      ): Promise<FileDiff | null> => null,
    },
  };
}
