import { useState, useEffect } from "react";
import {
  FolderOpen,
  GitBranch,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ArrowLeftRight,
  Search,
  Loader2,
  Zap,
  Sparkles,
} from "lucide-react";
import type {
  ProviderCatalogResult,
} from "../../lib/providerCatalog";
import {
  deriveProviderEngineGlobalDefault,
  formatAgentRoleLabel,
  isAgentConfiguredForRealExecution,
  isAgentReadyWithFallback,
  recommendDeveloperRoleForStack,
  type Agent,
  type AiProviderConfig,
  type Project,
} from "@fluxora/shared";
import { ActionButton } from "../ui";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActiveProjectBlockProps {
  project: Project | null;
  gitAvailable: boolean | null;
  opencodeStatus: string | null;
  /** Branch atual do repositório Git */
  branch?: string | null;
  /** Callback para trocar projeto */
  onSwitchProject?: () => void;
  /** Callback para validar projeto */
  onValidate?: () => void;
  /** Callback para abrir pasta no explorador */
  onOpenFolder?: () => void;
  /** Se true, está validando */
  isValidating?: boolean;
  /** Resultado da última validação */
  validationResult?: { valid: boolean; error?: string } | null;
  /** Lista de agentes cadastrados (para prontidão) */
  agents?: Agent[];
  /** Providers reais do Provider Engine */
  providers?: AiProviderConfig[];
  /** Catálogo derivado do Provider Engine (para prontidão) */
  catalog?: ProviderCatalogResult | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ActiveProjectBlock({
  project,
  gitAvailable,
  opencodeStatus,
  branch,
  onSwitchProject,
  onValidate,
  onOpenFolder,
  isValidating = false,
  validationResult,
  agents = [],
  providers = [],
  catalog = null,
}: ActiveProjectBlockProps) {
  const isProviderRuntimeReady = opencodeStatus === "detected" || opencodeStatus === "running";

  const developerReadiness = project
    ? (() => {
        const role = recommendDeveloperRoleForStack(project.stack);
        const agent = agents.find((entry) => entry.role === role);
        const direct = agent ? isAgentConfiguredForRealExecution(agent) : false;
        const fallback = deriveProviderEngineGlobalDefault(providers);
        const ready = agent ? isAgentReadyWithFallback(agent, fallback) : false;
        return {
          role,
          label: formatAgentRoleLabel(role),
          agentName: agent?.name,
          direct,
          ready,
          usingFallback: ready && !direct,
        };
      })()
    : null;

  // ── Sem projeto selecionado ──
  if (!project) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning-soft/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-warning-soft border border-warning/25 flex items-center justify-center">
            <AlertTriangle size={18} className="text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">Nenhum projeto selecionado</div>
            <div className="text-[12px] text-text-secondary mt-0.5">
              Selecione um projeto antes de enviar uma missão.
            </div>
          </div>
          {onSwitchProject && (
            <ActionButton
              variant="secondary"
              size="sm"
              icon={<ArrowLeftRight size={13} />}
              onClick={onSwitchProject}
            >
              Selecionar projeto
            </ActionButton>
          )}
        </div>
      </div>
    );
  }

  // ── Projeto com path inválido ──
  const pathInvalid = validationResult && !validationResult.valid;

  return (
    <div className={`rounded-xl border px-5 py-4 ${
      pathInvalid
        ? "border-error/30 bg-error-soft/10"
        : "border-border-subtle bg-bg-deep/30"
    }`}>
      {/* Header com nome e badges */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              pathInvalid
                ? "bg-error-soft border border-error/25"
                : "bg-bg-elevated border border-accent/30"
            }`}>
              <FolderOpen size={18} className={pathInvalid ? "text-error" : "text-accent"} />
            </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary truncate">
              Projeto ativo: {project.name}
            </div>
            <div className="text-[12px] text-text-muted font-mono truncate mt-0.5">
              {project.path}
            </div>
          </div>
        </div>

        {/* Botões de ação */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onSwitchProject && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={<ArrowLeftRight size={13} />}
              onClick={onSwitchProject}
            >
              Trocar projeto
            </ActionButton>
          )}
          {onOpenFolder && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={onOpenFolder}
            >
              Abrir pasta
            </ActionButton>
          )}
          {onValidate && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={isValidating ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              onClick={onValidate}
              disabled={isValidating}
            >
              {isValidating ? "Validando..." : "Validar projeto"}
            </ActionButton>
          )}
        </div>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {/* Git */}
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border ${
          gitAvailable === true
            ? "bg-success-soft text-success border-success/25"
            : gitAvailable === false
            ? "bg-error-soft text-error border-error/25"
            : "bg-bg-input text-text-muted border-border-subtle"
        }`}>
          <GitBranch size={12} />
          {gitAvailable === true ? "Git OK" : gitAvailable === false ? "Sem Git" : "Verificando Git..."}
        </span>

        {/* Provider Engine */}
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border ${
          isProviderRuntimeReady
            ? "bg-success-soft text-success border-success/25"
            : opencodeStatus === "not_detected"
            ? "bg-warning-soft text-warning border-warning/30"
            : "bg-bg-input text-text-muted border-border-subtle"
        }`}>
          <Zap size={12} />
          {isProviderRuntimeReady ? "Provider Engine pronto" : opencodeStatus === "not_detected" ? "Sem provider configurado" : "Verificando providers..."}
        </span>

        {/* Branch */}
        {branch && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border bg-bg-input text-text-secondary border-border-subtle">
            <GitBranch size={12} />
            {branch}
          </span>
        )}

        {/* Stack */}
        {project.stack && project.stack.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border bg-bg-input text-text-muted border-border-subtle">
            {project.stack.slice(0, 3).join(", ")}
          </span>
        )}

        {/* Prontidão do developer recomendado */}
        {developerReadiness && (
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border ${
              developerReadiness.ready
                ? developerReadiness.usingFallback
                  ? "bg-warning-soft text-warning border-warning/25"
                  : "bg-success-soft text-success border-success/25"
                : "bg-error-soft text-error border-error/25"
            }`}
            title={
              developerReadiness.ready
                ? developerReadiness.usingFallback
                  ? `${developerReadiness.label} (${developerReadiness.agentName ?? "—"}) usando modelo padrão global.`
                  : `${developerReadiness.label} (${developerReadiness.agentName ?? "—"}) pronto para execução real.`
                : `${developerReadiness.label} sem agente pronto. Configure provider/modelo ou defina um modelo padrão global.`
            }
          >
            <Sparkles size={12} />
            {developerReadiness.ready
              ? developerReadiness.usingFallback
                ? `${developerReadiness.label} (fallback global)`
                : `${developerReadiness.label} pronto`
              : `${developerReadiness.label} pendente`}
          </span>
        )}
      </div>

      {/* Validação: erro */}
      {pathInvalid && validationResult?.error && (
        <div className="mt-3 flex items-start gap-2.5 text-[12px] text-error">
          <XCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{validationResult.error}</span>
        </div>
      )}

      {/* Validação: sucesso */}
      {validationResult?.valid && (
        <div className="mt-3 flex items-center gap-2.5 text-[12px] text-success">
          <CheckCircle2 size={14} />
          <span>Projeto validado com sucesso.</span>
        </div>
      )}

      {/* Aviso: sem Git */}
      {gitAvailable === false && !pathInvalid && (
        <div className="mt-3 flex items-start gap-2.5 text-[12px] text-warning">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Este projeto não parece ser um repositório Git. Execuções read-only podem funcionar, mas diff e aprovações podem ficar indisponíveis.</span>
        </div>
      )}
    </div>
  );
}
