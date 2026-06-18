import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  PlayCircle,
  Bot,
  ShieldCheck,
  Settings,
  Calendar,
  Menu,
  Plus,
  Zap,
  Keyboard,
  BarChart3,
  Mic,
} from "lucide-react";
import type { Project } from "@fluxora/shared";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { useUsageStats } from "../../hooks/useUsageStats";
import { ProjectShortcutList } from "../sidebar/ProjectShortcutList";
import { UsageSummary } from "../sidebar/UsageSummary";

const navItems = [
  { to: "/overview", label: "Visão Geral", icon: LayoutDashboard },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/executions", label: "Execuções", icon: PlayCircle },
  { to: "/usage", label: "Uso & Analytics", icon: BarChart3 },
  { to: "/agents", label: "Agentes", icon: Bot },
  { to: "/approvals", label: "Aprovações", icon: ShieldCheck },
  { to: "/schedule", label: "Cronograma", icon: Calendar },
  { to: "/shortcuts", label: "Atalhos", icon: Keyboard },
  { to: "/translator", label: "MiMo Voice", icon: Mic },
  { to: "/settings", label: "Configurações", icon: Settings },
];

export function Sidebar({ isOpen = true }: { isOpen?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();
  const { activeProjectId, setActiveProjectId } = useActiveProject();
  const { stats } = useUsageStats({ period: "month" });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const list = await window.fluxora.projects.list();
        if (mounted) setProjects(list);
      } catch (e) {
        // noop
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const projectStats = useMemo(() => {
    const total = projects.length;
    const active = projects.filter((p) => p.status === "running" || p.status === "planning" || p.status === "validating").length;
    return { total, active };
  }, [projects]);

  return (
    <aside 
      className={`flex-shrink-0 bg-bg-deep/80 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${
        isOpen 
          ? "w-[260px] min-w-[240px] max-w-[280px] opacity-100 border-r border-border-subtle/60" 
          : "w-0 min-w-0 max-w-0 opacity-0 border-r-0"
      }`}
    >


      {/* Navigation */}
      <nav className="px-3 mt-4 space-y-0.5" aria-label="Navegação principal">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-all no-drag relative group ${
                isActive
                  ? "bg-accent-soft text-text-primary font-semibold border border-accent/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
                  : "text-text-secondary hover:bg-bg-card/60 hover:text-text-primary border border-transparent"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={16}
                  className={`flex-shrink-0 transition-colors ${
                    isActive ? "text-accent" : "text-text-muted group-hover:text-text-secondary"
                  }`}
                />
                <span className="flex-1">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Seção de Projetos */}
      <div className="mt-6 px-4 flex items-center justify-between">
        <span className="flux-section-label">Projetos</span>
        <button
          onClick={() => navigate("/projects")}
          className="no-drag inline-flex items-center justify-center w-6 h-6 rounded-lg text-text-muted hover:text-accent hover:bg-accent-soft/40 transition-colors"
          title="Adicionar projeto"
          aria-label="Adicionar projeto"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="px-3 mt-2">
        <ProjectShortcutList
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectSelect={(p) => {
            setActiveProjectId(p.id);
            navigate("/overview");
          }}
        />
      </div>

      {/* Usage Summary no rodapé */}
      <div className="mt-auto px-3 pb-3 pt-2">
        <UsageSummary
          tokensUsed={stats.estimatedTokens / 1_000_000}
          tokensTotal={stats.tokensLimit}
          costUsed={stats.estimatedCost}
          costTotal={stats.costLimit}
          runsUsed={stats.totalRuns}
          runsTotal={stats.runsLimit}
          projectCount={projectStats.total}
          activeProjects={projectStats.active}
        />
      </div>
    </aside>
  );
}
