import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  Eraser,
  FolderKanban,
  Keyboard,
  LayoutDashboard,
  Mic,
  PlayCircle,
  Settings,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { StatusBar } from "./StatusBar";
import { RightPanel } from "./RightPanel";
import { GlobalDefaultBanner } from "./GlobalDefaultBanner";
import { ShortcutHelpOverlay } from "../help/ShortcutHelpOverlay";
import { FirstRunOnboarding, FIRST_RUN_ONBOARDING_KEY } from "../help/FirstRunOnboarding";
import { CommandPalette, type CommandPaletteAction, type CommandPaletteUniversalItem } from "../help/CommandPalette";
import { useCommandPaletteHistory } from "../../hooks/useCommandPaletteHistory";
import { loadProviderCatalog } from "../../lib/providerCatalog";
import { deriveProviderEngineGlobalDefault, isAgentReadyWithFallback } from "@fluxora/shared";

interface AppShellProps {
  children: ReactNode;
}

const NAV_TARGETS: Record<string, { path: string; label: string }> = {
  o: { path: "/overview", label: "Visão Geral" },
  a: { path: "/agents", label: "Agentes" },
  e: { path: "/executions", label: "Execuções" },
  p: { path: "/projects", label: "Projetos" },
  s: { path: "/settings", label: "Configurações" },
  r: { path: "/approvals", label: "Aprovações" },
  h: { path: "/shortcuts", label: "Atalhos" },
  u: { path: "/usage", label: "Uso & Analytics" },
};

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const gPrefixRef = useRef<number | null>(null);
  const { activeProjectId } = useActiveProject();
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const paletteHistory = useCommandPaletteHistory();
  const [projects, setProjects] = useState<{ id: string; name: string; path: string; stack: string[] }[]>([]);
  const [executions, setExecutions] = useState<{ id: string; title: string; status: string; projectId?: string; createdAt: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; role: string; enabled: boolean; modelProviderId?: string; modelName?: string }[]>([]);
  const [approvals, setApprovals] = useState<{ id: string; title: string; impact: string; projectId?: string; workflowRunId?: string }[]>([]);
  const [catalog, setCatalog] = useState<{ providers: { id: string }[]; models: { id: string }[] } | null>(null);
  const [providers, setProviders] = useState<{ id: string; enabled: boolean; defaultModel?: string }[]>([]);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(FIRST_RUN_ONBOARDING_KEY);
      if (!seen) setShowOnboarding(true);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      window.fluxora.projects.list(),
      window.fluxora.workflows.list(),
      window.fluxora.agents.listConfigs(),
      window.fluxora.approvals.listPending(),
      window.fluxora.providers.list(),
    ])
      .then(async ([projectList, executionList, agentList, approvalList, providers]) => {
        if (!mounted) return;
        const catalogResult = await loadProviderCatalog(providers);
        setProjects(projectList);
        setExecutions(
          executionList.slice(0, 8).map((run) => ({
            id: run.id,
            title: run.title,
            status: run.status,
            projectId: run.projectId,
            createdAt: run.createdAt,
          }))
        );
        setAgents(
          agentList.map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            enabled: agent.status === "enabled",
            modelProviderId: agent.providerId,
            modelName: agent.model,
          }))
        );
        setApprovals(approvalList);
        setCatalog(catalogResult);
        setProviders(providers.map((p) => ({ id: p.id, enabled: p.enabled, defaultModel: p.defaultModel })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const commandActions = useMemo<CommandPaletteAction[]>(() => [
    {
      id: "focus-command",
      title: "Focar comando principal",
      description: "Leva você para a Overview e foca o campo principal de missão.",
      keywords: ["overview", "comando", "missão", "campo"],
      icon: <LayoutDashboard size={14} />,
      group: "Ações",
      run: () => focusCommand(),
    },
    {
      id: "open-voice",
      title: "Abrir comando por voz",
      description: "Vai para a Overview e abre o fluxo para comando por voz.",
      keywords: ["voz", "mic", "microfone", "speech"],
      icon: <Mic size={14} />,
      group: "Ações",
      run: () => {
        navigate("/overview");
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("fluxora:openVoiceCommand"));
        });
      },
    },
    {
      id: "clear-mission-view",
      title: "Limpar logs e timeline",
      description: "Limpa o terminal da Overview, sem mexer no histórico persistido.",
      keywords: ["limpar", "logs", "terminal", "timeline", "apagar"],
      icon: <Eraser size={14} />,
      group: "Ações",
      run: () => {
        if (location.pathname.startsWith("/overview")) {
          window.dispatchEvent(new Event("fluxora:clearMissionView"));
        } else {
          navigate("/overview");
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event("fluxora:clearMissionView"));
          });
        }
      },
    },
    {
      id: "open-shortcuts",
      title: "Abrir ajuda rápida de atalhos",
      description: "Mostra o overlay com os atalhos sem sair da tela atual.",
      keywords: ["atalhos", "help", "ajuda", "keyboard"],
      icon: <Keyboard size={14} />,
      group: "Ações",
      run: () => setShowShortcutHelp(true),
    },
    {
      id: "go-overview",
      title: "Ir para Visão Geral",
      description: "Navega para a tela principal de execução.",
      keywords: ["overview", "dashboard", "início"],
      aliases: ["go", "g o"],
      icon: <LayoutDashboard size={14} />,
      group: "Navegação",
      run: () => navigate("/overview"),
    },
    {
      id: "go-projects",
      title: "Ir para Projetos",
      description: "Abre a gestão de projetos e prontidão por stack.",
      keywords: ["projetos", "repos", "paths"],
      aliases: ["gp", "g p"],
      icon: <FolderKanban size={14} />,
      group: "Navegação",
      run: () => navigate("/projects"),
    },
    {
      id: "go-executions",
      title: "Ir para Execuções",
      description: "Abre o histórico e o monitoramento das execuções.",
      keywords: ["execuções", "runs", "jobs"],
      aliases: ["ge", "g e"],
      icon: <PlayCircle size={14} />,
      group: "Navegação",
      run: () => navigate("/executions"),
    },
    {
      id: "go-usage",
      title: "Ir para Uso & Analytics",
      description: "Abre a página de uso com gráficos e breakdown por projeto.",
      keywords: ["uso", "analytics", "tokens", "cost", "custo", "gráficos"],
      aliases: ["gu", "g u"],
      icon: <BarChart3 size={14} />,
      group: "Navegação",
      run: () => navigate("/usage"),
    },
    {
      id: "go-agents",
      title: "Ir para Agentes",
      description: "Configura agentes, providers, modelos e permissões.",
      keywords: ["agentes", "models", "providers"],
      aliases: ["ga", "g a"],
      icon: <Bot size={14} />,
      group: "Navegação",
      run: () => navigate("/agents"),
    },
    {
      id: "go-approvals",
      title: "Ir para Aprovações",
      description: "Abre a fila de aprovações pendentes e resolvidas.",
      keywords: ["approvals", "aprovações", "review"],
      aliases: ["gr", "g r"],
      icon: <ShieldCheck size={14} />,
      group: "Navegação",
      run: () => navigate("/approvals"),
    },
    {
      id: "go-settings",
      title: "Ir para Configurações",
      description: "Abre providers, fallback global, voz e permissões.",
      keywords: ["settings", "configurações", "fallback"],
      aliases: ["gs", "g s"],
      icon: <Settings size={14} />,
      group: "Navegação",
      run: () => navigate("/settings"),
    },
    {
      id: "go-shortcuts",
      title: "Ir para Atalhos",
      description: "Abre a página de atalhos do produto.",
      keywords: ["atalhos", "keyboard", "ajuda"],
      aliases: ["gh", "g h"],
      icon: <Keyboard size={14} />,
      group: "Navegação",
      run: () => navigate("/shortcuts"),
    },
  ], [navigate, location.pathname]);

  // PR 014.1 — Global default para readiness de agentes no command palette
  const globalDefault = useMemo(
    () => deriveProviderEngineGlobalDefault(providers),
    [providers]
  );

  const universalItems = useMemo<CommandPaletteUniversalItem[]>(() => {
    const items: CommandPaletteUniversalItem[] = [];
    projects.forEach((project) => {
      items.push({
        id: `project:${project.id}`,
        title: project.name,
        description: project.path,
        keywords: [project.path, ...project.stack],
        group: "Projetos",
        icon: <FolderKanban size={14} />,
        run: () => navigate("/projects"),
      });
    });
    executions.forEach((run) => {
      items.push({
        id: `execution:${run.id}`,
        title: run.title || "Execução sem título",
        description: `Status: ${run.status}`,
        keywords: [run.id, run.status, run.projectId || ""],
        group: "Execuções",
        status: run.status,
        icon: <PlayCircle size={14} />,
        run: () => navigate(`/executions/${run.id}`),
      });
    });
    agents.forEach((agent) => {
      // PR 014.1 — Usa isAgentReadyWithFallback que considera
      // herança de provider/modelo via globalDefault
      const ready = isAgentReadyWithFallback(agent, globalDefault);
      items.push({
        id: `agent:${agent.id}`,
        title: agent.name,
        description: `${agent.role} • ${ready ? "pronto" : "pendente"}`,
        keywords: [agent.role, agent.id],
        group: "Agentes",
        icon: <Bot size={14} />,
        run: () => navigate("/agents"),
      });
    });
    approvals.forEach((approval) => {
      items.push({
        id: `approval:${approval.id}`,
        title: approval.title,
        description: `Impacto: ${approval.impact} • pendente`,
        keywords: [approval.id, approval.impact, approval.projectId || "", approval.workflowRunId || ""],
        group: "Aprovações",
        icon: <ShieldCheck size={14} />,
        run: () => navigate("/approvals"),
        actions: [
          {
            id: "approve",
            label: "Aprovar",
            tone: "success",
            run: async () => {
              try {
                await window.fluxora.approvals.approve(approval.id);
              } catch (error) {
                window.alert(
                  error instanceof Error ? error.message : "Falha ao aprovar."
                );
              }
            },
          },
          {
            id: "reject",
            label: "Rejeitar",
            tone: "danger",
            run: async () => {
              try {
                await window.fluxora.approvals.reject(approval.id);
              } catch (error) {
                window.alert(
                  error instanceof Error ? error.message : "Falha ao rejeitar."
                );
              }
            },
          },
        ],
      });
    });
    return items;
  }, [projects, executions, agents, approvals, catalog, globalDefault, navigate]);

  /** Ações contextuais baseadas no projeto ativo. */
  const contextActions = useMemo<CommandPaletteAction[]>(() => {
    if (!activeProjectId) return [];
    const project = projects.find((p) => p.id === activeProjectId);
    if (!project) return [];
    return [
      {
        id: `context:open-project`,
        title: `Abrir ${project.name}`,
        description: `Vai para os detalhes do projeto.`,
        keywords: ["abrir", "projeto", project.name],
        icon: <FolderKanban size={14} />,
        group: "Ações",
        run: () => navigate("/projects"),
      },
      {
        id: `context:open-executions`,
        title: `Execuções de ${project.name}`,
        description: `Vai para a lista de execuções.`,
        keywords: ["execuções", project.name],
        icon: <PlayCircle size={14} />,
        group: "Ações",
        run: () => navigate("/executions"),
      },
      {
        id: `context:review-approvals`,
        title: `Aprovações pendentes de ${project.name}`,
        description: `Revisar aprovações deste projeto.`,
        keywords: ["aprovações", project.name],
        icon: <ShieldCheck size={14} />,
        group: "Ações",
        run: () => navigate("/approvals"),
      },
    ];
  }, [activeProjectId, projects, navigate]);

  // Atalhos globais: Ctrl/Cmd+K, "/", "?", "g o/a/e/p/s/r/h"
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function clearPrefixSoon() {
      if (gPrefixRef.current) {
        window.clearTimeout(gPrefixRef.current);
      }
      gPrefixRef.current = window.setTimeout(() => {
        gPrefixRef.current = null;
      }, 1000);
    }

    function handleKey(event: KeyboardEvent) {
      // Ctrl/Cmd+K: foca a barra de comando
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      // Ctrl+Espaço: abre comando por voz
      if ((event.ctrlKey || event.metaKey) && (event.key === " " || event.code === "Space")) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        navigate("/overview");
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("fluxora:openVoiceCommand"));
        });
        return;
      }
      // "/" fora de campos: abre comando
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        focusCommand();
        return;
      }
      // "?" abre a página de atalhos
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        setShowShortcutHelp(true);
        return;
      }
      // "g" prefixo de navegação
      if (event.key === "g" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        gPrefixRef.current = 1;
        clearPrefixSoon();
        return;
      }
      if (gPrefixRef.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = NAV_TARGETS[event.key.toLowerCase()];
        gPrefixRef.current = null;
        if (target) {
          if (isTypingTarget(event.target)) return;
          event.preventDefault();
          navigate(target.path);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (gPrefixRef.current) window.clearTimeout(gPrefixRef.current);
    };
  }, [navigate, location.pathname]);

  function focusCommand() {
    if (!location.pathname.startsWith("/overview")) {
      navigate("/overview");
    }
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Campo de comando"]');
      target?.focus();
    });
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-base text-text-primary overflow-hidden">
      <Topbar onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)} />
      <GlobalDefaultBanner />

      {/* Main cockpit grid: sidebar | content | right panel */}
      <div className="flex flex-1 min-h-0">
        <Sidebar isOpen={isSidebarOpen} />

        <main className="flex-1 min-w-0 overflow-y-auto bg-bg-base flux-grid-bg">
          <div className="px-8 py-6 w-full">
            {children}
          </div>
        </main>

        <RightPanel />
      </div>

      <StatusBar />

      {showShortcutHelp && (
        <ShortcutHelpOverlay
          onClose={() => setShowShortcutHelp(false)}
          onOpenFullPage={() => {
            setShowShortcutHelp(false);
            navigate("/shortcuts");
          }}
        />
      )}

      {showOnboarding && (
        <FirstRunOnboarding
          onClose={() => {
            setShowOnboarding(false);
            try {
              window.localStorage.setItem(FIRST_RUN_ONBOARDING_KEY, new Date().toISOString());
            } catch {
              // ignore storage errors
            }
          }}
          onOpenShortcuts={() => {
            setShowOnboarding(false);
            try {
              window.localStorage.setItem(FIRST_RUN_ONBOARDING_KEY, new Date().toISOString());
            } catch {
              // ignore storage errors
            }
            navigate("/shortcuts");
          }}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          actions={[...contextActions, ...commandActions]}
          universalItems={universalItems}
          recents={paletteHistory.recents}
          favorites={paletteHistory.favorites}
          prefixHistory={paletteHistory.prefixHistory}
          isFavorite={paletteHistory.isFavorite}
          toggleFavorite={paletteHistory.toggleFavorite}
          onPrefixUsed={paletteHistory.recordPrefix}
          onSelect={(action) => {
            paletteHistory.recordUsage(action.id);
            action.run();
          }}
          onSelectUniversal={(item) => {
            paletteHistory.recordUsage(item.id);
            item.run();
          }}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
    </div>
  );
}
