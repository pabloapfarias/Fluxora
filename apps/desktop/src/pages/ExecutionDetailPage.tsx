import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  FileText,
  Activity,
  Clock,
  Users,
  FileSearch,
  Info,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  AgentStepOutput,
  AgentStepRecord,
  Approval,
  ApprovalContext,
  BackgroundWorkflowJob,
  ExecutionApproval,
  FluxoraEvent,
  MissionRun,
  MissionLog,
  WorkflowEvent,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStatus,
  WorkflowRerunInput,
  PatchProposal,
  GitCommitResult,
} from "@fluxora/shared";
import { validateApprovalContext } from "@fluxora/shared";
import { ExecutionFlowCard } from "../components/overview/ExecutionFlowCard";
import { EventLog } from "../components/events/EventLog";
import { AgentStepOutputPanel } from "../components/agents/AgentStepOutputPanel";
import { DiffViewer } from "../components/diff/DiffViewer";
import {
  formatExecutionStatus,
  formatExecutionMode,
} from "../lib/presentationLabels";
import { MarkdownRenderer } from "../components/ui";
import { normalizeLogText } from "../lib/logFormatting";

type DetailTab = "resumo" | "agentes" | "logs" | "resultado" | "arquivos" | "aprovacao" | "erros";

/**
 * HOTFIX — Estado unificado da tela de missão.
 *
 * Cada aba (Resumo, Agentes, Logs, Resultado, Arquivos, Aprovação,
 * Erros) lê desta estrutura única, em vez de buscar sua própria
 * verdade em momentos diferentes. A função `loadMissionDetail`
 * é a única que materializa esse estado, e é re-acionada em
 * qualquer evento relevante do barramento `fluxora-event`
 * (`mission/*`, `agent/*`, `patch/*`, `approval/*`,
 * `provider/*`). Um polling leve (5s) atua como fallback para
 * casos em que o evento não chega (ex.: restart do app).
 */
type ChangedFileLite = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

type MissionDetailState = {
  detail: WorkflowRunDetail | null;
  outputs: AgentStepOutput[];
  job: BackgroundWorkflowJob | null;
  approval: Approval | null;
  proposals: PatchProposal[];
  commits: GitCommitResult[];
  changedFiles: ChangedFileLite[];
  errorsCount: number;
  loading: boolean;
  lastFetchAt: number | null;
};

const EMPTY_DETAIL_STATE: MissionDetailState = {
  detail: null,
  outputs: [],
  job: null,
  approval: null,
  proposals: [],
  commits: [],
  changedFiles: [],
  errorsCount: 0,
  loading: false,
  lastFetchAt: null,
};

/**
 * HOTFIX UI E2E — Mapeia `MissionStatus` (canônico do
 * backend) para `WorkflowRunStatus` (legado da UI). Garante
 * que o status exibido na tela de detalhe seja coerente com o
 * que o usuário viu na Central de Comando.
 */
function mapMissionStatusToWorkflow(status: string): WorkflowRunStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

/**
 * HOTFIX UI E2E — Constrói um `WorkflowRunDetail` a partir
 * do `MissionRun` agregado pelo `missions.getDetail`. Preserva
 * a interface legada consumida pelas abas (Resultado, Resumo,
 * etc.), expondo `resultText` e `finalizerOutput` no nível
 * superior para que a aba "Resultado" leia diretamente.
 */
function buildWorkflowRunDetailFromMission(mission: MissionRun): WorkflowRunDetail {
  const base: WorkflowRun = {
    id: mission.id,
    projectId: mission.projectId,
    title: mission.title,
    prompt: mission.prompt,
    generatedContext: JSON.stringify(
      {
        kind: "mission-run",
        mode: mission.mode,
        providerId: mission.providerId,
        model: mission.model,
        currentPhase: mission.currentPhase,
        error: mission.error,
      },
      null,
      2,
    ),
    status: mapMissionStatusToWorkflow(mission.status),
    currentStepId: mission.currentPhase ? `step-${mission.currentPhase}` : undefined,
    executionMode: "real",
    realStrategy: "single",
    resultText: mission.resultText,
    finalizerOutput: mission.resultText,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    completedAt: mission.completedAt,
  };
  return {
    ...base,
    steps: [],
    events: [],
  } as WorkflowRunDetail;
}

/**
 * HOTFIX UI E2E — Converte um `AgentStepRecord` (canônico
 * do Agent Engine) em `AgentStepOutput` (legado da UI).
 * Mantém o mapeamento de status já feito pelo
 * `desktopBridge.toLegacyAgentStepOutput`.
 */
function toLegacyAgentStepOutputLocal(step: AgentStepRecord): AgentStepOutput {
  const legacyStatus: AgentStepOutput["status"] =
    step.status === "completed"
      ? "completed"
      : step.status === "failed"
        ? "failed"
        : step.status === "running" || step.status === "pending"
          ? "running"
          : "cancelled";

  let friendlyName = step.agentName;
  if (!friendlyName) {
    switch (step.role) {
      case "planner":
        friendlyName = "Planner";
        break;
      case "developer":
        friendlyName = "Developer";
        break;
      case "qa":
        friendlyName = "QA";
        break;
      case "finalizer":
        friendlyName = "Finalizer";
        break;
      default:
        friendlyName = step.role;
        break;
    }
  }

  return {
    id: step.id,
    workflowRunId: step.missionId,
    projectId: step.projectId,
    stepId: step.agentId,
    agentRole: step.role,
    agentName: step.agentName,
    name: friendlyName,
    type: step.role as any,
    prompt: step.inputSummary ?? "",
    output: step.outputText ?? step.outputSummary ?? step.error ?? "",
    parsedOutput: step.metadata ? JSON.stringify(step.metadata) : undefined,
    status: legacyStatus,
    startedAt: step.startedAt ?? step.createdAt,
    completedAt: step.completedAt,
  } as AgentStepOutput;
}

/**
 * HOTFIX UI E2E — Converte `ExecutionApproval` (canônico
 * novo) em `Approval` (legado da UI). Replica o
 * `toLegacyApproval` do `desktopBridge` para uso local na
 * página, evitando dependência circular.
 */
function toLegacyApprovalLocal(input: ExecutionApproval): Approval {
  const impact: Approval["impact"] =
    (input.risk as Approval["impact"]) ?? "medium";
  const status: Approval["status"] =
    input.status === "expired" || input.status === "cancelled"
      ? "rejected"
      : (input.status as Approval["status"]);
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    impact,
    status,
    projectId: input.projectId,
    workflowRunId: input.missionId,
    createdAt: input.createdAt,
    resolvedAt: input.resolvedAt,
    action: input.action,
  } as Approval;
}

/**
 * HOTFIX UI E2E — Converte `MissionLog` em `WorkflowEvent`
 * para a aba Logs continuar exibindo os eventos da missão.
 */
function missionLogToWorkflowEvent(log: MissionLog): WorkflowEvent {
  return {
    id: log.id,
    workflowRunId: log.missionId,
    projectId: undefined,
    type: log.phase ?? "log",
    message: log.message,
    metadata: log.payload !== undefined ? JSON.stringify(log.payload) : undefined,
    createdAt: log.timestamp,
  };
}

/**
 * Log temporário seguro do estado unificado da missão. Não
 * inclui API key nem conteúdo de arquivos — apenas
 * identificadores e contadores, úteis para a fase 13 da hotfix.
 */
