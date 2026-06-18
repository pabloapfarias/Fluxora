import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GitBranch,
  FolderOpen,
} from "lucide-react";
import type { Project } from "@fluxora/shared";
import { Modal } from "../ui";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProjectSwitcherModalProps {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  currentProjectId?: string | null;
  onSelect: (project: Project) => void;
  /** Mapa de projectId → se tem Git disponível */
  gitStatus?: Record<string, boolean>;
  /** Mapa de projectId → resultado da validação */
  validationResults?: Record<string, { valid: boolean; error?: string }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStackColor(stack: string[]): string {
  const s = stack.join(" ").toLowerCase();
  if (s.includes("laravel") || s.includes("php")) return "bg-rose-500/15 text-rose-400 border-rose-500/25";
  if (s.includes("flutter") || s.includes("dart")) return "bg-sky-500/15 text-sky-400 border-sky-500/25";
  if (s.includes("vue")) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
  if (s.includes("next")) return "bg-neutral-500/15 text-neutral-300 border-neutral-500/25";
  if (s.includes("react")) return "bg-cyan-500/15 text-cyan-400 border-cyan-500/25";
  if (s.includes("node")) return "bg-lime-500/15 text-lime-400 border-lime-500/25";
  return "bg-accent-soft text-accent border-accent/25";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectSwitcherModal({
  open,
  onClose,
  projects,
  currentProjectId,
  onSelect,
  gitStatus,
  validationResults,
}: ProjectSwitcherModalProps) {
  const handleSelect = (project: Project) => {
    onSelect(project);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Trocar projeto" width="md">
      <div className="p-4">
        {projects.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen size={32} className="mx-auto text-text-muted mb-3" />
            <div className="text-[13px] text-text-secondary">Nenhum projeto cadastrado</div>
            <div className="text-[11.5px] text-text-muted mt-1">
              Cadastre um projeto na página de Projetos primeiro.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => {
              const isSelected = project.id === currentProjectId;
              const hasGit = gitStatus?.[project.id];
              const validation = validationResults?.[project.id];
              const isInvalid = validation && !validation.valid;

              return (
                <button
                  key={project.id}
                  onClick={() => handleSelect(project)}
                  className={`no-drag w-full text-left rounded-xl border p-4 transition-all hover:bg-bg-card-hover ${
                    isSelected
                      ? "border-accent/40 bg-accent-soft/10"
                      : isInvalid
                      ? "border-error/30 bg-error-soft/5"
                      : "border-border-subtle bg-bg-deep/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar com iniciais */}
                      <div
                        className={`w-9 h-9 rounded-lg text-[12px] font-bold flex items-center justify-center flex-shrink-0 border ${getStackColor(project.stack)}`}
                      >
                        {project.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-text-primary truncate">
                            {project.name}
                          </span>
                          {isSelected && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-bold border border-accent/25">
                              ATUAL
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-text-muted font-mono truncate mt-0.5">
                          {project.path}
                        </div>
                      </div>
                    </div>

                    {/* Status indicators */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Stack badges */}
                      {project.stack.slice(0, 2).map((s) => (
                        <span
                          key={s}
                          className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${getStackColor([s])}`}
                        >
                          {s}
                        </span>
                      ))}

                      {/* Git status */}
                      {hasGit !== undefined && (
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${
                          hasGit
                            ? "bg-success-soft text-success border-success/25"
                            : "bg-warning-soft text-warning border-warning/30"
                        }`}>
                          <GitBranch size={10} />
                          {hasGit ? "Git" : "Sem Git"}
                        </span>
                      )}

                      {/* Validation status */}
                      {isInvalid && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border bg-error-soft text-error border-error/25">
                          <XCircle size={10} />
                          Inválido
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
