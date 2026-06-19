import { useEffect, useMemo, useState } from "react";
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
  Approval,
  ApprovalContext,
  BackgroundWorkflowJob,
  FluxoraEvent,
  WorkflowEvent,
  WorkflowRunDetail,
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

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialTab = (searchParams.get("tab") as DetailTab) || "resumo";
  const initialStepId = searchParams.get("step");

  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [outputs, setOutputs] = useState<AgentStepOutput[]>([]);
  const [job, setJob] = useState<BackgroundWorkflowJob | null>(null);
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [selectedAgentStepId, setSelectedAgentStepId] = useState<string | null>(initialStepId);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [approvalActionLoading, setApprovalActionLoading] = useState<"approve" | "reject" | null>(null);
  const [rerunModalOpen, setRerunModalOpen] = useState(false);
  const [proposals, setProposals] = useState<PatchProposal[]>([]);
  const [commits, setCommits] = useState<GitCommitResult[]>([]);
  const [commitModalOpen, setCommitModalOpen] = useState(false);

  useEffect(() => {
    const qTab = searchParams.get("tab") as DetailTab;
    const qStep = searchParams.get("step");
    if (qTab) setTab(qTab);
    if (qStep) setSelectedAgentStepId(qStep);
  }, [searchParams]);

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
        e.type === "workflow.multi_agent.failed"
    );
  }, [detail?.events]);

  // Extrair resultado da missão
  const missionResult = useMemo(() => {
    if (!detail?.events) return null;
    const resultEvents = detail.events.filter((e) => e.type === "mission.result");
    return resultEvents.length > 0 ? resultEvents[resultEvents.length - 1].message : null;
  }, [detail?.events]);

  // Contar erros para badge
  const errorCount = errorEvents.length;

  useEffect(() => {
    if (id) loadDetail(id);
    const interval = setInterval(() => {
      if (id) loadDetail(id);
    }, 2000);
    const unsubscribeEvents = window.fluxora.events.onWorkflowEvent((event) => {
      if (event.workflowRunId !== id) return;
      setDetail((current) =>
        current ? { ...current, events: appendEvent(current.events, event) } : current
      );
    });
    const unsubscribeJobs = window.fluxora.events.onJobUpdated((nextJob) => {
      if (nextJob.workflowRunId === id) setJob(nextJob);
    });
    const unsubscribeBus = window.fluxora.events.subscribe((event) => {
      const mapped = mapFluxoraEventToWorkflowEvent(event);
      if (!mapped || mapped.workflowRunId !== id) return;
      setDetail((current) =>
        current ? { ...current, events: appendEvent(current.events, mapped) } : current
      );
    });
    const unsubscribeApproval = window.fluxora.events.onApprovalChange((updated) => {
      if (updated.workflowRunId !== id) return;
      setApproval(updated);
    });
    return () => {
      clearInterval(interval);
      unsubscribeEvents();
      unsubscribeJobs();
      unsubscribeBus();
      unsubscribeApproval();
    };
  }, [id]);

  async function loadDetail(workflowId: string) {
    const [d, agentOutputs, jobs] = await Promise.all([
      window.fluxora.workflows.get(workflowId),
      window.fluxora.workflows.listAgentOutputs(workflowId),
      window.fluxora.workflows.listJobs(),
    ]);
    setDetail(d);
    setOutputs(agentOutputs);
    setJob(
      jobs.find(
        (entry) =>
          entry.workflowRunId === workflowId &&
          ["queued", "running"].includes(entry.status)
      ) || null
    );

    try {
      const approvals = await window.fluxora.approvals.list();
      const found = d.finalApprovalId
        ? approvals.find((a) => a.id === d.finalApprovalId)
        : approvals.find((a) => a.workflowRunId === workflowId);
      if (found) setApproval(found);
    } catch {
      // noop
    }

    try {
      if (window.fluxora.patches?.listByMission) {
        const props = await window.fluxora.patches.listByMission(workflowId);
        setProposals(props);
      }
    } catch (e) {
      console.warn("Failed to load patches", e);
    }

    try {
      if (window.fluxora.git?.listMissionCommits) {
        const comms = await window.fluxora.git.listMissionCommits(workflowId);
        setCommits(comms);
      }
    } catch (e) {
      console.warn("Failed to load commits", e);
    }
  }

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
      setApproval(updated);
      setFeedback({ kind: "success", message: "Aprovação concedida com sucesso." });
      if (id) await loadDetail(id);
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
      setApproval(updated);
      setFeedback({ kind: "success", message: "Aprovação rejeitada." });
      if (id) await loadDetail(id);
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
            setCommits(prev => [...prev.filter(c => c.id !== result.id), result]);
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
            events={detail.events}
            activeRun={detail}
            opencodeResponses={[]}
          />
        )}

        {/* ── Arquivos ── */}
        {tab === "arquivos" && (
          <ChangedFilesSection workflowRunId={detail.id} />
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
  events,
  activeRun,
  opencodeResponses,
}: {
  missionResult: string | null;
  events: WorkflowEvent[];
  activeRun: WorkflowRunDetail;
  opencodeResponses: Array<{ text: string }>;
}) {
  const isError = activeRun.status === "failed";
  const responseResults = opencodeResponses.filter((r) => r.text);
  const latestResponse = responseResults.length > 0 ? responseResults[responseResults.length - 1] : null;
  const resultText = missionResult || latestResponse?.text || null;

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
            isError ? "bg-error-soft border-error/25" : "bg-success-soft border-success/25"
          }`}
        >
          <FileText size={15} className={isError ? "text-error" : "text-success"} />
        </div>
        <div className="flex-1">
          <span className="text-[13px] font-semibold text-text-primary">
            {isError ? "Erro da missão" : "Resultado da missão"}
          </span>
        </div>
      </div>
      <div className="p-5">
        {resultText ? (
          <div className="text-[13px] text-text-secondary max-h-[500px] overflow-auto">
            <MarkdownRenderer content={resultText} />
          </div>
        ) : isError ? (
          <div className="text-[13px] text-error">A execução falhou. Verifique a aba Erros para mais detalhes.</div>
        ) : (
          <div className="text-[13px] text-text-muted py-8 text-center">
            Nenhum resultado registrado ainda. O resultado aparecerá quando a execução for concluída.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Changed Files Section ────────────────────────────────────────────

function ChangedFilesSection({ workflowRunId }: { workflowRunId: string }) {
  const [files, setFiles] = useState<Array<{ path: string; status: string; additions: number; deletions: number }>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, string | null>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    window.fluxora.git
      .changedFiles(workflowRunId)
      .then((f) => {
        if (mounted) setFiles(f);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [workflowRunId]);

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

      {/* Confirmação de arquivos (Fase 9) */}
      {proposal && (
        <div className="space-y-3">
          {proposal.status === "applied" && (
            <div className="rounded-xl border border-success/30 bg-success-soft/20 p-5">
              <div className="text-[13px] font-semibold text-success mb-2">
                Arquivos aplicados no projeto:
              </div>
              <ul className="space-y-1 font-mono text-[12px] text-text-primary">
                {(proposal.filesWritten || proposal.files.map(f => f.path)).map((file) => (
                  <li key={file}>- {file}</li>
                ))}
              </ul>
            </div>
          )}

          {proposal.status === "failed" && (
            <div className="rounded-xl border border-error/30 bg-error/10 p-5">
              <div className="text-[13px] font-semibold text-error mb-2">
                Falha ao aplicar arquivos:
              </div>
              <ul className="space-y-1 font-mono text-[12px] text-error">
                {(proposal.filesMissing && proposal.filesMissing.length > 0
                  ? proposal.filesMissing
                  : proposal.files.map(f => f.path)
                ).map((file) => (
                  <li key={file}>- {file.endsWith("após escrita") ? file : `${file} não encontrado após escrita`}</li>
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
