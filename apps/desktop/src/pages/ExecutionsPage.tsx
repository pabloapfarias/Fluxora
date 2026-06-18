import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Eye, Loader2 } from "lucide-react";
import type { WorkflowRun } from "@fluxora/shared";
import { formatExecutionStatus, formatExecutionMode } from "../lib/presentationLabels";

export function ExecutionsPage() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 3000);
    return () => clearInterval(interval);
  }, []);

  async function loadRuns() {
    const next = await window.fluxora.workflows.list();
    setRuns(next);
    setLoading(false);
  }

  const statusColors: Record<string, string> = {
    pending_approval: "bg-warning/10 text-warning",
    pending: "bg-bg-input text-text-secondary",
    approved: "bg-success/10 text-success",
    running: "bg-accent/10 text-accent",
    completed: "bg-success/10 text-success",
    failed: "bg-error/10 text-error",
    rejected: "bg-error/10 text-error",
    cancelled: "bg-bg-input text-text-secondary",
    queued: "bg-bg-input text-text-secondary",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Execuções</h1>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-bg-card border border-border rounded-xl p-4 flex items-center justify-between animate-pulse"
            >
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-bg-input" />
                <div className="h-3 w-2/3 rounded bg-bg-input" />
              </div>
              <div className="flex items-center gap-4">
                <div className="h-5 w-20 rounded bg-bg-input" />
                <div className="h-5 w-16 rounded bg-bg-input" />
                <div className="h-5 w-16 rounded bg-bg-input" />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-center gap-2 py-4 text-text-muted text-xs">
            <Loader2 size={14} className="animate-spin" />
            Carregando execuções...
          </div>
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Play size={48} className="mx-auto mb-4 opacity-50" />
          <p>Nenhuma execução encontrada</p>
          <p className="text-sm mt-1">Use o comando de voz na visão geral para iniciar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="bg-bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div className="min-w-0 flex-1 pr-4">
                <div className="font-medium">{run.title}</div>
                <div className="text-xs text-text-muted mt-1 line-clamp-1">{run.prompt}</div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                {run.executionMode && (
                  <span className="text-[10.5px] px-2 py-0.5 rounded font-medium uppercase tracking-wider bg-bg-input text-text-secondary">
                    {formatExecutionMode(run.executionMode)}
                  </span>
                )}
                <span className={`text-xs px-2 py-1 rounded ${statusColors[run.status] || "bg-bg-input text-text-secondary"}`}>
                  {formatExecutionStatus(run.status)}
                </span>
                <span className="text-xs text-text-muted">
                  {new Date(run.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => navigate(`/executions/${run.id}`)}
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
                >
                  <Eye size={14} /> Detalhes
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
