import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  Users,
  ShieldCheck,
  AlertTriangle,
  Bot,
  FileText,
  ExternalLink,
  Copy,
  Eye,
  RotateCcw,
} from "lucide-react";
import type {
  AiProviderConfig,
  Project,
  WorkflowRun,
  Agent,
  WorkflowEvent,
  Approval,
  WorkflowExecutionMode,
  RealWorkflowStrategy,
  OpenCodeCatalogResult,
} from "@fluxora/shared";
import {
   appendProjectRecommendationHistory,
   buildMissionPrecheck,
   classifyMissionIntent,
   deriveProviderEngineGlobalDefault,
   getMissionAgentRequirements,
   getRequiredAgentRolesForMission,
   isAgentConfiguredForRealExecution,
   isAgentReadyWithFallback,
   readProjectRecommendationHistory,
   readProjectRecommendations,
   recordProjectRecommendation,
   recommendDeveloperRoleForStack,
   recommendPlannerRoleForStack,
   recommendProjectStackLabel,
   recommendQaRoleForStack,
   resolveMissionPipeline,
   validateApprovalContext,
   formatAgentRoleLabel,
   type AgentRole,
   type ProjectRecommendation,
   type ProjectRecommendationHistoryEntry,
 } from "@fluxora/shared";
import { useActiveProject } from "../contexts/ActiveProjectContext";
import { ExecutionFlowCard } from "../components/overview/ExecutionFlowCard";
import { CommandPanel } from "../components/overview/CommandPanel";
import { MissionDiagnosticModal, type ProjectRecommendationSummary } from "../components/overview/MissionDiagnosticModal";
import { RecentExecutions } from "../components/overview/RecentExecutions";
import { EventLog } from "../components/events/EventLog";
import { ControlledExecutionPanel, findControlledProject } from "../components/settings/ControlledExecutionPanel";
import { ActiveProjectBlock } from "../components/overview/ActiveProjectBlock";
import { ProjectSwitcherModal } from "../components/overview/ProjectSwitcherModal";
import { MissionResultDrawer } from "../components/overview/MissionResultDrawer";
import { ActionButton, MarkdownRenderer } from "../components/ui";
import { useLiveExecutionEvents } from "../hooks/useLiveExecutionEvents";
import type { OpenCodeResponse } from "../hooks/useLiveExecutionEvents";
import { classifyCommandIntent } from "../lib/presentationLabels";

type OverviewExecutionMode = "simulated" | "real" | "multi_agent" | "controlled_execution";

const EXECUTION_MODE_STORAGE_KEY = "fluxora:overviewExecutionMode";

