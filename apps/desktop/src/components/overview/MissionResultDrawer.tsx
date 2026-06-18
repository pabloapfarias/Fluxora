import { useState, useCallback } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  FileText,
  XCircle,
  Clock,
  FolderOpen,
  Zap,
  FlaskConical,
  Users,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { WorkflowRun } from "@fluxora/shared";
import { Modal, ActionButton, StatusBadge, ModeBadge, MarkdownRenderer, type StatusBadgeStatus, type ModeBadgeMode } from "../ui";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MissionResultDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Texto completo do resultado */
  resultText: string | null;
  /** Run associada */
  run?: WorkflowRun | null;
  /** Nome do projeto */
  projectName?: string;
  /** Se é erro */
  isError?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapStatus(status: string): StatusBadgeStatus {
  switch (status) {
    case "completed": return "completed";
    case "running":
    case "approved": return "running";
    case "rejected": return "rejected";
    case "failed": return "failed";
    case "pending_approval": return "waiting_approval";
    default: return "pending";
  }
}

function mapMode(mode: string): ModeBadgeMode | null {
  switch (mode) {
    case "real": return "real";
    case "simulated": return "simulated";
    case "multi_agent": return "multiagent";
    case "controlled_execution": return "controlled";
    default: return null;
  }
}

function getModeIcon(mode: string) {
  switch (mode) {
    case "real": return <Zap size={14} />;
    case "simulated": return <FlaskConical size={14} />;
    case "multi_agent": return <Users size={14} />;
    case "controlled_execution": return <ShieldCheck size={14} />;
    default: return <Zap size={14} />;
  }
}

function getModeLabel(mode: string): string {
  switch (mode) {
    case "real": return "Real";
    case "simulated": return "Simulado";
    case "multi_agent": return "Multiagente";
    case "controlled_execution": return "Controlada";
    default: return mode;
  }
}

function formatDuration(run: WorkflowRun): string | null {
  if (!run.createdAt) return null;
  const start = new Date(run.createdAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const diffMs = end - start;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${seconds}s`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MissionResultDrawer({
  open,
  onClose,
  resultText,
  run,
  projectName,
  isError = false,
}: MissionResultDrawerProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [resultText]);

  const handleOpenDetails = useCallback(() => {
    if (run?.id) {
      navigate(`/executions/${run.id}`);
      onClose();
    }
  }, [run, navigate, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Resultado da missão" width="lg">
      <div className="flex flex-col">
        {/* Metadata header */}
        {run && (
          <div className="px-6 py-4 border-b border-border-subtle">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${
                  isError ? "bg-error-soft border-error/25" : "bg-success-soft border-success/25"
                }`}>
                  {isError ? <XCircle size={16} className="text-error" /> : <FileText size={16} className="text-success" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-text-primary truncate">{run.title}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {run.status && <StatusBadge status={mapStatus(run.status)} size="sm" />}
                    {run.executionMode && (() => {
                      const badgeMode = mapMode(run.executionMode);
                      return badgeMode ? <ModeBadge mode={badgeMode} size="sm" /> : null;
                    })()}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11.5px] text-text-muted">
                {projectName && (
                  <span className="flex items-center gap-1.5">
                    <FolderOpen size={12} />
                    {projectName}
                  </span>
                )}
                {run.executionMode && (
                  <span className="flex items-center gap-1.5">
                    {getModeIcon(run.executionMode)}
                    {getModeLabel(run.executionMode)}
                  </span>
                )}
                {formatDuration(run) && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={12} />
                    {formatDuration(run)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Resultado */}
        <div className="px-6 py-5">
          {resultText ? (
            <div className="text-[13px] text-text-primary leading-relaxed max-h-[60vh] overflow-auto flux-terminal-scroll">
              <MarkdownRenderer content={resultText} />
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText size={32} className="mx-auto text-text-muted mb-3" />
              <div className="text-[13px] text-text-secondary">
                {isError ? "A execução falhou. Verifique os logs para mais detalhes." : "Nenhum resultado disponível."}
              </div>
            </div>
          )}
        </div>

        {/* Footer com ações */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-text-muted">
            {run?.createdAt && `Executado em ${new Date(run.createdAt).toLocaleString("pt-BR")}`}
          </div>
          <div className="flex items-center gap-2">
            {resultText && (
              <ActionButton
                variant="ghost"
                size="sm"
                icon={copied ? <Check size={13} /> : <Copy size={13} />}
                onClick={handleCopy}
              >
                {copied ? "Copiado" : "Copiar"}
              </ActionButton>
            )}
            {run?.id && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={<ExternalLink size={13} />}
                onClick={handleOpenDetails}
              >
                Abrir detalhes
              </ActionButton>
            )}
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={onClose}
            >
              Fechar
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
