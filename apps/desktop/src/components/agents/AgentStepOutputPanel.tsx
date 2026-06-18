import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, AlertTriangle, Clock } from "lucide-react";
import type { AgentStepOutput } from "@fluxora/shared";
import { formatAgentRole } from "../../lib/presentationLabels";

export function AgentStepOutputPanel({ outputs }: { outputs: AgentStepOutput[] }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  if (outputs.length === 0) {
    return (
      <div className="text-[12px] text-text-muted py-8 text-center">
        Nenhuma saída de agente registrada para esta execução.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {outputs.map((output) => {
        const key = output.id;
        const isOpen = openSections[key] ?? false;
        return (
          <div
            key={output.id}
            className={`rounded-xl border overflow-hidden transition-colors ${
              output.status === "completed"
                ? "border-success/30 bg-success-soft/10"
                : output.status === "failed"
                ? "border-error/30 bg-error-soft/10"
                : output.status === "running"
                ? "border-accent/30 bg-accent-soft/10"
                : "border-border bg-bg-card"
            }`}
          >
            <button
              onClick={() => setOpenSections((prev) => ({ ...prev, [key]: !isOpen }))}
              className="no-drag w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover/30"
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

              {/* Status icon */}
              <div className="flex-shrink-0">
                {output.status === "completed" ? (
                  <CheckCircle2 size={16} className="text-success" />
                ) : output.status === "failed" ? (
                  <AlertTriangle size={16} className="text-error" />
                ) : output.status === "running" ? (
                  <Loader2 size={16} className="text-accent animate-spin" />
                ) : (
                  <Clock size={16} className="text-text-muted" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text-primary">{labelFor(output)}</div>
                <div className="text-[11px] text-text-muted flex items-center gap-2">
                  <span className={`font-medium ${
                    output.status === "completed" ? "text-success" :
                    output.status === "failed" ? "text-error" :
                    output.status === "running" ? "text-accent" :
                    "text-text-muted"
                  }`}>
                    {statusLabel(output.status)}
                  </span>
                  {output.completedAt && output.startedAt && (
                    <>
                      <span>•</span>
                      <span>{formatDuration(output.startedAt, output.completedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* QA badge */}
              {output.agentRole === "qa" && output.status === "completed" && (
                <span
                  className={
                    output.output?.toLowerCase().includes("reprov")
                      ? "flux-pill-error"
                      : "flux-pill-success"
                  }
                >
                  {output.output?.toLowerCase().includes("reprov") ? "Reprovado" : "Aprovado"}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="border-t border-border p-4 space-y-3 text-[12px]">
                {/* Prompt resumido */}
                <Section
                  title="Prompt enviado"
                  content={output.prompt}
                  truncate
                />
                {/* Output */}
                <Section
                  title="Resposta do agente"
                  content={output.output || "Sem output retornado."}
                />
                {/* Eventos JSON (colapsado) */}
                {output.parsedOutput && output.parsedOutput !== "[]" && (
                  <Section
                    title="Eventos JSON"
                    content={output.parsedOutput}
                    collapsed
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Section({
  title,
  content,
  truncate,
  collapsed: initialCollapsed,
}: {
  title: string;
  content: string;
  truncate?: boolean;
  collapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed ?? false);
  const displayContent = truncate && content.length > 300 ? content.slice(0, 300) + "..." : content;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          {title}
        </div>
        {initialCollapsed && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="no-drag text-[10px] text-text-muted hover:text-text-secondary"
          >
            {collapsed ? "Mostrar" : "Ocultar"}
          </button>
        )}
      </div>
      {!collapsed && (
        <pre className="rounded-lg border border-border bg-bg-deep p-3 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary max-h-72">
          {displayContent}
        </pre>
      )}
    </div>
  );
}

function labelFor(output: AgentStepOutput) {
  switch (output.agentRole) {
    case "planner":
      return "Planner";
    case "qa":
      return "QA";
    case "fixer":
      return `Fix (${output.agentName || "Developer"})`;
    default:
      return output.agentName || formatAgentRole(output.agentRole);
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Concluído";
    case "failed":
      return "Falhou";
    case "running":
      return "Executando";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

function formatDuration(startedAt: string, completedAt: string) {
  const ms = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
