import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, CheckCircle2, Copy, FileSearch, Loader2, Play, ShieldCheck, Square, XCircle } from "lucide-react";
import type { Approval, ControlledExecutionRunResult, Project, WorkflowEvent, WorkflowRunDetail } from "@fluxora/shared";
import { EventLog, type EventLogTab } from "../events/EventLog";
import { formatExecutionStatus } from "../../lib/presentationLabels";

const CONTROLLED_PROJECT_NAME = "Fluxora";
const CONTROLLED_SANDBOX_PATH = "tmp/controlled-execution-sandbox";
const OUT_OF_SCOPE_ALERT = "A execução alterou arquivos fora do escopo controlado. Revise manualmente antes de aprovar.";
const REJECTION_MESSAGE = "As alterações permanecem no diretório. Revise com git diff e reverta manualmente se necessário.";

type ControlledExecutionStatus = "aguardando" | "rodando" | "concluído" | "falhou";

export function ControlledExecutionPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [runResult, setRunResult] = useState<ControlledExecutionRunResult | null>(null);
  const [status, setStatus] = useState<ControlledExecutionStatus>("aguardando");
  const [approvalState, setApprovalState] = useState<"pendente" | "aprovada" | "rejeitada">("pendente");
  const [activeTab, setActiveTab] = useState<EventLogTab>("timeline");
  const [loading, setLoading] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState<"approve" | "reject" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [activeApproval, setActiveApproval] = useState<Approval | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const controlledProject = useMemo(() => findControlledProject(projects), [projects]);
  const hasOutOfScopeChanges = Boolean(runResult && runResult.outOfScopeFiles.length > 0);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!workflowRunId) return;
    void refreshWorkflowState(workflowRunId);
    const interval = window.setInterval(() => {
      void refreshWorkflowState(workflowRunId);
    }, 2000);

    const unsubscribeEvents = window.fluxora.events.onWorkflowEvent((event) => {
      if (event.workflowRunId !== workflowRunId) return;
      setEvents((current) => appendEvent(current, event));
    });
    const unsubscribeStdout = window.fluxora.events.onOpenCodeStdout((payload) => {
      if (payload.workflowRunId !== workflowRunId) return;
      appendSyntheticEvent(workflowRunId, `STDOUT: ${payload.chunk.trim()}`, "opencode.stdout", setEvents, controlledProject?.id);
    });
    const unsubscribeStderr = window.fluxora.events.onOpenCodeStderr((payload) => {
      if (payload.workflowRunId !== workflowRunId) return;
      appendSyntheticEvent(workflowRunId, `STDERR: ${payload.chunk.trim()}`, "opencode.stderr", setEvents, controlledProject?.id);
    });
    const unsubscribeJson = window.fluxora.events.onOpenCodeJsonEvent((payload) => {
      if (payload.workflowRunId !== workflowRunId) return;
      appendSyntheticEvent(workflowRunId, JSON.stringify(payload.event), "opencode.json_event", setEvents, controlledProject?.id);
    });
    const handleUiEvent = (e: Event) => {
      const detail = (e as CustomEvent<WorkflowEvent>).detail;
      if (detail.workflowRunId !== workflowRunId) return;
      setEvents((current) => appendEvent(current, detail));
    };
    window.addEventListener("fluxora:controlled-execution:ui-event", handleUiEvent);

    return () => {
      window.clearInterval(interval);
      unsubscribeEvents();
      unsubscribeStdout();
      unsubscribeStderr();
      unsubscribeJson();
      window.removeEventListener("fluxora:controlled-execution:ui-event", handleUiEvent);
    };
  }, [workflowRunId, controlledProject?.id]);

  async function loadProjects() {
    const list = await window.fluxora.projects.list();
    setProjects(list);
  }

  async function refreshWorkflowState(id: string) {
    try {
      const [detail, approvals, jobs] = await Promise.all([
        window.fluxora.workflows.get(id),
        window.fluxora.approvals.list(),
        window.fluxora.workflows.listJobs(),
      ]);
      syncDetail(detail, approvals);
      const activeJob = jobs.find((job) => job.workflowRunId === id && ["queued", "running"].includes(job.status));
      const latestControlledJob = jobs.find((job) => job.workflowRunId === id && job.strategy === "controlled_execution");
      setActiveJobId(activeJob?.id || null);
      if (!activeJob && latestControlledJob && ["completed", "failed", "cancelled"].includes(latestControlledJob.status)) {
        setLoading(false);
        if (latestControlledJob.status === "cancelled") {
          setStatus("aguardando");
          return;
        }
        const result = await window.fluxora.opencode.controlledExecution.getResult(latestControlledJob.id);
        if (result) {
          setRunResult(result);
          setStatus(result.status === "completed" ? "concluído" : "falhou");
          setActiveTab(result.changedFiles.length > 0 ? "files" : "logs");
        }
      }
    } catch {
      // noop
    }
  }

  function syncDetail(detail: WorkflowRunDetail, approvals: Approval[]) {
    setEvents(detail.events);
    setWorkflowRunId(detail.id);
    setStatus(mapWorkflowStatus(detail.status));
    if (detail.finalApprovalId) {
      const approval = approvals.find((item) => item.id === detail.finalApprovalId) || null;
      setActiveApproval(approval);
      setApprovalState(approval ? mapApprovalState(approval.status) : "pendente");
      return;
    }
    setActiveApproval(null);
  }

  async function handleExecute() {
    setFeedbackMessage(null);
    setErrorMessage(null);

    if (!controlledProject) {
      setErrorMessage(`Projeto ${CONTROLLED_PROJECT_NAME} não encontrado. Cadastre o repositório na lista de Projetos.`);
      return;
    }

    setLoading(true);
    setStatus("rodando");
    setApprovalState("pendente");
    setEvents([]);
    setRunResult(null);
    setActiveApproval(null);
    setActiveJobId(null);
    setActiveTab("logs");

    let nextWorkflowId: string | null = null;

    try {
      const workflow = await window.fluxora.workflows.create({
        projectId: controlledProject.id,
        title: "Validação real controlada",
        prompt: "Executar validação real controlada no sandbox tmp/controlled-execution-sandbox.",
        generatedContext: JSON.stringify({
          kind: "controlled_execution",
          project: CONTROLLED_PROJECT_NAME,
          sandbox: CONTROLLED_SANDBOX_PATH,
        }, null, 2),
        executionMode: "real",
        realStrategy: "single",
        steps: [
          { name: "Execução controlada", type: "developer", agentId: "agent-frontend" },
          { name: "Validação final", type: "qa", agentId: "agent-qa" },
        ],
      });

      nextWorkflowId = workflow.id;
      setWorkflowRunId(workflow.id);
      emitUiEvent(workflow.id, controlledProject.id, "controlled_execution.ui_started", "Execução controlada iniciada pela interface");

      const detail = await window.fluxora.workflows.get(workflow.id);
      setEvents(detail.events);

      const job = await window.fluxora.opencode.controlledExecution.run({ workflowRunId: workflow.id });
      setActiveJobId(job.jobId);
      await refreshWorkflowState(workflow.id);
    } catch (error) {
      setStatus("falhou");
      setLoading(false);
      setErrorMessage(error instanceof Error ? error.message : "Falha ao executar validação controlada.");
      if (nextWorkflowId) {
        await refreshWorkflowState(nextWorkflowId);
      }
    }
  }

  async function handleCancel() {
    if (!activeJobId) {
      setFeedbackMessage("Cancelamento indisponível para esta execução controlada no estado atual.");
      return;
    }
    setCancelling(true);
    setFeedbackMessage(null);
    if (workflowRunId) {
      emitUiEvent(workflowRunId, controlledProject?.id, "controlled_execution.ui_cancel_requested", "Cancelamento solicitado pela interface");
    }
    try {
      await window.fluxora.workflows.cancelJob(activeJobId);
      setStatus("aguardando");
      setLoading(false);
      await refreshWorkflowState(workflowRunId || "");
    } finally {
      setCancelling(false);
    }
  }

  async function handleApprove() {
    if (!workflowRunId || approvalState !== "pendente") return;
    setApprovalLoading("approve");
    setFeedbackMessage(null);
    try {
      const approval = await window.fluxora.workflows.approveFinal(workflowRunId);
      setActiveApproval(approval);
      setApprovalState("aprovada");
      emitUiEvent(workflowRunId, controlledProject?.id, "controlled_execution.approved", "Resultado aprovado pela interface");
      await refreshWorkflowState(workflowRunId);
    } finally {
      setApprovalLoading(null);
    }
  }

  async function handleReject() {
    if (!workflowRunId || approvalState !== "pendente") return;
    setApprovalLoading("reject");
    setFeedbackMessage(null);
    try {
      const approval = await window.fluxora.workflows.rejectFinal(workflowRunId, REJECTION_MESSAGE);
      setActiveApproval(approval);
      setApprovalState("rejeitada");
      setFeedbackMessage(REJECTION_MESSAGE);
      emitUiEvent(workflowRunId, controlledProject?.id, "controlled_execution.rejected", `Resultado rejeitado pela interface. ${REJECTION_MESSAGE}`);
      await refreshWorkflowState(workflowRunId);
    } finally {
      setApprovalLoading(null);
    }
  }

  async function handleCopyReport() {
    const report = buildControlledExecutionReport({
      status,
      approvalState,
      workflowRunId,
      runResult,
      events,
      hasOutOfScopeChanges,
    });
    await navigator.clipboard.writeText(report);
    setFeedbackMessage("Relatório copiado para a área de transferência.");
    if (workflowRunId) {
      emitUiEvent(workflowRunId, controlledProject?.id, "controlled_execution.ui_report_copied", "Relatório copiado para a área de transferência");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-bg-card p-5 space-y-4" aria-labelledby="controlled-execution-panel-title">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 id="controlled-execution-panel-title" className="text-sm font-medium text-text-primary">Execução real controlada</h3>
          <p className="mt-1 text-[12px] text-text-muted">
            Roda a validação real em sandbox controlado, mantendo streaming, diff real e aprovação final.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void handleExecute()} disabled={loading} className="no-drag flux-btn-secondary h-9 text-[12px]">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Executar validação real controlada
          </button>
          <button onClick={() => void handleCancel()} disabled={!loading && !activeJobId} className="no-drag flux-btn-danger h-9 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed">
            {cancelling ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />} Cancelar execução
          </button>
          <button onClick={() => setActiveTab("logs")} className="no-drag flux-btn-ghost h-9 text-[12px]">
            <FileSearch size={13} /> Ver eventos
          </button>
          <button onClick={() => { setActiveTab("files"); if (workflowRunId) emitUiEvent(workflowRunId, controlledProject?.id, "controlled_execution.ui_opened_diff", "Diff aberto pela interface"); }} className="no-drag flux-btn-ghost h-9 text-[12px]">
            <FileSearch size={13} /> Ver diff
          </button>
          <button onClick={() => void handleApprove()} disabled={approvalState !== "pendente" || !activeApproval || approvalLoading !== null} className="no-drag flux-btn-secondary h-9 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed">
            {approvalLoading === "approve" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Aprovar resultado
          </button>
          <button onClick={() => void handleReject()} disabled={approvalState !== "pendente" || !activeApproval || approvalLoading !== null} className="no-drag flux-btn-danger h-9 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed">
            {approvalLoading === "reject" ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Rejeitar resultado
          </button>
          <button onClick={() => void handleCopyReport()} className="no-drag flux-btn-ghost h-9 text-[12px]">
            <Copy size={13} /> Copiar relatório
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem label="Status" value={formatExecutionStatus(status)} tone={statusTone(status)} />
        <SummaryItem label="Projeto" value={CONTROLLED_PROJECT_NAME} />
        <SummaryItem label="Sandbox" value={CONTROLLED_SANDBOX_PATH} mono />
        <SummaryItem label="OpenCode" value="usable" />
        <SummaryItem label="Eventos recebidos" value={String(events.length)} />
        <SummaryItem label="Arquivos alterados" value={String(runResult?.changedFiles.length || 0)} />
        <SummaryItem label="Fora do escopo" value={hasOutOfScopeChanges ? "sim" : "não"} tone={hasOutOfScopeChanges ? "text-warning" : undefined} />
        <SummaryItem label="Aprovação final" value={approvalState} tone={approvalTone(approvalState)} />
      </div>

      {!controlledProject && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft/20 p-3 text-[12px] text-text-secondary">
          O projeto {CONTROLLED_PROJECT_NAME} precisa existir na lista de projetos cadastrados.
        </div>
      )}

      {hasOutOfScopeChanges && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft/20 p-3 text-[12px] text-text-secondary flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-warning" />
          <span>{OUT_OF_SCOPE_ALERT}</span>
        </div>
      )}

      {feedbackMessage && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft/20 p-3 text-[12px] text-text-secondary">{feedbackMessage}</div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-[12px] text-text-secondary">{errorMessage}</div>
      )}

      {approvalState === "aprovada" && (
        <div className="rounded-lg border border-success/30 bg-success-soft/20 p-3 text-[12px] text-text-secondary flex items-start gap-2">
          <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-success" />
          <span>Aprovação final registrada com sucesso.</span>
        </div>
      )}

      <EventLog
        events={events}
        workflowRunId={workflowRunId || undefined}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        visibleTabs={["logs", "files"]}
      />
    </section>
  );
}