function logMissionDetailSnapshot(workflowId: string, state: MissionDetailState) {
  try {
    console.info("[Fluxora Mission Detail]", {
      missionId: workflowId,
      status: state.detail?.status,
      currentPhase: state.detail?.currentStepId,
      stepsCount: state.outputs.length,
      eventsCount: state.detail?.events?.length ?? 0,
      patchesCount: state.proposals.length,
      changedFilesCount: state.changedFiles.length,
      approvalsCount: state.approval ? 1 : 0,
      errorsCount: state.errorsCount,
    });
  } catch {
    // noop
  }
}

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialTab = (searchParams.get("tab") as DetailTab) || "resumo";
  const initialStepId = searchParams.get("step");

  // HOTFIX — Estado unificado. Substitui os 6 useState
  // anteriores (detail/outputs/job/approval/proposals/commits)
  // para garantir que cada aba veja a mesma versão do estado
  // da missão.
  const [state, setState] = useState<MissionDetailState>(EMPTY_DETAIL_STATE);
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [selectedAgentStepId, setSelectedAgentStepId] = useState<string | null>(initialStepId);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [approvalActionLoading, setApprovalActionLoading] = useState<"approve" | "reject" | null>(null);
  const [rerunModalOpen, setRerunModalOpen] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);

  // Detalhes derivados (memória) para evitar recomputações.
  const { detail, outputs, job, approval, proposals, commits, changedFiles } = state;

  useEffect(() => {
    const qTab = searchParams.get("tab") as DetailTab;
    const qStep = searchParams.get("step");
    if (qTab) setTab(qTab);
    if (qStep) setSelectedAgentStepId(qStep);
  }, [searchParams]);

  /**
   * HOTFIX UI E2E — Carrega o estado unificado da missão.
   *
   * Fonte primária: `window.fluxora.missions.getDetail(id)`,
   * que devolve `MissionDetail` (mission + steps + logs +
   * patches + arquivos + aprovações + erros) numa única
   * chamada. Cada aba (Resumo, Agentes, Logs, Resultado,
   * Arquivos, Aprovação, Erros) lê desta estrutura.
   *
   * Fallback: `workflows.get` + agregados paralelos, usado
   * quando o bridge não está em runtime Tauri (smoke-test em
   * browser) ou quando o `getDetail` falha.
   */
  const loadMissionDetail = useCallback(async (workflowId: string) => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const detailRecord = await window.fluxora.missions.getDetail(workflowId);
      if (detailRecord) {
        // Caminho canônico: MissionDetail agregado.
        const jobs = await window.fluxora.workflows.listJobs().catch(() => [] as BackgroundWorkflowJob[]);
        const comms = window.fluxora.git?.listMissionCommits
          ? await window.fluxora.git.listMissionCommits(workflowId).catch(() => [] as GitCommitResult[])
          : ([] as GitCommitResult[]);
        const activeJob =
          jobs.find(
            (entry) =>
              entry.workflowRunId === workflowId &&
              ["queued", "running"].includes(entry.status)
          ) || null;
        const pendingExecution = detailRecord.approvals.find(
          (a) => a.status === "pending",
        );
        const foundApproval = pendingExecution
          ? toLegacyApprovalLocal(pendingExecution)
          : detailRecord.approvals[0]
            ? toLegacyApprovalLocal(detailRecord.approvals[0])
            : null;
        const baseDetail = buildWorkflowRunDetailFromMission(detailRecord.mission);
        // Popula `events` (a partir dos logs) e `steps` (a
        // partir dos steps reais) do WorkflowRunDetail para
        // que a aba Logs/Timeline os veja.
        baseDetail.events = detailRecord.logs.map((log) =>
          missionLogToWorkflowEvent(log),
        );
        baseDetail.steps = detailRecord.steps.map((step) => {
          const legacy = toLegacyAgentStepOutputLocal(step) as any;
          return {
            id: legacy.id,
            workflowRunId: legacy.workflowRunId,
            name: legacy.name || step.agentName,
            type: legacy.type || "developer",
            agentId: step.agentId,
            status: legacy.status === "running" ? "running" : legacy.status === "failed" ? "failed" : "completed",
            startedAt: legacy.startedAt,
            completedAt: legacy.completedAt,
            output: legacy.output,
          };
        });
        const next: MissionDetailState = {
          detail: baseDetail,
          outputs: detailRecord.steps.map((step) =>
            toLegacyAgentStepOutputLocal(step),
          ),
          job: activeJob,
          approval: foundApproval,
          proposals: detailRecord.patches,
          commits: comms,
          changedFiles: (detailRecord.changedFiles || []) as ChangedFileLite[],
          errorsCount: detailRecord.errors.length,
          loading: false,
          lastFetchAt: Date.now(),
        };
        setState(next);
        logMissionDetailSnapshot(workflowId, next);
        return;
      }
      // Fallback (sem Tauri runtime ou `getDetail` indisponível).
      const [d, agentOutputs, jobs, approvals, props, comms, files] = await Promise.all([
        window.fluxora.workflows.get(workflowId),
        window.fluxora.workflows.listAgentOutputs(workflowId),
        window.fluxora.workflows.listJobs().catch(() => [] as BackgroundWorkflowJob[]),
        window.fluxora.approvals.list().catch(() => [] as Approval[]),
        window.fluxora.patches?.listByMission
          ? window.fluxora.patches.listByMission(workflowId).catch(() => [] as PatchProposal[])
          : Promise.resolve([] as PatchProposal[]),
        window.fluxora.git?.listMissionCommits
          ? window.fluxora.git.listMissionCommits(workflowId).catch(() => [] as GitCommitResult[])
          : Promise.resolve([] as GitCommitResult[]),
        window.fluxora.git.changedFiles(workflowId).catch(() => [] as ChangedFileLite[]),
      ]);
      const activeJob =
        jobs.find(
          (entry) =>
            entry.workflowRunId === workflowId &&
            ["queued", "running"].includes(entry.status)
        ) || null;
      const foundApproval = d.finalApprovalId
        ? approvals.find((a) => a.id === d.finalApprovalId)
        : approvals.find((a) => a.workflowRunId === workflowId) || null;
      const errCount = (d.events ?? []).filter(
        (e) =>
          e.type.includes("failed") ||
          e.type.includes("error") ||
          e.type.includes("ERRO") ||
          e.type === "workflow.failed" ||
          e.type === "workflow.real.failed" ||
          e.type === "workflow.multi_agent.failed" ||
          e.type === "patch/apply-failed" ||
          e.type === "approval/rejected"
      ).length;
      const next: MissionDetailState = {
        detail: d,
        outputs: agentOutputs,
        job: activeJob,
        approval: foundApproval ?? null,
        proposals: props,
        commits: comms,
        changedFiles: files,
        errorsCount: errCount,
        loading: false,
        lastFetchAt: Date.now(),
      };
      setState(next);
      logMissionDetailSnapshot(workflowId, next);
    } catch (error) {
      // HOTFIX — Falha de carga: registrar no console sem
      // alterar os outros campos (mantém o estado anterior
      // visível para o usuário).
      console.warn("[Fluxora Mission Detail] loadMissionDetail falhou", {
        missionId: workflowId,
        error: error instanceof Error ? error.message : String(error),
      });
      setState((prev) => ({ ...prev, loading: false, lastFetchAt: Date.now() }));
    }
  }, []);

  // HOTFIX — Carregamento inicial + sincronização por evento.
  // O barramento `fluxora-event` é a fonte primária de refresh;
  // o polling de 5s é fallback para misses de evento.
  useEffect(() => {
    if (!id) return;
    loadMissionDetail(id);
    const interval = setInterval(() => {
      if (id) loadMissionDetail(id);
    }, 5000);
    const unsubscribe = window.fluxora.events.subscribe((event) => {
      if (!shouldRefreshOn(event)) return;
      if (event.missionId && event.missionId !== id) return;
      // Quando o evento não tem missionId (ex.: patch/proposal-created
      // com projectId apenas), ainda recarregamos se o id for o
      // afetado — o backend filtra pelo missionId no estado.
      if (id) loadMissionDetail(id);
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [id, loadMissionDetail]);

  const isControlledExecution = useMemo(() => {
    if (!detail?.generatedContext) return false;
    try {
      const ctx = JSON.parse(detail.generatedContext);
      return ctx.kind === "controlled_execution";
    } catch {
      return false;
    }
  }, [detail?.generatedContext]);

  const isMultiAgent = detail?.realStrategy === "multi_agent";
  const isReal = detail?.executionMode === "real";

  const appliedProposal = useMemo(() => proposals.find((p) => p.status === "applied"), [proposals]);
  const commitInfo = useMemo(() => appliedProposal ? commits.find((c) => c.patchProposalId === appliedProposal.id && c.status === "committed") : null, [appliedProposal, commits]);
  const pendingCommitInfo = useMemo(() => appliedProposal ? commits.find((c) => c.patchProposalId === appliedProposal.id && c.status === "pending_approval") : null, [appliedProposal, commits]);
  const failedCommitInfo = useMemo(() => appliedProposal ? commits.find((c) => c.patchProposalId === appliedProposal.id && c.status === "failed") : null, [appliedProposal, commits]);

  // Extrair erros dos eventos
  const errorEvents = useMemo(() => {
    if (!detail?.events) return [];
    return detail.events.filter(
      (e) =>
        e.type.includes("failed") ||
        e.type.includes("error") ||
        e.type.includes("ERRO") ||
        e.type === "workflow.failed" ||
        e.type === "workflow.real.failed" ||
        e.type === "workflow.multi_agent.failed" ||
        e.type === "patch/apply-failed" ||
        e.type === "approval/rejected"
    );
  }, [detail?.events]);

  // Extrair resultado da missão — derivado do `resultText` real
  // (PR 008/011 gravam em `MissionRun.resultText` e a PR 016
  // propaga via `desktopBridge.toWorkflowRun`), com fallback
  // para o evento `mission.result` consolidado emitido no
  // momento da conclusão.
  const missionResult = useMemo(() => {
    if (detail?.resultText) return detail.resultText;
    if (detail?.finalizerOutput) return detail.finalizerOutput;
    if (!detail?.events) return null;
    const resultEvents = detail.events
      .filter((e) => e.type === "mission.result")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return resultEvents.length > 0 ? resultEvents[resultEvents.length - 1].message : null;
  }, [detail?.resultText, detail?.finalizerOutput, detail?.events]);

  // Contar erros para badge — usa o contador já materializado
  // em `MissionDetailState.errorsCount` para evitar divergência
  // entre abas.
  const errorCount = state.errorsCount;

  async function handleCancel() {
    if (!job) return;
    const confirmed = window.confirm(
      "Tem certeza que deseja cancelar esta execução?\nAs alterações já feitas no diretório do projeto não serão revertidas automaticamente."
    );
    if (!confirmed) return;
    await window.fluxora.workflows.cancelJob(job.id);
  }

  async function handleApproveApproval() {
    if (!approval) return;
    setApprovalActionLoading("approve");
    setFeedback(null);
    try {
      const updated = approval.workflowRunId
        ? await window.fluxora.workflows.approveFinal(approval.workflowRunId)
        : await window.fluxora.approvals.approve(approval.id);
      setState((prev) => ({ ...prev, approval: updated }));
      setFeedback({ kind: "success", message: "Aprovação concedida com sucesso." });
      // HOTFIX — Recarrega o estado unificado após aprovar.
      // Quando o backend dispara `patches_apply` automaticamente
      // (PR 010), os eventos `patch/apply-started` /
      // `patch/file-applied` / `patch/apply-completed` ou
      // `patch/apply-failed` farão a sincronização via
      // barramento. Mesmo assim, forçamos uma recarga adicional
      // para garantir que o `appliedProposal` / `changedFiles`
      // apareçam sincronizados em todas as abas.
      if (id) await loadMissionDetail(id);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha ao aprovar.",
      });
    } finally {
      setApprovalActionLoading(null);
    }
  }

  async function handleRejectApproval() {
    if (!approval) return;
    const confirmed = window.confirm(
      "Tem certeza que deseja rejeitar esta aprovação?\nAs alterações já feitas no diretório do projeto não serão revertidas automaticamente."
    );
    if (!confirmed) return;
    setApprovalActionLoading("reject");
    setFeedback(null);
    try {
      const updated = approval.workflowRunId
        ? await window.fluxora.workflows.rejectFinal(approval.workflowRunId)
        : await window.fluxora.approvals.reject(approval.id);
      setState((prev) => ({ ...prev, approval: updated }));
      setFeedback({ kind: "success", message: "Aprovação rejeitada." });
      if (id) await loadMissionDetail(id);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha ao rejeitar.",
      });
    } finally {
      setApprovalActionLoading(null);
    }
  }

  async function handleRerun(overrides: WorkflowRerunInput) {
    if (!id) return;
    setRerunModalOpen(false);
    try {
      const result = await window.fluxora.workflows.rerun(id, overrides);
      // Navega para o novo workflow run criado pela reexecução.
      navigate(`/executions/${result.workflowRunId}`);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha ao reexecutar.",
      });
    }
  }

  if (!detail) {
    return <div className="text-text-muted">Carregando...</div>;
  }

  // Calcular duração
  const startedAt = detail.events?.[0]?.createdAt;
  const completedAt = detail.completedAt;
  const duration =
    startedAt && completedAt
      ? formatDuration(new Date(startedAt).getTime(), new Date(completedAt).getTime())
      : startedAt
      ? formatDuration(new Date(startedAt).getTime(), Date.now())
      : null;

  const lastEvent = detail.events?.[detail.events.length - 1];

  // Tabs configuration
  const tabs: { id: DetailTab; label: string; icon: typeof FileText; count?: number }[] = [
    { id: "resumo", label: "Resumo", icon: Info },
    { id: "agentes", label: "Agentes", icon: Users },
    { id: "logs", label: "Logs", icon: Activity },
    { id: "resultado", label: "Resultado", icon: FileText },
    { id: "arquivos", label: "Arquivos", icon: FileSearch },
    { id: "aprovacao", label: "Aprovação", icon: ShieldCheck },
    { id: "erros", label: "Erros", icon: AlertTriangle, count: errorCount || undefined },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/executions")}
          className="text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold">{detail.title}</h1>
        <span
          className={`text-xs px-2 py-1 rounded ${
            detail.status === "completed"
              ? "bg-success/10 text-success"
              : detail.status === "cancelled"
              ? "bg-warning/10 text-warning"
              : detail.status === "running"
              ? "bg-accent/10 text-accent"
              : detail.status === "failed"
              ? "bg-error/10 text-error"
              : "bg-warning/10 text-warning"
          }`}
        >
          {formatExecutionStatus(detail.status)}
        </span>
        {job && ["queued", "running"].includes(job.status) && (
          <button onClick={handleCancel} className="no-drag flux-btn-danger h-9 text-[12px]">
            Cancelar execução
          </button>
        )}
        {canRerun(detail.status) && (
          <button
            onClick={() => setRerunModalOpen(true)}
            className="no-drag flux-btn-primary h-9 text-[12px] flex items-center gap-1.5"
            title="Reexecutar esta missão (com overrides opcionais)"
          >
            <RotateCcw size={14} />
            Reexecutar
          </button>
        )}
      </div>

      {rerunModalOpen && detail && (
        <RerunModal
          run={detail}
          onClose={() => setRerunModalOpen(false)}
          onSubmit={handleRerun}
        />
      )}

      {commitModalOpen && detail && appliedProposal && (
        <CommitModal
          projectId={detail.projectId || ""}
          missionId={detail.id}
          patchProposalId={appliedProposal.id}
          patchFiles={appliedProposal.files.map(f => f.path)}
          missionTitle={detail.title}
          onClose={() => setCommitModalOpen(false)}
          onSuccess={(result) => {
            setState((prev) => ({
              ...prev,
              commits: [...prev.commits.filter((c) => c.id !== result.id), result],
            }));
          }}
        />
      )}

      {/* Visual execution timeline */}
      <ExecutionFlowCard
        run={detail}
        activeJob={job && ["queued", "running"].includes(job.status) ? job : null}
        events={detail.events}
        onSelectStep={(stepId) => {
          setTab("agentes");
          setSelectedAgentStepId(stepId);
        }}
      />

      {/* Tab bar */}
      <div
        className="flex items-center gap-1 border-b border-border-subtle overflow-x-auto"
        role="tablist"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={`no-drag relative flex items-center gap-2 px-4 py-3 text-[12px] font-semibold tracking-wide transition-colors whitespace-nowrap ${
                isActive
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <Icon size={14} />
              {t.label}
              {t.count !== undefined && (
                <span className="text-[9.5px] px-1.5 py-px rounded-md font-bold tabular-nums bg-error/15 text-error border border-error/25">
                  {t.count}
                </span>
              )}
              {isActive && (
                <span
                  className="absolute left-2 right-2 -bottom-px h-px rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-[200px]">
        {/* ── Resumo ── */}
        {tab === "resumo" && (
          <div className="bg-bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-text-primary mb-3">Resumo da Missão</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryItem label="Missão" value={detail.title} />
              <SummaryItem
                label="Modo"
                value={
                  isMultiAgent
                    ? "Multiagente"
                    : isReal
                    ? "Real"
                    : formatExecutionMode(detail.executionMode || "simulated")
                }
              />
              <SummaryItem label="Status" value={formatExecutionStatus(detail.status)} tone={statusTone(detail.status)} />
              <SummaryItem label="Projeto" value={detail.projectId || "—"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryItem
                label="Início"
                value={startedAt ? new Date(startedAt).toLocaleString("pt-BR") : "—"}
              />
              <SummaryItem label="Duração" value={duration || "—"} />
              <SummaryItem
                label="Último evento"
                value={lastEvent ? lastEvent.message.slice(0, 80) : "—"}
              />
              <SummaryItem label="Estratégia" value={isMultiAgent ? "Multiagente" : "Simples"} />
            </div>

            {/* Prompt original */}
            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1.5">
                Prompt Original
              </div>
              <p className="text-sm bg-bg-primary p-3 rounded-lg font-mono">{detail.prompt}</p>
            </div>

            {/* Git controlled local commit section (PR 016) */}
            {appliedProposal && (
              <div className="mt-4 border-t border-border-subtle pt-4 space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Alterações aplicadas
                </div>
                <div className="bg-bg-deep/40 border border-border-subtle rounded-lg p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-[13px] font-medium text-text-primary">
                        Arquivos criados/modificados: {appliedProposal.files.length}
                      </div>
                      <div className="text-[12px] text-text-secondary">
                        {commitInfo ? (
                          <span className="flex items-center gap-1.5 text-success">
                            Commit local criado: <span className="font-mono bg-success/15 px-1 py-px rounded">{commitInfo.commitHash?.slice(0, 7)}</span>
                            {commitInfo.branch && (
                              <span className="text-text-muted">
                                (Branch: <span className="font-mono text-text-secondary">{commitInfo.branch}</span>)
                              </span>
                            )}
                          </span>
                        ) : pendingCommitInfo ? (
                          <span className="flex items-center gap-1.5 text-warning animate-pulse">
                            Commit local aguardando aprovação... (ID: {pendingCommitInfo.approvalId?.slice(0, 10)})
                          </span>
                        ) : failedCommitInfo ? (
                          <span className="flex flex-col gap-1 text-error">
                            <span>Falha ao criar commit local: {failedCommitInfo.error}</span>
                            <button
                              onClick={() => setCommitModalOpen(true)}
                              className="text-[11px] text-accent hover:underline text-left mt-0.5"
                            >
                              Tentar novamente
                            </button>
                          </span>
                        ) : (
                          <span className="text-text-muted">Commit local: não criado</span>
                        )}
                      </div>
                    </div>
                    {!commitInfo && !pendingCommitInfo && (
                      <button
                        onClick={() => setCommitModalOpen(true)}
                        className="no-drag flux-btn-secondary h-8 px-3 text-[12px]"
                      >
                        Criar commit local
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Agentes ── */}
        {tab === "agentes" && (
          <div className="bg-bg-card border border-border rounded-xl p-5">
            {isMultiAgent || outputs.length > 0 ? (
              <AgentStepOutputPanel outputs={outputs} initialOpenStepId={selectedAgentStepId} />
            ) : (
              <div className="text-[13px] text-text-muted py-8 text-center">
                Esta missão não registrou steps detalhados de agentes.
              </div>
            )}
          </div>
        )}

        {/* ── Logs ── */}
        {tab === "logs" && (
          <EventLog events={detail.events} workflowRunId={detail.id} />
        )}

        {/* ── Resultado ── */}
        {tab === "resultado" && (
          <MissionResultSection
            missionResult={missionResult}
            runResultText={detail.resultText || detail.finalizerOutput}
            events={detail.events}
            activeRun={detail}
          />
        )}

        {/* ── Arquivos ── */}
        {tab === "arquivos" && (
          <ChangedFilesSection workflowRunId={detail.id} files={changedFiles} />
        )}

        {/* ── Aprovação ── */}
        {tab === "aprovacao" && (
          <ApprovalSection
            approval={approval}
            runPrompt={detail.prompt}
            onApprove={handleApproveApproval}
            onReject={handleRejectApproval}
            loading={approvalActionLoading}
            feedback={feedback}
            events={detail.events}
            isControlledExecution={isControlledExecution}
            proposal={proposals[0] || null}
          />
        )}

        {/* ── Erros ── */}
        {tab === "erros" && (
          <ErrorsSection errors={errorEvents} />
        )}
      </div>
    </div>
  );
}

// ─── Summary Item ─────────────────────────────────────────────────────

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-deep p-3">
      <div className="text-[10.5px] text-text-muted mb-1">{label}</div>
      <div className={`text-[12.5px] font-medium ${tone || "text-text-primary"}`}>{value}</div>
    </div>
  );
}

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "text-success";
    case "failed":
      return "text-error";
    case "running":
      return "text-accent";
    case "pending_approval":
      return "text-warning";
    case "cancelled":
      return "text-warning";
    default:
      return "text-text-primary";
  }
}

// ─── Mission Result Section ───────────────────────────────────────────

function MissionResultSection({
  missionResult,
  runResultText,
  events,
  activeRun,
}: {
  missionResult: string | null;
  runResultText?: string;
  events: WorkflowEvent[];
  activeRun: WorkflowRunDetail;
}) {
  const isError = activeRun.status === "failed";
  const isRunning =
    activeRun.status === "running" ||
    activeRun.status === "queued" ||
    activeRun.status === "approved" ||
    activeRun.status === "pending_approval";
  // HOTFIX UI E2E — Fonte única canônica para a aba "Resultado":
  //   1. `runResultText` (vindo de `WorkflowRun.resultText` /
  //      `finalizerOutput` — propagado de `MissionRun.resultText`)
  //   2. `missionResult` (evento `mission.result` consolidado)
  // Nunca caímos em stream chunks do provider — esse era o
  // bug que fazia a aba mostrar texto parcial ou logs.
  const resultText = runResultText || missionResult || null;
  const hasResult = typeof resultText === "string" && resultText.trim().length > 0;

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
            isError ? "bg-error-soft border-error/25" : isRunning ? "bg-accent-soft border-accent/25" : "bg-success-soft border-success/25"
          }`}
        >
          <FileText size={15} className={isError ? "text-error" : isRunning ? "text-accent" : "text-success"} />
        </div>
        <div className="flex-1">
          <span className="text-[13px] font-semibold text-text-primary">
            {isError ? "Erro da missão" : isRunning ? "Aguardando conclusão da missão..." : "Resultado da missão"}
          </span>
        </div>
        {hasResult && (
          <span className="text-[11px] text-text-muted">
            {resultText.length.toLocaleString("pt-BR")} caracteres
          </span>
        )}
      </div>
      <div className="p-5">
        {hasResult ? (
          <div className="text-[13px] text-text-secondary max-h-[500px] overflow-auto">
            <MarkdownRenderer content={resultText} />
          </div>
        ) : isError ? (
          <div className="text-[13px] text-error">A execução falhou. Verifique a aba Erros para mais detalhes.</div>
        ) : isRunning ? (
          <div className="text-[13px] text-text-muted py-8 text-center">
            Aguardando conclusão da missão...
          </div>
        ) : (
          <div className="text-[13px] text-text-muted py-8 text-center">
            Nenhum resultado registrado. A missão foi concluída sem texto consolidado.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Changed Files Section ────────────────────────────────────────────

function ChangedFilesSection({
  workflowRunId,
  files: initialFiles,
}: {
  workflowRunId: string;
  files?: ChangedFileLite[];
}) {
  const [files, setFiles] = useState<ChangedFileLite[]>(initialFiles ?? []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, string | null>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

  useEffect(() => {
    // HOTFIX — Recebe os arquivos via props (vem do estado
    // unificado). Só faz fallback para `git.changedFiles`
    // quando a prop não foi fornecida (caso edge em que o
    // componente é montado fora do `ExecutionDetailPage`).
    if (initialFiles !== undefined) {
      setFiles(initialFiles);
      return;
    }
    let mounted = true;
    window.fluxora.git
      .changedFiles(workflowRunId)
      .then((f) => {
        if (mounted) setFiles(f as ChangedFileLite[]);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [workflowRunId, initialFiles]);

  const expandFile = async (path: string) => {
    if (expanded === path) {
      setExpanded(null);
      return;
    }
    setExpanded(path);
    if (diffCache[path] !== undefined) return;
    setLoadingDiff(path);
    try {
      const fd = await window.fluxora.git.fileDiff(workflowRunId, path);
      setDiffCache((prev) => ({ ...prev, [path]: fd?.diff || `Sem diff para ${path}` }));
    } catch (err) {
      setDiffCache((prev) => ({
        ...prev,
        [path]: `Erro ao carregar diff: ${err instanceof Error ? err.message : "erro"}`,
      }));
    } finally {
      setLoadingDiff(null);
    }
  };

  if (files.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="text-[13px] text-text-muted py-8 text-center">
          Nenhum arquivo alterado detectado.
        </div>
      </div>
    );
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">
          Arquivos alterados ({files.length})
        </h3>
        <span className="text-[11px] text-text-muted font-mono">
          +{totalAdditions}/-{totalDeletions}
        </span>
      </div>

      <div className="space-y-1 max-h-[500px] overflow-auto">
        {files.map((f) => {
          const isOpen = expanded === f.path;
          return (
            <div key={f.path} className="rounded-lg border border-border-subtle overflow-hidden">
              <button
                onClick={() => expandFile(f.path)}
                className="no-drag w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left"
              >
                <span className="font-mono text-[11.5px] text-text-primary flex-1 truncate">
                  {f.path}
                </span>
                <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0 font-mono">
                  +{f.additions}/-{f.deletions}
                </span>
                <span
                  className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                    f.status === "added"
                      ? "bg-success/10 text-success"
                      : f.status === "modified"
                      ? "bg-accent/10 text-accent"
                      : f.status === "deleted"
                      ? "bg-error/10 text-error"
                      : "bg-bg-input text-text-muted"
                  }`}
                >
                  {f.status}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border-subtle p-2 max-h-96 overflow-auto">
                  {loadingDiff === f.path ? (
                    <div className="text-[11px] text-text-muted py-3 text-center font-mono">
                      Carregando diff...
                    </div>
                  ) : (
                    <DiffViewer diff={diffCache[f.path] || ""} filePath={f.path} maxLines={500} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Approval Section ─────────────────────────────────────────────────

function ApprovalSection({
  approval,
  runPrompt,
  onApprove,
  onReject,
  loading,
  feedback,
  events,
  isControlledExecution,
  proposal,
}: {
  approval: Approval | null;
  runPrompt?: string;
  onApprove: () => void;
  onReject: () => void;
  loading: "approve" | "reject" | null;
  feedback: { kind: "success" | "error"; message: string } | null;
  events: WorkflowEvent[];
  isControlledExecution: boolean;
  proposal?: PatchProposal | null;
}) {
  const isPending = approval?.status === "pending";

  // Validar contexto da aprovação
  const approvalCtx = useMemo(
    () => (approval ? validateApprovalContext(approval, { runPrompt }) : null),
    [approval, runPrompt]
  );

  if (!approval && !proposal && !isControlledExecution) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="text-[13px] text-text-muted py-8 text-center">
          Nenhuma aprovação pendente para esta execução.
        </div>
      </div>
    );
  }

  const canApprove = approvalCtx?.canApprove !== false;

  return (
    <div className="space-y-4">
      {/* Alerta de contexto insuficiente */}
      {isPending && !canApprove && (
        <div className="rounded-xl border border-error/30 bg-error-soft/10 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-error flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[14px] font-semibold text-error">Aprovação inválida: contexto insuficiente</div>
              <div className="text-[12px] text-text-secondary mt-1">
                O sistema não conseguiu determinar o que precisa ser aprovado.
                Abra os detalhes da execução para revisar os logs.
              </div>
            </div>
          </div>
        </div>
      )}

      {approval && (
        <div
          className={`rounded-xl border p-5 ${
            approval.status === "approved"
              ? "border-success/30 bg-success-soft/20"
              : approval.status === "rejected"
              ? "border-error/30 bg-error/10"
              : !canApprove
              ? "border-error/30 bg-error-soft/5"
              : "border-warning/30 bg-warning-soft/20"
          }`}
        >
          <div className="flex items-start gap-3 mb-3">
            {approval.status === "approved" ? (
              <CheckCircle2 size={18} className="text-success flex-shrink-0" />
            ) : approval.status === "rejected" ? (
              <XCircle size={18} className="text-error flex-shrink-0" />
            ) : !canApprove ? (
              <AlertTriangle size={18} className="text-error flex-shrink-0" />
            ) : (
              <AlertTriangle size={18} className="text-warning flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-text-primary">
                {approval.status === "approved"
                  ? "Aprovação concedida"
                  : approval.status === "rejected"
                  ? "Aprovação rejeitada"
                  : !canApprove
                  ? "Aprovação com contexto insuficiente"
                  : "Aprovação pendente"}
              </div>
              <div className="text-[12px] text-text-secondary mt-0.5">{approval.title}</div>
            </div>
          </div>

          {/* Descrição rica */}
          {approval.description && (
            <div className="rounded-lg border border-border-subtle bg-bg-deep/40 p-4 mb-3">
              {approval.description.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={`text-[12px] leading-relaxed ${
                    line.startsWith("- ")
                      ? "text-text-primary font-mono ml-2"
                      : line.startsWith("Arquivos") ||
                        line.startsWith("Resumo") ||
                        line.startsWith("Impacto") ||
                        line.startsWith("Agente") ||
                        line.startsWith("Missão") ||
                        line.startsWith("Motivo") ||
                        line.startsWith("QA") ||
                        line.startsWith("Planner") ||
                        line.startsWith("Developer") ||
                        line.startsWith("Projeto")
                      ? "text-text-secondary font-semibold"
                      : line.match(/^\d+\.\s/)
                      ? "text-text-primary ml-2"
                      : line.trim() === ""
                      ? "h-2"
                      : "text-text-muted"
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Mensagem clara solicitada na Fase 6 */}
          {isPending && canApprove && (
            <div className="text-[12px] text-warning mb-3 font-semibold">
              Proposta criada. Aprove para aplicar os arquivos.
            </div>
          )}

          {/* Ações — só mostra Aprovar/Rejeitar se canApprove */}
          {isPending && canApprove && (
            <div className="flex items-center gap-2">
              <button
                onClick={onApprove}
                disabled={loading !== null}
                className="no-drag flux-btn-success h-10 px-4 text-[12.5px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={14} /> Aprovar
              </button>
              <button
                onClick={onReject}
                disabled={loading !== null}
                className="no-drag flux-btn-danger h-10 px-4 text-[12.5px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <XCircle size={14} /> Rejeitar
              </button>
            </div>
          )}

          {/* Quando não pode aprovar, mostrar ação alternativa */}
          {isPending && !canApprove && (
            <div className="text-[11px] text-text-muted">
              Esta aprovação não pode ser aprovada ou rejeitada porque o contexto é insuficiente.
            </div>
          )}

          {feedback && (
            <div
              className={`mt-3 rounded-md border px-2.5 py-1.5 text-[11.5px] flex items-center gap-2 ${
                feedback.kind === "success"
                  ? "border-success/30 bg-success-soft/30 text-text-primary"
                  : "border-error/30 bg-error/10 text-text-primary"
              }`}
            >
              {feedback.kind === "success" ? (
                <CheckCircle2 size={12} className="text-success" />
              ) : (
                <XCircle size={12} className="text-error" />
              )}
              {feedback.message}
            </div>
          )}
        </div>
      )}

      {/* Confirmação de arquivos (Fase 14 — HOTFIX) */}
      {proposal && (
        <div className="space-y-3">
          {proposal.status === "applied" && (
            <div className="rounded-xl border border-success/30 bg-success-soft/20 p-5">
              <div className="text-[13px] font-semibold text-success mb-2">
                Arquivos aplicados no projeto:
              </div>
              {proposal.projectPath && (
                <div className="text-[11px] text-text-muted mb-2 font-mono break-all">
                  Caminho: {proposal.projectPath}
                </div>
              )}
              <ul className="space-y-1 font-mono text-[12px] text-text-primary">
                {(proposal.filesWritten && proposal.filesWritten.length > 0
                  ? proposal.filesWritten
                  : proposal.files.map((f) => f.path)
                ).map((file) => (
                  <li key={file}>- {file}</li>
                ))}
              </ul>
              {proposal.appliedAt && (
                <div className="text-[10.5px] text-text-muted mt-2">
                  Aplicado em: {new Date(proposal.appliedAt).toLocaleString("pt-BR")}
                </div>
              )}
            </div>
          )}

          {proposal.status === "failed" && (
            <div className="rounded-xl border border-error/30 bg-error/10 p-5">
              <div className="text-[13px] font-semibold text-error mb-2">
                Falha ao aplicar arquivos:
              </div>
              {proposal.error && (
                <div className="text-[12px] text-text-secondary mb-2 font-mono break-all">
                  {proposal.error}
                </div>
              )}
              {proposal.projectPath && (
                <div className="text-[11px] text-text-muted mb-2 font-mono break-all">
                  Caminho: {proposal.projectPath}
                </div>
              )}
              <ul className="space-y-1 font-mono text-[12px] text-error">
                {(proposal.filesMissing && proposal.filesMissing.length > 0
                  ? proposal.filesMissing
                  : proposal.files.map((f) => f.path)
                ).map((file) => (
                  <li key={file}>- {file.endsWith("após escrita") ? file : `${file} não encontrado após escrita`}</li>
                ))}
              </ul>
            </div>
          )}

          {proposal.status === "pending_approval" && (
            <div className="rounded-xl border border-warning/30 bg-warning-soft/20 p-5">
              <div className="text-[13px] font-semibold text-warning mb-2">
                Aguardando aprovação:
              </div>
              <ul className="space-y-1 font-mono text-[12px] text-text-secondary">
                {proposal.files.map((f) => (
                  <li key={f.path}>- {f.path}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Errors Section ───────────────────────────────────────────────────

interface ParsedErrorMeta {
  category?: string;
  status?: string;
  exitCode?: number | null;
  durationMs?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  model?: string | null;
  stderrTail?: string | null;
  stdoutTail?: string | null;
  stderrLength?: number;
  stdoutLength?: number;
  role?: string;
  failedRole?: string;
  developerRole?: string;
  fixAttempt?: number;
  usedFallback?: boolean;
  finalArgs?: string[];
  details?: ParsedErrorMeta;
  error?: string;
  phase?: string;
  stack?: string;
}

function parseErrorMetadata(raw?: string): ParsedErrorMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedErrorMeta;
  } catch {
    return null;
  }
}

function ErrorEventCard({ event }: { event: WorkflowEvent }) {
  const origin = event.type.includes("opencode")
    ? "Provider stream"
    : event.type.includes("multi_agent")
    ? "MultiAgentRunner"
    : event.type.includes("controlled_execution")
    ? "ControlledExecution"
    : event.type.includes("git")
    ? "Git"
    : event.type.includes("workflow")
    ? "Workflow"
    : event.type.includes("developer")
    || event.type.includes("planner")
    || event.type.includes("qa")
    || event.type.includes("fix")
    ? "Agente"
    : "Sistema";

  const meta = parseErrorMetadata(event.metadata);
  const nestedDetails = meta?.details && typeof meta.details === "object" ? meta.details : null;
  const stderrTail = meta?.stderrTail ?? nestedDetails?.stderrTail ?? null;
  const stdoutTail = meta?.stdoutTail ?? nestedDetails?.stdoutTail ?? null;
  const exitCode = meta?.exitCode ?? nestedDetails?.exitCode;
  const command = meta?.command ?? nestedDetails?.command;
  const args = meta?.args ?? meta?.finalArgs ?? nestedDetails?.args ?? nestedDetails?.finalArgs;
  const cwd = meta?.cwd ?? nestedDetails?.cwd;
  const model = meta?.model ?? nestedDetails?.model;
  const role = meta?.role ?? meta?.failedRole ?? meta?.developerRole ?? nestedDetails?.role ?? nestedDetails?.failedRole ?? nestedDetails?.developerRole;
  const durationMs = meta?.durationMs ?? nestedDetails?.durationMs;
  const status = meta?.status ?? nestedDetails?.status;
  const fixAttempt = meta?.fixAttempt;
  const usedFallback = meta?.usedFallback;

  return (
    <div className="rounded-lg border border-error/30 bg-error-soft/10 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <AlertTriangle size={14} className="text-error flex-shrink-0" />
        <span className="text-[11px] font-semibold text-error">{origin}</span>
        {role && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-secondary border border-border-subtle">
            {role}
          </span>
        )}
        {typeof fixAttempt === "number" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-secondary border border-border-subtle">
            tentativa #{fixAttempt}
          </span>
        )}
        {usedFallback && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
            fallback usado
          </span>
        )}
        <span className="text-[10px] text-text-muted tabular-nums ml-auto">
          {new Date(event.createdAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Mensagem completa (já inclui hint, stderr/stdout tail, command) */}
      <pre className="text-[12px] text-text-secondary ml-5 whitespace-pre-wrap break-words font-mono leading-relaxed">
        {event.message}
      </pre>

      {/* Detalhes estruturados quando há metadata */}
      {meta && (
        <div className="ml-5 space-y-1.5 text-[11px]">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {status && (
              <span>
                <span className="text-text-muted">Status: </span>
                <span className="text-text-primary font-medium">{status}</span>
              </span>
            )}
            {exitCode !== undefined && exitCode !== null && (
              <span>
                <span className="text-text-muted">Exit code: </span>
                <span className="text-text-primary font-medium">{exitCode}</span>
              </span>
            )}
            {durationMs !== undefined && (
              <span>
                <span className="text-text-muted">Duração: </span>
                <span className="text-text-primary font-medium">{durationMs}ms</span>
              </span>
            )}
            {model && (
              <span>
                <span className="text-text-muted">Modelo: </span>
                <span className="text-text-primary font-mono">{model}</span>
              </span>
            )}
          </div>
          {command && (
            <div>
              <span className="text-text-muted">Comando: </span>
              <code className="text-text-primary bg-bg-deep px-1.5 py-0.5 rounded text-[10.5px] font-mono break-all">
                {command}
                {args && args.length > 0 ? ` ${args.join(" ")}` : ""}
              </code>
            </div>
          )}
          {cwd && (
            <div>
              <span className="text-text-muted">CWD: </span>
              <code className="text-text-primary font-mono text-[10.5px]">{cwd}</code>
            </div>
          )}
        </div>
      )}

      {/* Bloco de stderr em code com scroll */}
      {stderrTail && (
        <details className="ml-5" open>
          <summary className="text-[10.5px] text-text-muted cursor-pointer hover:text-text-primary select-none">
            Stderr (último trecho)
          </summary>
          <pre className="mt-1.5 max-h-60 overflow-auto text-[11px] font-mono whitespace-pre-wrap break-words bg-bg-deep/60 border border-error/20 rounded p-2 text-text-secondary">
            {stderrTail}
          </pre>
        </details>
      )}

      {/* Bloco de stdout em code com scroll */}
      {stdoutTail && (
        <details className="ml-5">
          <summary className="text-[10.5px] text-text-muted cursor-pointer hover:text-text-primary select-none">
            Stdout (último trecho)
          </summary>
          <pre className="mt-1.5 max-h-60 overflow-auto text-[11px] font-mono whitespace-pre-wrap break-words bg-bg-deep/60 border border-border-subtle rounded p-2 text-text-secondary">
            {stdoutTail}
          </pre>
        </details>
      )}
    </div>
  );
}

function ErrorsSection({ errors }: { errors: WorkflowEvent[] }) {
  if (errors.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="text-center py-8">
          <CheckCircle2 size={24} className="text-success mx-auto mb-2" />
          <div className="text-[13px] text-text-secondary">Nenhum erro registrado</div>
          <div className="text-[11px] text-text-muted mt-1">
            A execução ocorreu sem erros.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-medium text-text-primary">
        Erros ({errors.length})
      </h3>
      <div className="space-y-2">
        {errors.map((e) => (
          <ErrorEventCard key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * HOTFIX — Define se um evento do barramento `fluxora-event`
 * deve disparar um recarregamento do estado unificado da
 * missão. Considera todos os namespaces que podem alterar o
 * conteúdo das abas:
 *
 * - `mission/*`: mudanças de status, fase, completion, falha.
 * - `agent/*`: steps de agentes (Planner, Developer, QA, Finalizer).
 * - `patch/*`: criação, aprovação, apply, falha de patch.
 * - `approval/*`: criação, aprovação, rejeição de aprovações.
 * - `provider/*`: respostas de provider (podem completar steps).
 *
 * Outros namespaces (`project/*`, `voice/*`, `permission/*`)
 * não disparam refresh porque não afetam diretamente o
 * conteúdo da tela de missão.
 */
export function shouldRefreshOn(event: { type: string }): boolean {
  const t = event.type || "";
  return (
    t.startsWith("mission/") ||
    t.startsWith("agent/") ||
    t.startsWith("patch/") ||
    t.startsWith("approval/") ||
    t.startsWith("provider/")
  );
}

function appendEvent(events: WorkflowEvent[], event: WorkflowEvent) {
  if (events.some((entry) => entry.id === event.id)) return events;
  return [...events, event].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function mapFluxoraEventToWorkflowEvent(event: FluxoraEvent): WorkflowEvent | null {
  const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : null;
  const workflowRunId =
    (typeof payload?.workflowRunId === "string" && payload.workflowRunId) ||
    (typeof event.missionId === "string" && event.missionId) ||
    undefined;
  const message =
    event.message ||
    (typeof payload?.delta === "string" ? payload.delta : undefined) ||
    event.type;
  const normalized = normalizeLogText(message);
  if (!normalized) return null;
  return {
    id: event.id,
    workflowRunId,
    projectId: event.projectId,
    type: event.type,
    message: normalized,
    metadata: payload ? JSON.stringify(payload) : undefined,
    createdAt: event.timestamp,
  };
}

function formatDuration(startMs: number, endMs: number): string {
  const ms = Math.max(0, endMs - startMs);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ─── Reexecução ───────────────────────────────────────────────────────

/**
 * Define em quais status finais o botão "Reexecutar" aparece.
 * Não faz sentido reexecutar algo que ainda está rodando ou já foi aprovado.
 */
function canRerun(status: string): boolean {
  return status === "failed" || status === "cancelled" || status === "rejected" || status === "timeout";
}

const TIMEOUT_PRESETS_MIN = [5, 10, 15, 30, 60];

function RerunModal({
  run,
  onClose,
  onSubmit,
}: {
  run: WorkflowRunDetail;
  onClose: () => void;
  onSubmit: (overrides: WorkflowRerunInput) => void | Promise<void>;
}) {
  const [currentTimeoutMs, setCurrentTimeoutMs] = useState<number>(5 * 60 * 1000);

  const suggestedMs = useMemo(() => Math.max(currentTimeoutMs * 2, 10 * 60 * 1000), [currentTimeoutMs]);
  const [prompt, setPrompt] = useState(run.prompt);
  const [useTimeoutOverride, setUseTimeoutOverride] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState(Math.round(suggestedMs / 60000));

  // Detecta se a última falha parece ter sido timeout (para pré-marcar o override).
  const lastErrorEvent = useMemo(() => {
    const errs = (run.events || []).filter(
      (e) => e.type.includes("failed") || e.type.includes("error") || e.metadata?.includes?.('"status":"timeout"')
    );
    return errs.length > 0 ? errs[errs.length - 1] : null;
  }, [run.events]);
  const looksLikeTimeout = useMemo(() => {
    if (!lastErrorEvent) return false;
    const text = `${lastErrorEvent.type} ${lastErrorEvent.message} ${lastErrorEvent.metadata || ""}`.toLowerCase();
    return text.includes("timeout") || text.includes("tempo limite");
  }, [lastErrorEvent]);

  useEffect(() => {
    setUseTimeoutOverride(looksLikeTimeout);
  }, [looksLikeTimeout]);

  const overrides: WorkflowRerunInput = {
    prompt: prompt.trim() !== run.prompt ? prompt.trim() : undefined,
    defaultTimeoutMs: useTimeoutOverride ? timeoutMinutes * 60 * 1000 : undefined,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reexecutar missão"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <RotateCcw size={16} className="text-accent" />
            <h2 className="text-[14px] font-semibold text-text-primary">Reexecutar missão</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-elevated"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {looksLikeTimeout && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft/10 p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
              <div className="text-[12px] text-text-secondary">
                A execução anterior terminou por <span className="font-semibold text-warning">timeout</span>. Recomendamos
                aumentar o timeout antes de tentar novamente.
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1.5 block">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="no-drag w-full bg-bg-primary border border-border-subtle rounded-lg p-3 text-[12.5px] font-mono text-text-primary focus:outline-none focus:border-accent/50 resize-y"
            />
          </div>

          {/* Timeout override */}
          <div className="rounded-lg border border-border-subtle bg-bg-deep/40 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useTimeoutOverride}
                onChange={(e) => setUseTimeoutOverride(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-[12.5px] font-medium text-text-primary">
                Sobrescrever timeout para esta execução
              </span>
            </label>
            {useTimeoutOverride && (
              <div className="mt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {TIMEOUT_PRESETS_MIN.map((min) => (
                    <button
                      key={min}
                      onClick={() => setTimeoutMinutes(min)}
                      className={`no-drag px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        timeoutMinutes === min
                          ? "bg-accent text-white border border-accent"
                          : "bg-bg-input text-text-secondary border border-border-subtle hover:border-accent/40"
                      }`}
                    >
                      {min} min
                    </button>
                  ))}
                </div>
                <div className="text-[10.5px] text-text-muted mt-2">
                  Atual: {(currentTimeoutMs / 60000).toFixed(0)} min · Novo: {timeoutMinutes} min
                  <span className="ml-1">(também atualiza o default global em Configurações)</span>
                </div>
              </div>
            )}
          </div>

          <div className="text-[11px] text-text-muted">
            Será criada uma <span className="font-medium text-text-secondary">nova execução</span> vinculada a esta pelo campo
            <code className="px-1 mx-0.5 rounded bg-bg-input">parentRunId</code>. O histórico atual é preservado.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="no-drag flux-btn-ghost h-9 px-3 text-[12px]">
            Cancelar
          </button>
          <button
            onClick={() => onSubmit(overrides)}
            className="no-drag flux-btn-primary h-9 px-4 text-[12px] flex items-center gap-1.5"
          >
            <RotateCcw size={14} />
            Reexecutar
          </button>
        </div>
      </div>
    </div>
  );
}

function CommitModal({
  projectId,
  missionId,
  patchProposalId,
  patchFiles,
  missionTitle,
  onClose,
  onSuccess,
}: {
  projectId: string;
  missionId: string;
  patchProposalId: string;
  patchFiles: string[];
  missionTitle: string;
  onClose: () => void;
  onSuccess: (result: any) => void;
}) {
  const [createBranch, setCreateBranch] = useState(true);
  const [branchName, setBranchName] = useState(`fluxora/mission-${missionId.slice(0, 8)}`);
  const [message, setMessage] = useState(`feat: apply Fluxora mission ${missionTitle}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    async function checkReadiness() {
      try {
        const readiness = await window.fluxora.git.getWriteReadiness({ projectId, patchProposalId });
        if (readiness.preExistingWarning) {
          setWarning(readiness.preExistingWarning);
        }
      } catch (err: any) {
        console.error(err);
      }
    }
    checkReadiness();
  }, [projectId, patchProposalId]);

  async function handleCreateCommit() {
    setLoading(true);
    setError(null);
    try {
      const result = await window.fluxora.git.commitPatch({
        projectId,
        missionId,
        patchProposalId,
        createBranch,
        branchName: createBranch ? branchName : undefined,
        message,
        files: patchFiles,
      });

      if (result.status === "failed") {
        setError(result.error || "Falha ao criar o commit.");
      } else {
        onSuccess(result);
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || err || "Erro ao criar commit.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Criar commit local"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-text-primary">Criar commit local</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-elevated"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-[12px] text-error">
              {error}
            </div>
          )}

          {warning && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-[12px] text-warning">
              {warning}
            </div>
          )}

          <div className="rounded-lg border border-border-subtle bg-bg-deep/40 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={createBranch}
                onChange={(e) => setCreateBranch(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-[12.5px] font-medium text-text-primary">
                Criar branch local para a missão
              </span>
            </label>

            {createBranch && (
              <div className="mt-3 space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Nome da branch
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="no-drag w-full bg-bg-primary border border-border-subtle rounded-lg px-3 py-2 text-[12.5px] font-mono text-text-primary focus:outline-none focus:border-accent/50"
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              Mensagem do commit
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="no-drag w-full bg-bg-primary border border-border-subtle rounded-lg p-3 text-[12.5px] font-mono text-text-primary focus:outline-none focus:border-accent/50 resize-y"
            />
          </div>

          <div className="text-[11px] text-text-muted">
            Arquivos a serem commitados ({patchFiles.length}):
            <div className="max-h-24 overflow-y-auto mt-1 p-2 rounded bg-bg-deep/40 border border-border-subtle font-mono text-[10px] space-y-0.5">
              {patchFiles.map((file) => (
                <div key={file} className="text-text-secondary truncate">
                  + {file}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle bg-bg-deep/20">
          <button onClick={onClose} className="no-drag flux-btn-ghost h-9 px-3 text-[12px]" disabled={loading}>
            Cancelar
          </button>
          <button
            onClick={handleCreateCommit}
            className="no-drag flux-btn-primary h-9 px-4 text-[12px] flex items-center gap-1.5"
            disabled={loading}
          >
            {loading ? "Criando..." : "Criar commit local"}
          </button>
        </div>
      </div>
    </div>
  );
}
