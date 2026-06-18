import type { Project } from "@fluxora/shared";

const projectColors: Record<string, string> = {
  laravel: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  flutter: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  vue: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  nextjs: "bg-neutral-500/20 text-neutral-200 border-neutral-400/30",
  next: "bg-neutral-500/20 text-neutral-200 border-neutral-400/30",
  react: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  node: "bg-lime-500/20 text-lime-300 border-lime-500/30",
  nodejs: "bg-lime-500/20 text-lime-300 border-lime-500/30",
  api: "bg-accent/20 text-accent border-accent/30",
  default: "bg-bg-card text-text-secondary border-border-subtle",
};

const statusConfig: Record<string, { dot: string; label: string; class: string }> = {
  running: { dot: "bg-success", label: "Executando", class: "text-success" },
  planning: { dot: "bg-accent", label: "Planejando", class: "text-accent" },
  validating: { dot: "bg-warning", label: "Validando", class: "text-warning" },
  waiting_approval: { dot: "bg-warning", label: "Aprovação", class: "text-warning" },
  error: { dot: "bg-error", label: "Erro", class: "text-error" },
  idle: { dot: "bg-text-muted", label: "Inativo", class: "text-text-muted" },
  completed: { dot: "bg-success", label: "Concluído", class: "text-success" },
};

function pickBadgeClass(stack: string[] | undefined): string {
  if (!stack || stack.length === 0) return projectColors.default;
  const key = stack[0].toLowerCase();
  return projectColors[key] || projectColors.default;
}

function projectInitials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface ProjectShortcutListProps {
  projects: Project[];
  onProjectSelect?: (project: Project) => void;
  /** ID do projeto ativo/aberto — recebe destaque visual na lista. */
  activeProjectId?: string | null;
}

export function ProjectShortcutList({ projects, onProjectSelect, activeProjectId }: ProjectShortcutListProps) {
  if (projects.length === 0) {
    return (
      <div className="text-center py-5">
        <div className="text-[11.5px] text-text-muted">
          Nenhum projeto cadastrado
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-[280px] overflow-y-auto pr-0.5" role="list" aria-label="Lista de projetos">
      {projects.map((p) => {
        const status = statusConfig[p.status] || statusConfig.idle;
        const badge = pickBadgeClass(p.stack);
        const stackBadges = p.stack?.slice(0, 2) ?? [];
        const isActive = p.id === activeProjectId;

        return (
          <button
            key={p.id}
            onClick={() => onProjectSelect?.(p)}
            aria-current={isActive ? "true" : undefined}
            title={isActive ? `Projeto aberto: ${p.name}` : undefined}
            className={`w-full no-drag group relative flex items-center gap-3 px-2.5 py-2 rounded-lg transition-all text-left border ${
              isActive
                ? "bg-bg-card/70 border-accent/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
                : "border-transparent hover:bg-bg-card/70 hover:border-border-subtle/60"
            }`}
            role="listitem"
          >
            {/* Avatar do projeto */}
            <span
              className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-transform group-hover:scale-105 ${badge}`}
            >
              {projectInitials(p.name)}
            </span>

            {/* Info do projeto */}
            <div className="min-w-0 flex-1">
              <div className={`truncate leading-tight font-medium text-[12.5px] ${isActive ? "text-white" : "text-text-primary"}`}>
                {p.name}
              </div>
              {/* Stack badges */}
              {stackBadges.length > 0 ? (
                <div className="flex items-center gap-1 mt-1">
                  {stackBadges.map((s) => (
                    <span
                      key={s}
                      className="text-[9.5px] px-1.5 py-0.5 rounded bg-bg-input text-text-muted border border-border-subtle/60 font-medium"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[10.5px] text-text-muted mt-0.5">Sem stack definida</div>
              )}
            </div>

            {/* Status indicator — label um pouco maior para fidelidade visual */}
            <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
              <span className={`w-2 h-2 rounded-full ${status.dot} ${p.status === "running" ? "flux-pulse-dot" : ""}`} />
              <span className={`text-[10px] font-semibold ${status.class} ${isActive ? "drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]" : ""}`}>
                {status.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
