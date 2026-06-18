import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Workflow,
  AlertCircle,
  Radio,
} from "lucide-react";
import type { Agent, BackgroundWorkflowJob, OpenCodeCatalogResult } from "@fluxora/shared";
import { AgentsStatusPanel } from "../right-panel/AgentsStatusPanel";
import { PendingApprovalsPanel } from "../right-panel/PendingApprovalsPanel";
import { usePendingApprovals } from "../../hooks/usePendingApprovals";
import { useActiveRuns } from "../../hooks/useActiveRuns";
import { formatExecutionStatus } from "../../lib/presentationLabels";
import {
  MissionCard,
  SectionHeader,
  StatusBadge,
  ActionButton,
  type StatusBadgeStatus,
} from "../ui";

function mapRunStatus(status: string): StatusBadgeStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "waiting_approval":
      return "waiting_approval";
    default:
      return "pending";
  }
}

export function RightPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [catalog, setCatalog] = useState<OpenCodeCatalogResult | null>(null);
  const [jobs, setJobs] = useState<BackgroundWorkflowJob[]>([]);
  const pendingApprovals = usePendingApprovals();
  const activeRuns = useActiveRuns(3);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    const loadAgentsAndJobs = async () => {
      const [a, catalogResult, nextJobs] = await Promise.all([
        window.fluxora.agents.list(),
        window.fluxora.opencode.getCatalog(),
        window.fluxora.workflows.listJobs(),
      ]);
      if (!mounted) return;
      setAgents(a);
      setCatalog(catalogResult);
      setJobs(nextJobs.filter((job: BackgroundWorkflowJob) => ["queued", "running"].includes(job.status)).slice(0, 3));
    };
    loadAgentsAndJobs();
    const interval = setInterval(loadAgentsAndJobs, 3000);
    const unsubscribeJobs = window.fluxora.events.onJobUpdated((job: BackgroundWorkflowJob) => {
      setJobs((current) => {
        const next = [...current.filter((entry) => entry.id !== job.id), job]
          .filter((entry) => ["queued", "running"].includes(entry.status))
          .slice(0, 3);
        return next;
      });
    });
    return () => {
      mounted = false;
      clearInterval(interval);
      unsubscribeJobs();
    };
  }, []);

  const handleCancelJob = async (jobId: string) => {
    const confirmed = window.confirm(
      "Tem certeza que deseja cancelar esta execução?\nAs alterações já feitas no diretório do projeto não serão revertidas automaticamente."
    );
    if (!confirmed) return;
    await window.fluxora.workflows.cancelJob(jobId);
  };

  const handleApprove = async (id: string) => {
    await window.fluxora.approvals.approve(id);
  };

  const handleReject = async (id: string) => {
    await window.fluxora.approvals.reject(id);
  };

  const hasActiveContent = activeRuns.length > 0 || jobs.length > 0;
  const orchestratorActive = activeRuns.length > 0;

  return (
    <aside className="w-[340px] min-w-[320px] max-w-[380px] flex-shrink-0 bg-bg-deep/80 border-l border-border-subtle/60 flex flex-col overflow-y-auto">
      {/* Header do Orquestrador — compacto */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                orchestratorActive
                  ? "bg-bg-elevated text-accent border border-accent/35 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
                  : "bg-bg-elevated text-text-muted border border-border-subtle"
              }`}
            >
              <Workflow size={16} />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-text-primary leading-tight">
                Orquestrador
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {orchestratorActive ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent flux-pulse-dot" />
                    <span className="text-[10.5px] text-accent font-medium">
                      {activeRuns.length} ativa{activeRuns.length > 1 ? "s" : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                    <span className="text-[10.5px] text-text-muted">Inativo</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => navigate("/executions")}
            aria-label="Ver todas execuções"
          >
            Ver tudo
          </ActionButton>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />

      <div className="p-4 space-y-3 flex-1">
        {/* Execuções Ativas */}
        {activeRuns.length > 0 && (
          <MissionCard padding="sm" className="overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <Radio size={13} className="text-accent flux-pulse-dot" />
                <span className="flux-section-label">
                  Execuções Ativas
                </span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-primary border border-accent/30 font-semibold">
                {activeRuns.length}
              </span>
            </div>
            <div className="divide-y divide-border-subtle">
              {activeRuns.map((run) => (
                <button
                  key={run.id}
                  onClick={() => navigate(`/executions/${run.id}`)}
                  className="no-drag w-full text-left px-3.5 py-3 hover:bg-bg-elevated/40 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                        {run.title}
                      </div>
                    </div>
                    <StatusBadge status={mapRunStatus(run.status)} size="sm" />
                  </div>
                </button>
              ))}
            </div>
          </MissionCard>
        )}

        {/* Jobs em Background */}
        {jobs.length > 0 && (
          <MissionCard padding="sm" className="overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <AlertCircle size={13} className="text-warning" />
                <span className="flux-section-label">
                  Jobs em Background
                </span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/25 font-semibold">
                {jobs.length}
              </span>
            </div>
            <div className="divide-y divide-border-subtle">
              {jobs.map((job) => (
                <div key={job.id} className="px-3.5 py-3 space-y-2">
                  <button
                    onClick={() => navigate(`/executions/${job.workflowRunId}`)}
                    className="no-drag w-full text-left"
                  >
                    <div className="text-[12.5px] font-medium text-text-primary truncate">
                      {job.workflowRunId}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10.5px] text-text-muted">
                        {job.strategy}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-text-muted/40" />
                      <StatusBadge status={mapRunStatus(job.status)} size="sm" hideIcon />
                    </div>
                  </button>
                  <ActionButton
                    variant="danger"
                    size="sm"
                    onClick={() => handleCancelJob(job.id)}
                    className="w-full"
                  >
                    Cancelar execução
                  </ActionButton>
                </div>
              ))}
            </div>
          </MissionCard>
        )}

        {/* Aprovações Pendentes */}
        <PendingApprovalsPanel
          approvals={pendingApprovals}
          onApprove={handleApprove}
          onReject={handleReject}
          onViewAll={() => navigate("/approvals")}
        />

        {/* Agentes */}
        <AgentsStatusPanel agents={agents} catalog={catalog} onManage={() => navigate("/agents")} />

        {/* Empty state quando não há nada */}
        {!hasActiveContent && pendingApprovals.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center mb-3">
              <Activity size={20} className="text-text-muted" />
            </div>
            <div className="text-[12.5px] text-text-secondary">
              Nenhuma atividade em andamento
            </div>
            <div className="text-[11px] text-text-muted mt-1">
              As execuções aparecerão aqui
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