function SummaryItem({ label, value, mono = false, tone }: { label: string; value: string; mono?: boolean; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-deep p-3">
      <div className="text-[10.5px] text-text-muted mb-1">{label}</div>
      <div className={`text-[12.5px] font-medium break-all ${mono ? "font-mono" : ""} ${tone || "text-text-primary"}`}>{value}</div>
    </div>
  );
}

export function mapWorkflowStatus(status: string): ControlledExecutionStatus {
  if (["queued", "running", "approved", "pending_approval"].includes(status)) return "rodando";
  if (status === "completed") return "concluído";
  if (status === "failed" || status === "rejected" || status === "cancelled") return "falhou";
  return "aguardando";
}

export function mapApprovalState(status: Approval["status"]): "pendente" | "aprovada" | "rejeitada" {
  if (status === "approved") return "aprovada";
  if (status === "rejected") return "rejeitada";
  return "pendente";
}

export function statusTone(status: ControlledExecutionStatus) {
  if (status === "concluído") return "text-success";
  if (status === "rodando") return "text-accent";
  if (status === "falhou") return "text-error";
  return "text-text-primary";
}

export function approvalTone(status: "pendente" | "aprovada" | "rejeitada") {
  if (status === "aprovada") return "text-success";
  if (status === "rejeitada") return "text-error";
  return "text-warning";
}

