import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, X, ChevronDown, Sparkles, Bot, Server, Smartphone, ShieldCheck, Zap, FlaskConical, Users } from "lucide-react";
import type { VoiceContextResult, WorkflowExecutionMode, RealWorkflowStrategy } from "@fluxora/shared";

interface VoiceContextCardProps {
  context: VoiceContextResult;
  transcript: string;
  onWorkflowCreated: () => void;
  onCancel?: () => void;
}

const agentIcons: Record<string, typeof Bot> = {
  orchestrator: Bot,
  planner: Bot,
  "backend-dev": Server,
  "frontend-dev": Server,
  "mobile-dev": Smartphone,
  qa: ShieldCheck,
  devops: Server,
};

const agentLabels: Record<string, string> = {
  orchestrator: "Orquestrador",
  planner: "Planner",
  "backend-dev": "Backend Dev",
  "frontend-dev": "Frontend Dev",
  "mobile-dev": "Mobile Dev",
  qa: "QA",
  devops: "DevOps",
};

const intentLabels: Record<string, string> = {
  feature_request: "Nova Feature",
  bug_fix: "Correção de Bug",
  refactor: "Refatoração",
  improvement: "Melhoria",
  investigation: "Investigação",
  validation: "Validação",
  project_recognition: "Reconhecimento",
  removal: "Remoção",
  general: "Geral",
};

