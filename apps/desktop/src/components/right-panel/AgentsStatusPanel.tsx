import {
  Workflow,
  ClipboardList,
  ShieldCheck,
  Cpu,
  Sparkles,
} from "lucide-react";
import { isAgentConfiguredForRealExecution, type Agent, type OpenCodeCatalogResult } from "@fluxora/shared";
import { ActionButton, MissionCard } from "../ui";

// ─── Constants ──────────────────────────────────────────────────────────────

const agentIcons: Record<string, typeof Workflow> = {
  planner: ClipboardList,
  developer: Sparkles,
  qa: ShieldCheck,
  finalizer: Workflow,
  custom: Cpu,
};

const agentDescriptions: Record<string, string> = {
  planner: "Analisa e cria o plano técnico",
  developer: "Implementa a solução principal",
  qa: "Valida e testa as alterações",
  finalizer: "Consolida a resposta final entregue ao usuário",
  custom: "Agente com papel personalizado",
};

function iconForRole(role: string) {
  if (role.startsWith("custom:")) return agentIcons.custom;
  return agentIcons[role] || Workflow;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface AgentsStatusPanelProps {
  agents: Agent[];
  catalog: OpenCodeCatalogResult | null;
  onManage: () => void;
}

export function AgentsStatusPanel({ agents, catalog, onManage }: AgentsStatusPanelProps) {
  const list = [...agents].sort((a, b) => a.name.localeCompare(b.name));
  const readyCount = list.filter((agent) => isAgentConfiguredForRealExecution(agent, catalog)).length;

  return (
    <MissionCard className="overflow-hidden" padding="sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Agentes</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-secondary border border-border-subtle">
            {readyCount}/{list.length}
          </span>
        </div>
        <ActionButton variant="ghost" size="sm" onClick={onManage}>
          Gerenciar
        </ActionButton>
      </div>

      {/* Agent list */}
      <div className="divide-y divide-border-subtle">
        {list.map((a) => {
          const Icon = iconForRole(a.role);
          const ready = isAgentConfiguredForRealExecution(a, catalog);
          const status = !a.enabled ? "inactive" : ready ? "ready" : "pending";
          const statusLabel = status === "ready" ? "Pronto" : status === "pending" ? "Pendente" : "Inativo";
          const statusClass =
            status === "ready"
              ? "text-success"
              : status === "pending"
                ? "text-warning"
                : "text-text-muted";
          const dotClass = status === "ready" ? "bg-success" : status === "pending" ? "bg-warning" : "bg-text-muted";
          return (
            <div key={a.id} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-bg-elevated/40 transition-colors">
              <div className="w-7 h-7 rounded-md bg-bg-elevated text-accent flex items-center justify-center flex-shrink-0 border border-accent/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
                <Icon size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-text-primary truncate">{a.name}</span>
                  <span className={`flex items-center gap-1 text-[10.5px] font-medium ${statusClass}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                    {statusLabel}
                  </span>
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {a.role.startsWith("custom:") ? a.description || agentDescriptions.custom : agentDescriptions[a.role] || a.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </MissionCard>
  );
}