function appendEvent(events: WorkflowEvent[], event: WorkflowEvent) {
  if (events.some((entry) => entry.id === event.id)) return events;
  return [...events, event].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function appendSyntheticEvent(
  workflowRunId: string,
  message: string,
  type: string,
  setEvents: Dispatch<SetStateAction<WorkflowEvent[]>>,
  projectId?: string,
) {
  if (!message.trim()) return;
  setEvents((current) => appendEvent(current, {
    id: `stream-${type}-${Date.now()}-${Math.random()}`,
    workflowRunId,
    projectId,
    type,
    message,
    createdAt: new Date().toISOString(),
  }));
}

function emitUiEvent(
  workflowRunId: string,
  projectId: string | undefined,
  type: string,
  message: string,
) {
  const event: WorkflowEvent = {
    id: `ui-${type}-${Date.now()}-${Math.random()}`,
    workflowRunId,
    projectId,
    type,
    message,
    createdAt: new Date().toISOString(),
  };
  // Dispatch via the global event listener so EventLog and other subscribers pick it up
  window.dispatchEvent(new CustomEvent("fluxora:controlled-execution:ui-event", { detail: event }));
}

export function findControlledProject(projects: Project[]) {
  return projects.find((project) => project.name.trim().toLowerCase() === CONTROLLED_PROJECT_NAME.toLowerCase())
    || null;
}

export function buildControlledExecutionReport({
  status,
  approvalState,
  workflowRunId: _workflowRunId,
  runResult,
  events,
  hasOutOfScopeChanges,
}: {
  status: ControlledExecutionStatus;
  approvalState: "pendente" | "aprovada" | "rejeitada";
  workflowRunId: string | null;
  runResult: ControlledExecutionRunResult | null;
  events: WorkflowEvent[];
  hasOutOfScopeChanges: boolean;
}) {
  const changedFiles = runResult?.changedFiles || [];
  const totalAdditions = changedFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = changedFiles.reduce((sum, f) => sum + f.deletions, 0);

  const summarizedDiff = changedFiles.length > 0
    ? changedFiles.map((f) => `  ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join("\n")
      + `\n  Total: ${changedFiles.length} arquivo(s), +${totalAdditions}/-${totalDeletions}`
    : "  Nenhuma alteração registrada";

  // Summarize events by type — exclude raw stdout/stderr/json content
  const noisyTypes = new Set(["opencode.stdout", "opencode.stderr", "opencode.json_event"]);
  const meaningfulEvents = events.filter((e) => !noisyTypes.has(e.type));
  const eventSummary = meaningfulEvents.length > 0
    ? meaningfulEvents.map((e) => `  ${new Date(e.createdAt).toLocaleTimeString()} [${e.type}] ${truncateMessage(e.message, 120)}`).join("\n")
    : "  Nenhum evento registrado";

  const outOfScopeList = runResult?.outOfScopeFiles || [];
  const outOfScopeText = hasOutOfScopeChanges
    ? `Sim (${outOfScopeList.length} arquivo(s))`
    : "Não";

  return [
    "Fluxora — Relatório de Execução Controlada",
    "",
    `Projeto: ${CONTROLLED_PROJECT_NAME}`,
    `Sandbox: ${CONTROLLED_SANDBOX_PATH}`,
    `Status: ${status}`,
    "OpenCode: usable",
    `Eventos: ${events.length} (${meaningfulEvents.length} relevantes)`,
    `Arquivos alterados: ${changedFiles.length}`,
    `Alterações fora do escopo: ${outOfScopeText}`,
    `Aprovação: ${approvalState}`,
    "",
    "Diff resumido:",
    summarizedDiff,
    "",
    "Eventos:",
    eventSummary,
    "",
    `Data/hora: ${new Date().toLocaleString("pt-BR")}`,
  ].join("\n");
}

function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + "…";
}