export function VoiceContextCard({ context, transcript, onWorkflowCreated, onCancel }: VoiceContextCardProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [mode, setMode] = useState<WorkflowExecutionMode>("simulated");
  const [realStrategy, setRealStrategy] = useState<RealWorkflowStrategy>("multi_agent");
  const navigate = useNavigate();

  const handleStartExecution = async () => {
    setCreating(true);
    try {
      const wantsBackend = context.suggestedAgents.includes("backend-dev");
      const wantsMobile = context.suggestedAgents.includes("mobile-dev");
      const developerAgentId = wantsBackend
        ? "agent-backend"
        : wantsMobile
        ? "agent-mobile"
        : "agent-frontend";

      const steps: Array<{ name: string; type: "planner" | "developer" | "qa" | "finalization"; agentId: string }> = [
        { name: "Planejamento", type: "planner", agentId: "agent-planner" },
      ];
      if (context.suggestedAgents.length > 0) {
        steps.push({ name: "Desenvolvimento", type: "developer", agentId: developerAgentId });
      }
      if (context.suggestedAgents.includes("qa") || context.intent !== "project_recognition") {
        steps.push({ name: "Testes e Validação", type: "qa", agentId: "agent-qa" });
      }
      steps.push({ name: "Finalização", type: "finalization", agentId: "agent-orchestrator" });

      const run = await window.fluxora.workflows.create({
        title: context.title,
        prompt: transcript,
        generatedContext: JSON.stringify(context, null, 2),
        executionMode: mode,
        realStrategy: mode === "real" ? realStrategy : undefined,
        steps,
      } as any);
      onWorkflowCreated();
      navigate("/approvals");
    } catch (error) {
      console.error("Failed to create workflow:", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/40 bg-gradient-to-br from-accent-soft/60 via-bg-card to-bg-card overflow-hidden flux-glow-accent">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-accent text-white flex items-center justify-center">
            <Sparkles size={14} />
          </div>
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-text-primary">Comando por Voz</span>
          <span className="flux-pill-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> Transcrição concluída
          </span>
        </div>
        <button
          onClick={() => setEditing((s) => !s)}
          className="no-drag flux-btn-secondary h-8 text-[12px]"
        >
          <Sparkles size={12} /> Editar Contexto
        </button>
      </div>

      <div className="p-5 space-y-4">
        <blockquote className="text-[15px] text-text-primary leading-relaxed border-l-2 border-accent/60 pl-3 italic">
          “{transcript || context.summary}”
        </blockquote>

        <div className="rounded-lg border border-border bg-bg-deep/60 p-4 space-y-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Contexto gerado automaticamente
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[10.5px] text-text-muted mb-1.5">Tipo de Solicitação</div>
              <div className="text-[13px] text-text-primary font-medium">{intentLabels[context.intent] || context.intent}</div>
            </div>
            <div>
              <div className="text-[10.5px] text-text-muted mb-1.5">Projetos Envolvidos</div>
              <div className="flex flex-wrap gap-1.5">
                {context.suggestedProjects.length === 0 ? (
                  <span className="text-[12px] text-text-muted">—</span>
                ) : (
                  context.suggestedProjects.map((p) => (
                    <span key={p} className="flux-pill-muted text-[11.5px]">{p}</span>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] text-text-muted mb-1.5">Agentes Sugeridos</div>
              <div className="flex flex-wrap gap-1.5">
                {context.suggestedAgents.length === 0 ? (
                  <span className="text-[12px] text-text-muted">—</span>
                ) : (
                  context.suggestedAgents.map((a) => {
                    const Icon = agentIcons[a] || Bot;
                    return (
                      <span key={a} className="flux-pill-accent">
                        <Icon size={11} /> {agentLabels[a] || a}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg-deep/60 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] text-text-muted">
            <FlaskConical size={13} />
            <span>Modo de execução</span>
          </div>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setMode("simulated")}
              className={`no-drag px-3 h-8 text-[12px] flex items-center gap-1.5 ${mode === "simulated" ? "bg-accent text-white" : "bg-bg-input text-text-secondary hover:text-text-primary"}`}
            >
              <FlaskConical size={12} /> Simulado
            </button>
            <button
              onClick={() => setMode("real")}
              className={`no-drag px-3 h-8 text-[12px] flex items-center gap-1.5 ${mode === "real" ? "bg-accent text-white" : "bg-bg-input text-text-secondary hover:text-text-primary"}`}
            >
              <Zap size={12} /> Real
            </button>
          </div>
        </div>

        {mode === "real" && (
          <div className="rounded-lg border border-border bg-bg-deep/60 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Users size={13} />
              <span>Estratégia de execução real</span>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setRealStrategy("single")}
                className={`no-drag px-3 h-8 text-[12px] flex items-center gap-1.5 ${realStrategy === "single" ? "bg-accent text-white" : "bg-bg-input text-text-secondary hover:text-text-primary"}`}
                title="Uma única execução consolidada"
              >
                Simples
              </button>
              <button
                onClick={() => setRealStrategy("multi_agent")}
                className={`no-drag px-3 h-8 text-[12px] flex items-center gap-1.5 ${realStrategy === "multi_agent" ? "bg-accent text-white" : "bg-bg-input text-text-secondary hover:text-text-primary"}`}
                title="Planner → Developer → QA → fix opcional → Aprovação final"
              >
                <Users size={12} /> Multiagente
              </button>
            </div>
          </div>
        )}

        {showDetails && (
          <div className="rounded-lg border border-border bg-bg-deep/60 p-4 text-[12.5px] text-text-secondary space-y-1.5">
            <div><span className="text-text-muted">Intenção:</span> {context.intent}</div>
            <div><span className="text-text-muted">Resumo:</span> {context.summary}</div>
            <div><span className="text-text-muted">Risco:</span> {context.risk}</div>
            <div><span className="text-text-muted">Requer aprovação:</span> {context.requiresApproval ? "Sim" : "Não"}</div>
            <div><span className="text-text-muted">Modo:</span> {mode === "real" ? "Real" : "Simulado"}</div>
          </div>
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-border flex items-center justify-between gap-2 bg-bg-deep/40">
        <button
          onClick={() => setShowDetails((s) => !s)}
          className="no-drag flux-btn-ghost h-9 text-[12.5px]"
        >
          Ver detalhes
          <ChevronDown size={14} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={!onCancel}
            className="no-drag flux-btn-secondary h-9 text-[12.5px] disabled:opacity-50"
          >
            <X size={14} /> Cancelar
          </button>
          <button
            onClick={handleStartExecution}
            disabled={creating}
            className="no-drag flux-btn-primary h-9 text-[12.5px]"
          >
            <Play size={14} />
            {creating ? "Criando..." : "Iniciar Execução"}
          </button>
        </div>
      </div>
    </div>
  );
}