export function OverviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const prefillCommand = (location.state as any)?.prefillCommand as string | undefined;

  const [projects, setProjects] = useState<Project[]>([]);
  const [recentRuns, setRecentRuns] = useState<WorkflowRun[]>([]);
  const [allApprovals, setAllApprovals] = useState<Approval[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [catalog, setCatalog] = useState<OpenCodeCatalogResult | null>(null);
  const [pendingFinalApproval, setPendingFinalApproval] = useState<Approval | null>(null);
  const [executionMode, setExecutionMode] = useState<OverviewExecutionMode>(() => {
    try {
      const stored = window.localStorage.getItem(EXECUTION_MODE_STORAGE_KEY);
      if (stored === "simulated" || stored === "real" || stored === "multi_agent" || stored === "controlled_execution") {
        return stored;
      }
    } catch {
      // ignore storage errors
    }
    return "simulated";
  });
  const [opencodeStatus, setOpencodeStatus] = useState<string | null>(null);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);
  const [showResultDrawer, setShowResultDrawer] = useState(false);
  const [resultDrawerRun, setResultDrawerRun] = useState<WorkflowRun | null>(null);
  const [clearLogsOnNewMission, setClearLogsOnNewMission] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("fluxora:clearLogsOnNewMission") === "true";
    } catch {
      return false;
    }
  });
  const [diagnosticContext, setDiagnosticContext] = useState<{ intent: string; suggestedAgents: Agent["role"][] } | null>(null);
  const [commandText, setCommandText] = useState("");
  const loadGenerationRef = useRef(0);
  const selectedRunIdRef = useRef<string | null>(null);

  // Projeto ativo: persistido globalmente via contexto (sobrevive navegação)
  const { activeProjectId, setActiveProjectId } = useActiveProject();

  // Projeto ativo: pode ser o controlado ou o selecionado manualmente
  const controlledProject = useMemo(() => findControlledProject(projects), [projects]);
  const activeProject = useMemo(() => {
    if (activeProjectId) {
      return projects.find((p) => p.id === activeProjectId) || controlledProject;
    }
    return controlledProject;
  }, [activeProjectId, projects, controlledProject]);

  const {
    events,
    setEvents,
    activeRun,
    setActiveRun,
    activeJob,
    setActiveJob,
    opencodeResponses,
    clearEvents,
    isExecuting,
  } = useLiveExecutionEvents(activeProject?.id);

  const hasProjectPath = Boolean(activeProject?.path);
  const isOpencodeUsable = opencodeStatus === "detected" || opencodeStatus === "running";
  const canRunControlledExecution = Boolean(activeProject) && hasProjectPath && isOpencodeUsable && gitAvailable !== false;

  // Track whether we already consumed the prefillCommand to avoid reapplying it
  const prefillCommandConsumed = useRef(false);

  // Ref to always have the latest activeProjectId (avoids stale closures in setInterval)
  const selectedProjectIdRef = useRef(activeProjectId);
  useEffect(() => { selectedProjectIdRef.current = activeProjectId; });

  // Ref to always call the latest loadData (avoids stale closures in setInterval)
  const loadDataRef = useRef(loadData);
  useEffect(() => { loadDataRef.current = loadData; });

  useEffect(() => {
    loadData();
    void window.fluxora.opencode.getStatus().then(setOpencodeStatus).catch(() => {});
    const unsubApproval = (window as any).fluxora.events?.onApprovalChange?.(() => loadDataRef.current());
    const unsubJob = (window as any).fluxora.events?.onJobUpdated?.(() => loadDataRef.current());
    const interval = setInterval(() => loadDataRef.current(), 3000);
    return () => {
      if (unsubApproval) unsubApproval();
      if (unsubJob) unsubJob();
      clearInterval(interval);
    };
  }, []);

  // Pre-fill command text from Topbar navigation
  useEffect(() => {
    if (!prefillCommand) {
      prefillCommandConsumed.current = false;
      return;
    }

    if (prefillCommandConsumed.current) return;

    prefillCommandConsumed.current = true;
    setCommandText(prefillCommand);
    navigate(location.pathname, { replace: true, state: { ...location.state, prefillCommand: undefined } });
  }, [prefillCommand, location.pathname, location.state, navigate]);

  async function loadData(explicitProjectId?: string | null) {
    const loadGeneration = ++loadGenerationRef.current;
    const [p, r, ag, providerList, catalogResult, approvals, jobs] = await Promise.all([
      window.fluxora.projects.list(),
      window.fluxora.workflows.list(),
      window.fluxora.agents.list(),
      window.fluxora.providers.list(),
      window.fluxora.opencode.getCatalog(),
      window.fluxora.approvals.list(),
      window.fluxora.workflows.listJobs(),
    ]);

    if (loadGeneration !== loadGenerationRef.current) {
      return;
    }

    setProjects(p);
    setAgents(ag.filter((a: Agent) => a.enabled));
    setProviders(providerList);
    setCatalog(catalogResult);

    // Use explicit projectId if provided, otherwise fall back to ref (always up-to-date)
    const effectiveProjectId = explicitProjectId !== undefined ? explicitProjectId : selectedProjectIdRef.current;

    // Determine the active project for filtering
    const currentActiveProject = effectiveProjectId
      ? p.find((proj) => proj.id === effectiveProjectId) || findControlledProject(p)
      : findControlledProject(p);
    const pid = currentActiveProject?.id;

    // Filter runs and approvals by active project
    const filteredRuns = pid ? r.filter((run) => run.projectId === pid) : r;
    setRecentRuns(filteredRuns.slice(0, 5));

    const filteredApprovals = pid ? approvals.filter((a) => a.projectId === pid) : approvals;
    setAllApprovals(filteredApprovals);

    const selectedRun = selectedRunIdRef.current
      ? filteredRuns.find((run) => run.id === selectedRunIdRef.current)
      : null;
    const running = filteredRuns.find((x) => x.status === "running" || x.status === "approved" || x.status === "pending_approval");
    const nextActiveRun = selectedRun || running || filteredRuns[0] || null;
    if (nextActiveRun) selectedRunIdRef.current = nextActiveRun.id;
    setActiveRun(nextActiveRun);
    setActiveJob(jobs.find((job) => nextActiveRun && job.workflowRunId === nextActiveRun.id && ["queued", "running"].includes(job.status)) || null);

    // Find a pending final approval (linked to a workflow run)
    const final = filteredApprovals.find((a) => a.status === "pending" && filteredRuns.some((w) => w.finalApprovalId === a.id));
    setPendingFinalApproval(final || null);

    // Check git availability for the active project
    if (currentActiveProject) {
      try {
        const inspection = await window.fluxora.git.inspect(currentActiveProject.id);
        if (loadGeneration !== loadGenerationRef.current) {
          return;
        }
        setGitAvailable(inspection.isRepo);
        setGitBranch(inspection.branch || null);
      } catch {
        if (loadGeneration !== loadGenerationRef.current) {
          return;
        }
        setGitAvailable(false);
        setGitBranch(null);
      }
    } else {
      setGitAvailable(null);
      setGitBranch(null);
    }
  }

  async function handleValidateProject() {
    if (!activeProject) return;
    setIsValidating(true);
    setValidationResult(null);
    try {
      const result = await window.fluxora.projects.validatePath(activeProject.path);
      setValidationResult(result);
    } catch {
      setValidationResult({ valid: false, error: "Erro ao validar o caminho do projeto." });
    } finally {
      setIsValidating(false);
    }
  }

  function handleSelectProject(project: Project) {
    loadGenerationRef.current += 1;
    selectedProjectIdRef.current = project.id;
    selectedRunIdRef.current = null;
    clearEvents(); // limpar logs do projeto anterior
    setActiveProjectId(project.id);
    setValidationResult(null);
    setGitAvailable(null);
    setGitBranch(null);
    // Limpar listas que serão recarregadas pelo novo projeto
    setRecentRuns([]);
    setAllApprovals([]);
    setActiveRun(null);
    setActiveJob(null);
    setPendingFinalApproval(null);
    // Fechar drawer de resultado se estiver aberto
    setShowResultDrawer(false);
    setResultDrawerRun(null);
    // Recarregar dados do novo projeto imediatamente, sem deixar respostas antigas vencerem a corrida
    void loadData(project.id);
  }

  // Validação do projeto ativo para o CommandPanel
  const projectBlocker = useMemo(() => {
    if (!activeProject) return "Nenhum projeto selecionado. Selecione um projeto antes de enviar uma missão.";
    if (validationResult && !validationResult.valid) return validationResult.error || "O caminho do projeto selecionado não existe ou não está acessível.";
    return undefined;
  }, [activeProject, validationResult]);

  const globalDefault = useMemo(
    () => deriveProviderEngineGlobalDefault(providers),
    [providers]
  );

  const realExecutionBlocker = useMemo(() => {
    const hasEnabledProvider = providers.some((provider) => provider.enabled);
    const hasGlobalFallback = Boolean(globalDefault.providerId && globalDefault.modelName);
    const isAnyAgentReady = agents.some((agent) => isAgentReadyWithFallback(agent, catalog, globalDefault));

    if (executionMode === "real") {
      if (!hasEnabledProvider && !hasGlobalFallback) {
        return "Modo real indisponível: configure um provider real no Provider Engine.";
      }
      if (!isAnyAgentReady) {
        return "Modo real indisponível: habilite ao menos um agente real com provider/modelo ou use o fallback real do Mission Engine.";
      }
      return undefined;
    }

    if (executionMode !== "multi_agent") return undefined;

    if (!hasEnabledProvider && !hasGlobalFallback) {
      return "Modo multiagente indisponível: ative ao menos um provider real em Configurações.";
    }

    const labels: Record<string, string> = {
      planner: "Planner",
      qa: "QA",
      "backend-dev": "Backend Dev",
      "frontend-dev": "Frontend Dev",
      "mobile-dev": "Mobile Dev",
    };
    const mandatoryRoles = ["planner", "qa"] as const;
    const missingMandatory = mandatoryRoles.filter((role) => {
      const agent = agents.find((entry) => entry.role === role);
      return !agent || !isAgentReadyWithFallback(agent, catalog, globalDefault);
    });

    const developerRoles = ["backend-dev", "frontend-dev", "mobile-dev"] as const;
    const hasDeveloperReady = developerRoles.some((role) => {
      const agent = agents.find((entry) => entry.role === role);
      return Boolean(agent && isAgentReadyWithFallback(agent, catalog, globalDefault));
    });

    const missing: string[] = [...missingMandatory];
    if (!hasDeveloperReady) missing.push("backend-dev");

    if (missing.length === 0) return undefined;
    return `Modo multiagente indisponível: habilite modelo/provider para ${missing.map((role) => labels[role] || role).join(", ")} (ou use o fallback real do Mission Engine).`;
  }, [executionMode, agents, catalog, globalDefault, providers]);

  const projectValid = !projectBlocker && !realExecutionBlocker;
  const commandBlocker = projectBlocker || realExecutionBlocker;

  const isAgentReady = useCallback(
    (role: AgentRole): { ready: boolean; agentName?: string; usingFallback: boolean } => {
      const agent = agents.find((entry) => entry.role === role);
      if (!agent) return { ready: false, usingFallback: false };
      if (isAgentConfiguredForRealExecution(agent, catalog)) {
        return { ready: true, agentName: agent.name, usingFallback: false };
      }
      if (isAgentReadyWithFallback(agent, catalog, globalDefault)) {
        return { ready: true, agentName: agent.name, usingFallback: true };
      }
      return { ready: false, agentName: agent.name, usingFallback: false };
    },
    [agents, catalog, globalDefault]
  );

  const developerRecommendation = useMemo(() => {
    if (!activeProject) return null;
    const role = recommendDeveloperRoleForStack(activeProject.stack);
    const plannerRole = recommendPlannerRoleForStack(activeProject.stack);
    const qaRole = recommendQaRoleForStack(activeProject.stack);
    const dev = isAgentReady(role);
    const planner = plannerRole ? isAgentReady(plannerRole) : null;
    const qa = qaRole ? isAgentReady(qaRole) : null;
    return {
      role,
      stackLabel: recommendProjectStackLabel(activeProject.stack),
      agentName: dev.agentName,
      ready: dev.ready,
      usingFallback: dev.usingFallback,
      planner: planner
        ? { role: plannerRole!, agentName: planner.agentName, ready: planner.ready, usingFallback: planner.usingFallback }
        : null,
      qa: qa
        ? { role: qaRole!, agentName: qa.agentName, ready: qa.ready, usingFallback: qa.usingFallback }
        : null,
    };
  }, [activeProject, isAgentReady]);

  const getMissingAgentConfigMessage = useCallback((intent: string, suggestedAgents: Agent["role"][]) => {
    const requirements = getMissionAgentRequirements(intent as any, suggestedAgents);
    const missingLines: string[] = [];
    for (const req of requirements) {
      const agent = agents.find((entry) => entry.role === req.role);
      if (!agent) {
        missingLines.push(`${formatAgentRoleLabel(req.role)} (papel sem agente cadastrado) — ${req.reason}`);
        continue;
      }
      if (!isAgentReadyWithFallback(agent, catalog, globalDefault)) {
        missingLines.push(`${formatAgentRoleLabel(req.role)} (${agent.name}) — agente sem provider/modelo ativo`);
      }
    }
    if (missingLines.length === 0) return undefined;
    return `Agentes obrigatórios não estão prontos para esta missão:\n• ${missingLines.join("\n• ")}\nConfigure provider e modelo na tela de Agentes, ou defina um modelo padrão global em Configurações.`;
  }, [agents, catalog, globalDefault]);

  async function handleCancelActiveJob() {
    if (!activeJob) return;
    const confirmed = window.confirm("Tem certeza que deseja cancelar esta execução?\nAs alterações já feitas no diretório do projeto não serão revertidas automaticamente.");
    if (!confirmed) return;
    await window.fluxora.workflows.cancelJob(activeJob.id);
    await loadData();
  }

  const handleApproveFinal = async (approval: Approval) => {
    if (!approval.workflowRunId) return;
    await window.fluxora.workflows.approveFinal(approval.workflowRunId);
    await loadData();
  };

  const handleRejectFinal = async (approval: Approval) => {
    if (!approval.workflowRunId) return;
    await window.fluxora.workflows.rejectFinal(approval.workflowRunId);
    await loadData();
  };

  const handleRerunActive = async () => {
    if (!activeRun?.id) return;
    const result = await window.fluxora.workflows.rerun(activeRun.id, {});
    selectedRunIdRef.current = result.workflowRunId;
    await loadData();
  };

  /**
   * Clears the local mission view (events, responses, result drawer).
   * Does NOT remove persisted history in SQLite — only the in-memory
   * terminal/timeline content currently shown.
   */
  const clearMissionView = useCallback(() => {
    clearEvents();
    setShowResultDrawer(false);
    setResultDrawerRun(null);
  }, [clearEvents]);

  useEffect(() => {
    function handleClear() {
      clearMissionView();
    }
    window.addEventListener("fluxora:clearMissionView", handleClear as EventListener);
    return () => window.removeEventListener("fluxora:clearMissionView", handleClear as EventListener);
  }, [clearMissionView]);

  /**
   * Persists the "clear on new mission" preference in localStorage.
   */
  const handleClearLogsOnNewMissionChange = useCallback((next: boolean) => {
    setClearLogsOnNewMission(next);
    try {
      window.localStorage.setItem("fluxora:clearLogsOnNewMission", String(next));
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, []);

  const handleExecutionModeChange = useCallback((next: OverviewExecutionMode) => {
    setExecutionMode(next);
    try {
      window.localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleRequestDiagnostics = useCallback(() => {
    const intent = classifyMissionIntent(commandText);
    const suggestedAgents = agents.map((agent) => agent.role);
    setDiagnosticContext({ intent, suggestedAgents });
  }, [commandText, agents]);

  const closeDiagnostics = useCallback(() => setDiagnosticContext(null), []);

  const goToAgentsFromDiagnostics = useCallback(() => {
    setDiagnosticContext(null);
    navigate("/agents");
  }, [navigate]);

  const savedRecommendation = useMemo<ProjectRecommendationSummary | null>(() => {
    if (!activeProject) return null;
    const map = readProjectRecommendations(window.localStorage);
    const entry = map[activeProject.id];
    if (!entry) return null;
    const findAgent = (role?: string) => (role ? agents.find((agent) => agent.role === role) : undefined);
    const devAgent = findAgent(entry.developerRole);
    const plannerAgent = entry.plannerRole ? findAgent(entry.plannerRole) : undefined;
    const qaAgent = entry.qaRole ? findAgent(entry.qaRole) : undefined;
    return {
      developerRole: entry.developerRole as AgentRole,
      developerAgentName: devAgent?.name,
      developerReady: devAgent ? isAgentReadyWithFallback(devAgent, catalog, globalDefault) : false,
      plannerRole: entry.plannerRole as AgentRole | undefined,
      plannerAgentName: plannerAgent?.name,
      plannerReady: plannerAgent ? isAgentReadyWithFallback(plannerAgent, catalog, globalDefault) : false,
      qaRole: entry.qaRole as AgentRole | undefined,
      qaAgentName: qaAgent?.name,
      qaReady: qaAgent ? isAgentReadyWithFallback(qaAgent, catalog, globalDefault) : false,
      appliedAt: entry.appliedAt,
    };
  }, [activeProject, agents, catalog, globalDefault]);

  const recommendationHistory = useMemo<ProjectRecommendationHistoryEntry[]>(() => {
    if (!activeProject) return [];
    return readProjectRecommendationHistory(window.localStorage, activeProject.id);
  }, [activeProject]);

  /**
   * Creates a workflow from a text command and executes it based on the selected mode.
   * If the input is a simple conversation (greeting, test, etc.), responds in chat
   * without creating a workflow.
   */
  const executeCommand = useCallback(async (text: string) => {
    if (!text.trim() || submitting) return;

    // Classify intent: conversation vs. mission
    const intent = classifyCommandIntent(text);
    if (intent === "conversation") {
      // ── Conversation flow: no workflow, no approval — local events only ──
      const baseId = `conv-${Date.now()}-${Math.random()}`;
      const userEvent: WorkflowEvent = {
        id: `${baseId}-user`,
        workflowRunId: activeRun?.id,
        projectId: activeProject?.id,
        type: "conversation",
        message: text,
        createdAt: new Date().toISOString(),
      };
      const responseEvent: WorkflowEvent = {
        id: `${baseId}-resp`,
        workflowRunId: activeRun?.id,
        projectId: activeProject?.id,
        type: "conversation_responded",
        message:
          "Olá! Estou pronto para orquestrar uma missão. Descreva o que você quer que os agentes façam no projeto selecionado.",
        createdAt: new Date(Date.now() + 1).toISOString(),
      };
      setEvents((current) => {
        const next = [...current, userEvent, responseEvent];
        return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
      });
      return;
    }

    // Mission: optionally clear the local view before starting
    if (clearLogsOnNewMission) {
      clearMissionView();
    }

    setSubmitting(true);

    try {
      // Determine execution mode and strategy
      const mode: WorkflowExecutionMode = executionMode === "simulated" ? "simulated" : "real";
      const strategy: RealWorkflowStrategy | undefined =
        executionMode === "multi_agent" ? "multi_agent" :
        executionMode === "real" || executionMode === "controlled_execution" ? "single" :
        undefined;

      // Pick a project (active project or first available)
      const project = activeProject || projects[0];

      // Generate voice context for the command
      const context = await window.fluxora.voice.createFromTranscript({
        transcript: text,
        activeProject: project ? { id: project.id, name: project.name } : null,
        availableProjects: projects.map((p) => ({ id: p.id, name: p.name })),
      });

      if (executionMode === "real") {
        const readyAgents = agents.filter((agent) => isAgentConfiguredForRealExecution(agent, catalog));
        const hasEnabledProvider = Boolean(catalog?.providers.length);
        if (!hasEnabledProvider || readyAgents.length === 0) {
          window.alert(
            "Modo real indisponível. Configure ao menos um provider ativo e um agente com modelo selecionado na tela de Agentes."
          );
          return;
        }
      }

      if (executionMode === "multi_agent") {
        const missingAgentMessage = getMissingAgentConfigMessage(context.intent, context.suggestedAgents);
        if (missingAgentMessage) {
          window.alert(missingAgentMessage);
          return;
        }
      }

      const missionPipeline = resolveMissionPipeline(context.intent);

      // Create the workflow
      const run = await window.fluxora.workflows.create({
        title: context.title || text.slice(0, 60),
        prompt: text,
        generatedContext: JSON.stringify(context, null, 2),
        projectId: project?.id,
        executionMode: mode,
        realStrategy: strategy,
        steps: missionPipeline === "recognition"
          ? [
              { name: "Reconhecimento", type: "planner", agentId: "agent-planner" },
              { name: "Finalização", type: "finalization", agentId: "agent-orchestrator" },
            ]
          : missionPipeline === "validation"
          ? [
              { name: "Planejamento", type: "planner", agentId: "agent-planner" },
              { name: "Testes e Validação", type: "qa", agentId: "agent-qa" },
              { name: "Finalização", type: "finalization", agentId: "agent-orchestrator" },
            ]
          : [
              { name: "Planejamento", type: "planner", agentId: "agent-planner" },
              {
                name: "Desenvolvimento",
                type: "developer",
                agentId: context.suggestedAgents.includes("backend-dev") ? "agent-backend" : "agent-frontend",
              },
              { name: "Testes e Validação", type: "qa", agentId: "agent-qa" },
              { name: "Finalização", type: "finalization", agentId: "agent-orchestrator" },
            ],
      } as any);

      // Set as active run immediately and reload data
      selectedRunIdRef.current = run.id;
      setActiveRun(run);
      await loadData();

      // Execute based on mode
      if (executionMode === "controlled_execution" && canRunControlledExecution) {
        // Controlled execution: dispatch to runner directly
        await window.fluxora.opencode.controlledExecution.run({ workflowRunId: run.id });
        await loadData();
      } else if (executionMode === "real" || executionMode === "multi_agent") {
        // Real/multi_agent: execute directly — auto-approve the initial gate
        // so the real runner starts. The runner creates a contextual final
        // approval only when files are actually changed.
        const pending = await window.fluxora.approvals.listPending();
        const approval = pending.find((a) => a.workflowRunId === run.id);
        if (approval) {
          await window.fluxora.approvals.approve(approval.id);
        }
        selectedRunIdRef.current = run.id;
        await loadData();
      } else {
        // Simulated mode: auto-approve to trigger the simulation immediately
        // (no real changes are made, so this is safe).
        const pending = await window.fluxora.approvals.listPending();
        const approval = pending.find((a) => a.workflowRunId === run.id);
        if (approval) {
          await window.fluxora.approvals.approve(approval.id);
        }
        selectedRunIdRef.current = run.id;
        // Reload data so events from the simulation appear in the EventLog
        await loadData();
      }
    } catch (error) {
      console.error("Failed to execute command:", error);
    } finally {
      setSubmitting(false);
    }
  }, [executionMode, activeProject, projects, canRunControlledExecution, submitting, activeRun, setEvents, clearLogsOnNewMission, clearMissionView, getMissingAgentConfigMessage, agents, catalog]);

  const handleCommandSubmit = useCallback((text: string) => {
    if (!text.trim()) return;

    const intent = classifyMissionIntent(text);
    const precheck = buildMissionPrecheck({
      text,
      intent,
      suggestedAgents: agents.map((agent) => agent.role),
      activeProject: activeProject ? { stack: activeProject.stack } : undefined,
      agents,
      catalog,
    });

    const hasBlockingIssues =
      (executionMode === "real" || executionMode === "multi_agent") && precheck.blockingReasons.length > 0;

    if (hasBlockingIssues) {
      setDiagnosticContext({ intent, suggestedAgents: agents.map((agent) => agent.role) });
      return;
    }

    if (activeProject && developerRecommendation) {
      const appliedAt = new Date().toISOString();
      recordProjectRecommendation(window.localStorage, {
        projectId: activeProject.id,
        developerRole: developerRecommendation.role,
        plannerRole: developerRecommendation.planner?.role,
        qaRole: developerRecommendation.qa?.role,
        appliedAt,
      });
      appendProjectRecommendationHistory(window.localStorage, activeProject.id, {
        id: `${activeProject.id}-${appliedAt}`,
        developerRole: developerRecommendation.role,
        plannerRole: developerRecommendation.planner?.role,
        qaRole: developerRecommendation.qa?.role,
        appliedAt,
        source: "mission",
      });
    }

    executeCommand(text);
  }, [agents, catalog, activeProject, developerRecommendation, executionMode, executeCommand]);

  // Compute result text for drawer
  const missionResultEvents = events.filter(
    (e) => e.type === "mission.result" && (!activeRun || e.workflowRunId === activeRun.id)
  );
  const latestMissionResult = missionResultEvents.length > 0 ? missionResultEvents[missionResultEvents.length - 1] : null;
  const responseResults = opencodeResponses.filter((r) => !activeRun || r.workflowRunId === activeRun.id);
  const latestResponse = responseResults.length > 0 ? responseResults[responseResults.length - 1] : null;
  const resultTextForDrawer = latestMissionResult?.message || latestResponse?.text || null;

  return (
    <div className="space-y-6 max-w-[1800px]">
      {/* ─── 1. Mission Header ─── */}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="flux-mission-title">Central de Comando</h1>
          <p className="flux-mission-subtitle mt-1.5">
            Envie missões e acompanhe a execução em tempo real
          </p>
        </div>
      </div>

      {/* ─── Active Project Block ─── */}
      <ActiveProjectBlock
        project={activeProject}
        gitAvailable={gitAvailable}
        opencodeStatus={opencodeStatus}
        branch={gitBranch}
        onSwitchProject={() => setShowProjectSwitcher(true)}
        onValidate={handleValidateProject}
        isValidating={isValidating}
        validationResult={validationResult}
        agents={agents}
        providers={providers}
        catalog={catalog}
      />

      {/* ─── Main Command Console ─── */}
      <CommandPanel
        onSubmit={handleCommandSubmit}
        placeholder="Digite uma missão ou converse com o Orquestrador..."
        isExecuting={isExecuting || submitting}
        executionMode={executionMode}
        onModeChange={handleExecutionModeChange}
        activeProjectName={activeProject?.name}
        activeProjectPath={activeProject?.path}
        projectValid={projectValid}
        projectBlocker={commandBlocker}
        clearLogsOnNewMission={clearLogsOnNewMission}
        onClearLogsOnNewMissionChange={handleClearLogsOnNewMissionChange}
        onRequestDiagnostics={handleRequestDiagnostics}
        text={commandText}
        onTextChange={setCommandText}
        developerRecommendation={developerRecommendation}
      />

      {/* ─── Active job / Pending approval ─── */}
      {pendingFinalApproval && (
        <div className="flux-cockpit-card p-5">
          <FinalApprovalBar approval={pendingFinalApproval} runPrompt={activeRun?.prompt || recentRuns.find((r) => r.id === pendingFinalApproval.workflowRunId)?.prompt} onApprove={handleApproveFinal} onReject={handleRejectFinal} />
        </div>
      )}
      {/* ─── Execution Flow ─── */}
      <ExecutionFlowCard
        run={activeRun}
        activeJob={activeJob && ["queued", "running"].includes(activeJob.status) ? activeJob : null}
        activeProject={activeProject}
        executionMode={executionMode}
        events={events}
        onCancel={handleCancelActiveJob}
      />

      {/* ─── Controlled Execution Panel ─── */}
      {executionMode === "controlled_execution" && canRunControlledExecution && (
        <ControlledExecutionPanel />
      )}

      {/* ─── Mission Result (compact card) ─── */}
      <MissionResultCompactCard
        responses={opencodeResponses}
        events={events}
        activeRun={activeRun}
        onOpenDrawer={() => setShowResultDrawer(true)}
        onOpenDetails={() => activeRun?.id && navigate(`/executions/${activeRun.id}`)}
        onRerun={activeRun?.status === "failed" ? handleRerunActive : undefined}
      />

      {/* ─── Mission Terminal (EventLog) ─── */}
      <div className="flux-cockpit-card-elevated overflow-hidden">
        <EventLog
          key={activeProject?.id || "no-project"}
          events={events}
          workflowRunId={activeRun?.id}
          onClear={clearMissionView}
        />
      </div>

      {/* ─── Pending Approvals (non-final) ─── */}
      {allApprovals.filter((a) => a.status === "pending" && !recentRuns.some((r) => r.finalApprovalId === a.id)).length > 0 && (
        <div className="flux-cockpit-card p-5">
          <div className="text-[13px] font-semibold text-text-primary mb-3">Aprovações pendentes</div>
          <div className="space-y-2">
            {allApprovals
              .filter((a) => a.status === "pending" && !recentRuns.some((r) => r.finalApprovalId === a.id))
              .map((a) => {
                const runForApproval = activeRun && activeRun.id === a.workflowRunId ? activeRun : recentRuns.find((r) => r.id === a.workflowRunId);
                const ctx = validateApprovalContext(a, { runPrompt: runForApproval?.prompt });
                const canApprove = ctx.canApprove;
                return (
                  <div key={a.id} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
                    canApprove ? "border-border-subtle" : "border-error/30"
                  } bg-bg-deep/40`}>
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-text-primary truncate">{a.title}</div>
                      <div className="text-[11px] text-text-muted truncate">{a.description?.split("\n")[0]}</div>
                      {!canApprove && (
                        <div className="text-[10px] text-error mt-0.5">{ctx.invalidReason || "Contexto insuficiente"}</div>
                      )}
                      {canApprove && ctx.invalidReason && (
                        <div className="text-[10px] text-warning mt-0.5">{ctx.invalidReason}</div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {canApprove ? (
                        <>
                          <button
                            onClick={async () => { await window.fluxora.approvals.approve(a.id); await loadData(); }}
                            className="no-drag flux-btn-success h-8 px-3 text-[11px]"
                          >
                            Aprovar
                          </button>
                          <button
                            onClick={async () => { await window.fluxora.approvals.reject(a.id); await loadData(); }}
                            className="no-drag flux-btn-danger h-8 px-3 text-[11px]"
                          >
                            Rejeitar
                          </button>
                        </>
                      ) : (
                        <span className="text-[10px] text-error px-2">Inválida</span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ─── Recent Executions ─── */}
      <RecentExecutions
        key={activeProject?.id || "no-project"}
        runs={recentRuns}
        pendingApprovals={allApprovals}
        onSelectRun={(run) => {
          selectedRunIdRef.current = run.id;
          setActiveRun(run);
        }}
        onViewResult={(run) => {
          setResultDrawerRun(run);
          setShowResultDrawer(true);
        }}
      />

      {/* ─── Modals ─── */}
      <ProjectSwitcherModal
        open={showProjectSwitcher}
        onClose={() => setShowProjectSwitcher(false)}
        projects={projects}
        currentProjectId={activeProject?.id}
        onSelect={handleSelectProject}
      />

      {diagnosticContext && (
        <MissionDiagnosticModal
          intent={diagnosticContext.intent}
          suggestedAgents={diagnosticContext.suggestedAgents}
          agents={agents}
          catalog={catalog}
          hasEnabledProvider={providers.some((provider) => provider.enabled) || Boolean(globalDefault.providerId && globalDefault.modelName)}
          activeProjectStack={activeProject?.stack}
          savedRecommendation={savedRecommendation}
          recommendationHistory={recommendationHistory}
          onClose={closeDiagnostics}
          onGoToAgents={goToAgentsFromDiagnostics}
        />
      )}

      <MissionResultDrawer
        open={showResultDrawer}
        onClose={() => { setShowResultDrawer(false); setResultDrawerRun(null); }}
        resultText={resultTextForDrawer}
        run={resultDrawerRun || activeRun}
        projectName={activeProject?.name}
        isError={(resultDrawerRun || activeRun)?.status === "failed"}
      />
    </div>
  );
}

function MissionResultPanel({ responses, events, activeRun }: { responses: OpenCodeResponse[]; events: WorkflowEvent[]; activeRun: WorkflowRun | null }) {
  // Find mission result from workflow events (primary source) or opencode responses (fallback)
  const missionResultEvents = events.filter(
    (e) => e.type === "mission.result" && (!activeRun || e.workflowRunId === activeRun.id)
  );
  const latestMissionResult = missionResultEvents.length > 0 ? missionResultEvents[missionResultEvents.length - 1] : null;

  // Fallback: opencode responses
  const responseResults = responses.filter((r) => !activeRun || r.workflowRunId === activeRun.id);
  const latestResponse = responseResults.length > 0 ? responseResults[responseResults.length - 1] : null;

  const resultText = latestMissionResult?.message || latestResponse?.text || null;

  // Check if the run completed with an error
  const isError = activeRun?.status === "failed";

  if (!resultText && !isError) return null;

  return (
    <div className="flux-cockpit-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
          isError ? "bg-error-soft border-error/25" : "bg-success-soft border-success/25"
        }`}>
          <FileText size={15} className={isError ? "text-error" : "text-success"} />
        </div>
        <div className="flex-1">
          <span className="flux-section-label">
            {isError ? "Erro da missão" : "Resultado da missão"}
          </span>
        </div>
      </div>
      <div className="p-5">
        {resultText ? (
          <div className="flux-body-text max-h-[500px] overflow-auto">
            <MarkdownRenderer content={resultText} />
          </div>
        ) : (
          <div className="text-[13px] text-error">
            A execução falhou. Verifique os logs para mais detalhes.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MissionResultCompactCard — card-resumo compacto do resultado ──────────

function MissionResultCompactCard({
  responses,
  events,
  activeRun,
  onOpenDrawer,
  onOpenDetails,
  onRerun,
}: {
  responses: OpenCodeResponse[];
  events: WorkflowEvent[];
  activeRun: WorkflowRun | null;
  onOpenDrawer: () => void;
  onOpenDetails?: () => void;
  onRerun?: () => void;
}) {
  const missionResultEvents = events.filter(
    (e) => e.type === "mission.result" && (!activeRun || e.workflowRunId === activeRun.id)
  );
  const latestMissionResult = missionResultEvents.length > 0 ? missionResultEvents[missionResultEvents.length - 1] : null;
  const responseResults = responses.filter((r) => !activeRun || r.workflowRunId === activeRun.id);
  const latestResponse = responseResults.length > 0 ? responseResults[responseResults.length - 1] : null;
  const resultText = latestMissionResult?.message || latestResponse?.text || null;
  const isError = activeRun?.status === "failed";

  if (!resultText && !isError) return null;

  // Resumo: primeiras 3 linhas não vazias
  const summaryLines = resultText
    ? resultText.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n")
    : null;

  const handleCopy = async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flux-cockpit-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
          isError ? "bg-error-soft border-error/25" : "bg-success-soft border-success/25"
        }`}>
          <FileText size={15} className={isError ? "text-error" : "text-success"} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="flux-section-label">
            {isError ? "Erro da missão" : "Resultado da missão"}
          </span>
          {activeRun?.createdAt && (
            <span className="text-[11px] text-text-muted ml-3">
              {new Date(activeRun.createdAt).toLocaleString("pt-BR")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isError && onRerun && (
            <ActionButton
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={onRerun}
            >
              Tentar novamente
            </ActionButton>
          )}
          <ActionButton
            variant="ghost"
            size="sm"
            icon={<Eye size={13} />}
            onClick={onOpenDrawer}
          >
            Ver resultado completo
          </ActionButton>
          {resultText && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={<Copy size={13} />}
              onClick={handleCopy}
            >
              Copiar
            </ActionButton>
          )}
          {activeRun?.id && onOpenDetails && (
            <ActionButton
              variant="ghost"
              size="sm"
              icon={<ExternalLink size={13} />}
              onClick={onOpenDetails}
            >
              Abrir detalhes
            </ActionButton>
          )}
        </div>
      </div>
      {summaryLines && (
        <div className="px-6 py-3">
          <div className="text-[12px] text-text-secondary line-clamp-3 leading-relaxed">
            <MarkdownRenderer content={summaryLines} />
          </div>
        </div>
      )}
    </div>
  );
}

export function FinalApprovalBar({
  approval,
  runPrompt,
  onApprove,
  onReject,
}: {
  approval: Approval;
  runPrompt?: string;
  onApprove: (a: Approval) => void;
  onReject: (a: Approval) => void;
}) {
  const impactLabel = approval.impact === "high" ? "Alto" : approval.impact === "medium" ? "Médio" : "Baixo";
  const descriptionLines = (approval.description || "").split("\n");

  // Validar contexto
  const ctx = validateApprovalContext(approval, { runPrompt });
  const canApprove = ctx.canApprove;

  return (
    <div className="w-full">
      {/* Alerta de contexto insuficiente */}
      {!canApprove && (
        <div className="rounded-lg border border-error/30 bg-error-soft/10 p-4 mb-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-error flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-semibold text-error">Aprovação inválida: contexto insuficiente</div>
              <div className="text-[11.5px] text-text-secondary mt-1">
                O sistema não conseguiu determinar o que precisa ser aprovado.
                Abra os detalhes da execução para revisar os logs.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${
          canApprove ? "bg-warning-soft border-warning/25" : "bg-error-soft border-error/25"
        }`}>
          <AlertTriangle size={18} className={canApprove ? "text-warning" : "text-error"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-text-primary">
            {canApprove ? "Aprovação necessária" : "Aprovação com contexto insuficiente"}
          </div>
          <div className="text-[12px] text-text-secondary mt-0.5">{approval.title}</div>
        </div>
        <span className={`flux-badge text-[10.5px] ${
          approval.impact === "high" ? "flux-badge-warning" : approval.impact === "medium" ? "flux-badge-accent" : "flux-badge-success"
        }`}>
          Impacto: {impactLabel}
        </span>
      </div>

      {/* Rich description */}
      <div className="rounded-lg border border-border-subtle bg-bg-deep/40 p-4 mb-3">
        {descriptionLines.map((line, i) => (
          <div key={i} className={`text-[12px] leading-relaxed ${
            line.startsWith("- ") ? "text-text-primary font-mono ml-2" :
            line.startsWith("Arquivos") || line.startsWith("Resumo") || line.startsWith("Impacto") || line.startsWith("Agente") || line.startsWith("Missão") || line.startsWith("Motivo") || line.startsWith("QA") || line.startsWith("Planner") || line.startsWith("Developer") || line.startsWith("Projeto") ? "text-text-secondary font-semibold" :
            line.match(/^\d+\.\s/) ? "text-text-primary ml-2" :
            line.trim() === "" ? "h-2" :
            "text-text-muted"
          }`}>
            {line}
          </div>
        ))}
      </div>

      {/* Botões — só mostra Aprovar/Rejeitar se canApprove */}
      {canApprove ? (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onApprove(approval)}
              className="no-drag flux-btn-success h-10 px-4 text-[12.5px]"
            >
              <CheckCircle2 size={14} /> Aprovar
            </button>
            <button
              onClick={() => onReject(approval)}
              className="no-drag flux-btn-danger h-10 px-4 text-[12.5px]"
            >
              <XCircle size={14} /> Rejeitar
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-border-subtle text-[10.5px] text-text-muted leading-relaxed">
            Rejeitar mantém as alterações no diretório do projeto. Use <code className="px-1 rounded bg-bg-input border border-border-subtle">git diff</code> ou <code className="px-1 rounded bg-bg-input border border-border-subtle">git checkout</code> para revisar/descartar manualmente.
          </div>
        </>
      ) : (
        <div className="text-[11px] text-text-muted">
          Esta aprovação não pode ser aprovada ou rejeitada porque o contexto é insuficiente.
        </div>
      )}
    </div>
  );
}

export function KpiPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flux-kpi-card">
      <span className="flux-kpi-value">{value}</span>
      <span className="flux-kpi-label">{label}</span>
    </div>
  );
}

export function ControlledExecutionGate({
  controlledProject,
  hasProjectPath,
  isOpencodeUsable,
  gitAvailable,
  canRun,
}: {
  controlledProject: Project | null;
  hasProjectPath: boolean;
  isOpencodeUsable: boolean;
  gitAvailable: boolean | null;
  canRun: boolean;
}) {
  const blockers: string[] = [];
  if (!controlledProject) {
    blockers.push("Projeto Fluxora não está cadastrado na lista de projetos.");
  } else if (!hasProjectPath) {
    blockers.push("Projeto atual não possui caminho local configurado.");
  }
  if (!isOpencodeUsable) {
    blockers.push("OpenCode ainda não foi validado. Execute o diagnóstico antes.");
  }
  if (gitAvailable === false) {
    blockers.push("Git não está disponível para o projeto selecionado.");
  }

  return (
    <div className="mt-4 pt-4 border-t border-border-subtle">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-soft border border-accent/25 flex items-center justify-center">
            <ShieldCheck size={18} className="text-accent" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-text-primary">Execução Controlada</div>
            <div className="text-[11.5px] text-text-muted">
              Sandbox com diff, aprovação final e alertas de segurança
            </div>
          </div>
        </div>
        {canRun && (
          <span className="flux-badge flux-badge-success">
            <CheckCircle2 size={12} />
            Pronto para executar
          </span>
        )}
      </div>

      {blockers.length > 0 && (
        <div className="mt-3 space-y-2">
          {blockers.map((msg) => (
            <div key={msg} className="flex items-start gap-2.5 text-[12px] text-text-secondary">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-warning" />
              <span>{msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
