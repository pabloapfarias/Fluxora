import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Project,
  WorkflowRun,
  Agent,
  AgentConfig,
  OpenCodeCatalogResult,
  AgentStepOutput,
} from "@fluxora/shared";
import { isAgentConfiguredForRealExecution } from "@fluxora/shared";
import { loadProviderCatalog } from "../lib/providerCatalog";

// ── Token estimation constants ──────────────────────────────────────────────
const CHARS_PER_TOKEN = 3.5;
const COST_PER_1K_TOKENS = 0.005;
const BASE_TOKENS_PER_RUN = 45_000;

// ── Period presets ──────────────────────────────────────────────────────────
export type UsagePeriod = "today" | "week" | "month" | "quarter" | "year" | "all" | "custom";

export interface CustomDateRange {
  from: string;
  to: string;
}

export interface UsageFilters {
  period: UsagePeriod;
  customRange?: CustomDateRange;
  projectId?: string;
}

// ── Computed stats ──────────────────────────────────────────────────────────
export interface ProjectUsage {
  projectId: string;
  projectName: string;
  runs: number;
  completedRuns: number;
  failedRuns: number;
  estimatedTokens: number;
  estimatedCost: number;
}

export interface DailyUsage {
  date: string;
  runs: number;
  estimatedTokens: number;
  estimatedCost: number;
}

export interface MonthlyUsage {
  month: string;
  runs: number;
  estimatedTokens: number;
  estimatedCost: number;
}

export interface ModelUsage {
  modelId: string;
  modelName: string;
  agentCount: number;
  agentNames: string[];
  isReady: boolean;
}

export interface AgentUsage {
  agentId: string;
  agentName: string;
  agentRole: string;
  modelName?: string;
  isReady: boolean;
  runs: number;
  estimatedTokens: number;
  estimatedCost: number;
  successRate: number;
}

export interface AggregatedMetrics {
  totalModels: number;
  totalAgents: number;
  readyAgents: number;
  averageSuccessRate: number;
  mostUsedModel?: string;
}

export interface UsageStats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  estimatedTokens: number;
  estimatedCost: number;
  projectCount: number;

  tokensLimit: number;
  costLimit: number;
  runsLimit: number;

  byProject: ProjectUsage[];
  byDay: DailyUsage[];
  byMonth: MonthlyUsage[];

  modelMetrics: ModelUsage[];
  agentMetrics: AgentUsage[];
  aggregatedMetrics: AggregatedMetrics;

  periodRunsPercent: number;
  periodTokensPercent: number;
  periodCostPercent: number;

  filteredRuns: WorkflowRun[];
}

// ── Period date helpers ─────────────────────────────────────────────────────
function getPeriodRange(period: UsagePeriod, custom?: CustomDateRange): { from: Date; to: Date } {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case "today":
      return { from: startOfDay, to: endOfDay };
    case "week": {
      const dayOfWeek = now.getDay();
      const monday = new Date(startOfDay);
      monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
      return { from: monday, to: endOfDay };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay };
    case "quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), qMonth, 1), to: endOfDay };
    }
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay };
    case "all":
      return { from: new Date(2024, 0, 1), to: endOfDay };
    case "custom": {
      if (custom?.from && custom?.to) {
        return {
          from: new Date(custom.from + "T00:00:00"),
          to: new Date(custom.to + "T23:59:59"),
        };
      }
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay };
    }
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay };
  }
}

function isRunInPeriod(run: WorkflowRun, from: Date, to: Date): boolean {
  const created = new Date(run.createdAt);
  return created >= from && created <= to;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toISOMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function estimateTokensForRun(run: WorkflowRun): number {
  const promptTokens = Math.ceil((run.prompt?.length || 0) / CHARS_PER_TOKEN);
  const contextTokens = run.generatedContext
    ? Math.ceil(run.generatedContext.length / CHARS_PER_TOKEN)
    : 0;
  return BASE_TOKENS_PER_RUN + promptTokens + contextTokens;
}

function estimateCostForTokens(tokens: number): number {
  return (tokens / 1000) * COST_PER_1K_TOKENS;
}

function extractModelName(modelName?: string): string {
  if (!modelName) return "";
  const parts = modelName.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : modelName;
}

// ── Settings keys ───────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  tokensLimit: "fluxora:usage:tokensLimit",
  costLimit: "fluxora:usage:costLimit",
  runsLimit: "fluxora:usage:runsLimit",
};

function readLimits(): { tokensLimit: number; costLimit: number; runsLimit: number } {
  try {
    const tl = localStorage.getItem(STORAGE_KEYS.tokensLimit);
    const cl = localStorage.getItem(STORAGE_KEYS.costLimit);
    const rl = localStorage.getItem(STORAGE_KEYS.runsLimit);
    return {
      tokensLimit: tl ? parseFloat(tl) : 10,
      costLimit: cl ? parseFloat(cl) : 200,
      runsLimit: rl ? parseInt(rl, 10) : 100,
    };
  } catch {
    return { tokensLimit: 10, costLimit: 200, runsLimit: 100 };
  }
}

export function saveLimits(limits: { tokensLimit?: number; costLimit?: number; runsLimit?: number }) {
  try {
    if (limits.tokensLimit !== undefined) localStorage.setItem(STORAGE_KEYS.tokensLimit, String(limits.tokensLimit));
    if (limits.costLimit !== undefined) localStorage.setItem(STORAGE_KEYS.costLimit, String(limits.costLimit));
    if (limits.runsLimit !== undefined) localStorage.setItem(STORAGE_KEYS.runsLimit, String(limits.runsLimit));
  } catch {
    // ignore storage errors
  }
}

// ── Main hook ───────────────────────────────────────────────────────────────
export function useUsageStats(filters: UsageFilters) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allRuns, setAllRuns] = useState<WorkflowRun[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [catalog, setCatalog] = useState<OpenCodeCatalogResult | null>(null);
  const [stepOutputsMap, setStepOutputsMap] = useState<Map<string, AgentStepOutput[]>>(new Map());
  const loadGenRef = useRef(0);

  const loadData = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const [p, r, a, providers] = await Promise.all([
        window.fluxora.projects.list(),
        window.fluxora.workflows.list(),
        window.fluxora.agents.listConfigs(),
        window.fluxora.providers.list(),
      ]);
      const c = await loadProviderCatalog(providers).catch(() => null);
      if (gen !== loadGenRef.current) return;
      setProjects(p);
      setAllRuns(r);
      setAgents(a.map(toLegacyAgent));
      setCatalog(c);

      // Fetch step outputs for all runs (batch)
      const newMap = new Map<string, AgentStepOutput[]>();
      const outputPromises = r.map(async (run) => {
        try {
          const outputs = await window.fluxora.workflows.listAgentOutputs(run.id);
          if (outputs.length > 0) newMap.set(run.id, outputs);
        } catch {
          // silently fail per-run
        }
      });
      await Promise.all(outputPromises);
      if (gen !== loadGenRef.current) return;
      setStepOutputsMap(newMap);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => {
      clearInterval(interval);
      loadGenRef.current++;
    };
  }, [loadData]);

  const stats = useMemo<UsageStats>(() => {
    const { from, to } = getPeriodRange(filters.period, filters.customRange);
    const limits = readLimits();

    let filtered = allRuns.filter((run) => isRunInPeriod(run, from, to));
    if (filters.projectId) {
      filtered = filtered.filter((run) => run.projectId === filters.projectId);
    }

    let totalTokens = 0;
    let totalCost = 0;
    let completedRuns = 0;
    let failedRuns = 0;
    let runningRuns = 0;

    for (const run of filtered) {
      const tokens = estimateTokensForRun(run);
      totalTokens += tokens;
      totalCost += estimateCostForTokens(tokens);
      if (run.status === "completed") completedRuns++;
      else if (run.status === "failed" || run.status === "rejected") failedRuns++;
      else if (run.status === "running" || run.status === "approved") runningRuns++;
    }

    // Project breakdown
    const projectMap = new Map<string, { name: string; runs: number; completed: number; failed: number; tokens: number; cost: number }>();
    for (const run of filtered) {
      const pid = run.projectId || "__none__";
      const project = projects.find((p) => p.id === pid);
      const existing = projectMap.get(pid) || {
        name: project?.name || "Sem projeto",
        runs: 0, completed: 0, failed: 0, tokens: 0, cost: 0,
      };
      existing.runs++;
      if (run.status === "completed") existing.completed++;
      else if (run.status === "failed" || run.status === "rejected") existing.failed++;
      const tokens = estimateTokensForRun(run);
      existing.tokens += tokens;
      existing.cost += estimateCostForTokens(tokens);
      projectMap.set(pid, existing);
    }

    const byProject: ProjectUsage[] = Array.from(projectMap.entries())
      .map(([pid, data]) => ({
        projectId: pid, projectName: data.name, runs: data.runs,
        completedRuns: data.completed, failedRuns: data.failed,
        estimatedTokens: data.tokens, estimatedCost: data.cost,
      }))
      .sort((a, b) => b.runs - a.runs);

    // Model metrics
    const modelMetrics: ModelUsage[] = (() => {
      if (!catalog) return [];
      const modelMap = new Map<string, { modelName: string; agentNames: string[]; isReady: boolean }>();
      for (const agent of agents) {
        if (!agent.modelName) continue;
        const displayName = extractModelName(agent.modelName);
        const existing = modelMap.get(agent.modelName) || {
          modelName: displayName, agentNames: [],
          isReady: isAgentConfiguredForRealExecution(agent, catalog),
        };
        existing.agentNames.push(agent.name);
        modelMap.set(agent.modelName, existing);
      }
      return Array.from(modelMap.entries())
        .map(([modelId, data]) => ({
          modelId, modelName: data.modelName, agentCount: data.agentNames.length,
          agentNames: data.agentNames, isReady: data.isReady,
        }))
        .sort((a, b) => b.agentCount - a.agentCount);
    })();

    // Agent metrics (using real step outputs)
    const agentMetrics: AgentUsage[] = (() => {
      const agentRunMap = new Map<string, { runIds: Set<string>; tokens: number; completed: number; failed: number }>();

      for (const run of filtered) {
        const outputs = stepOutputsMap.get(run.id);
        if (!outputs || outputs.length === 0) continue;
        for (const output of outputs) {
          const agent = agents.find(
            (a) => a.role === output.agentRole || a.name === output.agentName
          );
          if (!agent) continue;
          const existing = agentRunMap.get(agent.id) || {
            runIds: new Set<string>(), tokens: 0, completed: 0, failed: 0,
          };
          existing.runIds.add(run.id);
          existing.tokens += estimateTokensForRun(run);
          if (output.status === "completed") existing.completed++;
          else if (output.status === "failed") existing.failed++;
          agentRunMap.set(agent.id, existing);
        }
      }

      return agents.map((agent) => {
        const data = agentRunMap.get(agent.id);
        const runs = data ? data.runIds.size : 0;
        const estimatedTokens = data ? data.tokens : 0;
        const estimatedCost = estimateCostForTokens(estimatedTokens);
        const totalSteps = data ? data.completed + data.failed : 0;
        const successRate = totalSteps > 0 ? (data!.completed / totalSteps) * 100 : 0;
        return {
          agentId: agent.id, agentName: agent.name, agentRole: agent.role,
          modelName: agent.modelName ? extractModelName(agent.modelName) : undefined,
          isReady: isAgentConfiguredForRealExecution(agent, catalog),
          runs, estimatedTokens, estimatedCost, successRate,
        };
      }).sort((a, b) => b.runs - a.runs);
    })();

    // Aggregated metrics
    const aggregatedMetrics: AggregatedMetrics = (() => {
      const totalModels = modelMetrics.length;
      const totalAgents = agentMetrics.length;
      const readyAgents = agentMetrics.filter((a) => a.isReady).length;
      const averageSuccessRate = agentMetrics.length > 0
        ? agentMetrics.reduce((sum, a) => sum + a.successRate, 0) / agentMetrics.length
        : 0;
      const modelsWithAgents = modelMetrics.filter((m) => m.agentCount > 0);
      const mostUsedModel = modelsWithAgents.length > 0
        ? modelsWithAgents.reduce((prev, curr) => (curr.agentCount > prev.agentCount ? curr : prev)).modelName
        : undefined;
      return { totalModels, totalAgents, readyAgents, averageSuccessRate, mostUsedModel };
    })();

    // Daily breakdown
    const dayMap = new Map<string, { runs: number; tokens: number; cost: number }>();
    const dayIter = new Date(from);
    while (dayIter <= to) {
      dayMap.set(toISODate(dayIter), { runs: 0, tokens: 0, cost: 0 });
      dayIter.setDate(dayIter.getDate() + 1);
    }

    const maxDays = 90;
    if (dayMap.size > maxDays) {
      const sortedKeys = Array.from(dayMap.keys()).sort();
      const keepKeys = sortedKeys.slice(-maxDays);
      const trimmed = new Map<string, { runs: number; tokens: number; cost: number }>();
      for (const k of keepKeys) trimmed.set(k, dayMap.get(k)!);
      for (const run of filtered) {
        const d = toISODate(new Date(run.createdAt));
        const entry = trimmed.get(d);
        if (entry) {
          entry.runs++;
          const tokens = estimateTokensForRun(run);
          entry.tokens += tokens;
          entry.cost += estimateCostForTokens(tokens);
        }
      }
      const byDay: DailyUsage[] = Array.from(trimmed.entries())
        .map(([date, data]) => ({ date, runs: data.runs, estimatedTokens: data.tokens, estimatedCost: data.cost }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const byMonth: MonthlyUsage[] = aggregateMonthly(filtered);
      return {
        totalRuns: filtered.length, completedRuns, failedRuns, runningRuns,
        estimatedTokens: totalTokens, estimatedCost: totalCost, projectCount: byProject.length,
        tokensLimit: limits.tokensLimit, costLimit: limits.costLimit, runsLimit: limits.runsLimit,
        byProject, byDay, byMonth, modelMetrics, agentMetrics, aggregatedMetrics,
        periodTokensPercent: limits.tokensLimit > 0 ? (totalTokens / (limits.tokensLimit * 1_000_000)) * 100 : 0,
        periodCostPercent: limits.costLimit > 0 ? (totalCost / limits.costLimit) * 100 : 0,
        periodRunsPercent: limits.runsLimit > 0 ? (filtered.length / limits.runsLimit) * 100 : 0,
        filteredRuns: filtered,
      };
    }

    for (const run of filtered) {
      const d = toISODate(new Date(run.createdAt));
      const entry = dayMap.get(d);
      if (entry) {
        entry.runs++;
        const tokens = estimateTokensForRun(run);
        entry.tokens += tokens;
        entry.cost += estimateCostForTokens(tokens);
      }
    }

    const byDay: DailyUsage[] = Array.from(dayMap.entries())
      .map(([date, data]) => ({ date, runs: data.runs, estimatedTokens: data.tokens, estimatedCost: data.cost }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const byMonth: MonthlyUsage[] = aggregateMonthly(filtered);

    return {
      totalRuns: filtered.length, completedRuns, failedRuns, runningRuns,
      estimatedTokens: totalTokens, estimatedCost: totalCost, projectCount: byProject.length,
      tokensLimit: limits.tokensLimit, costLimit: limits.costLimit, runsLimit: limits.runsLimit,
      byProject, byDay, byMonth, modelMetrics, agentMetrics, aggregatedMetrics,
      periodTokensPercent: limits.tokensLimit > 0 ? (totalTokens / (limits.tokensLimit * 1_000_000)) * 100 : 0,
      periodCostPercent: limits.costLimit > 0 ? (totalCost / limits.costLimit) * 100 : 0,
      periodRunsPercent: limits.runsLimit > 0 ? (filtered.length / limits.runsLimit) * 100 : 0,
      filteredRuns: filtered,
    };
  }, [allRuns, projects, agents, catalog, stepOutputsMap, filters]);

  return { stats, projects, reload: loadData };
}

function toLegacyAgent(agent: AgentConfig): Agent {
  const role =
    agent.role === "developer"
      ? "backend-dev"
      : agent.role === "finalizer"
        ? "custom:finalizer"
        : agent.role === "custom"
          ? "custom:agent"
          : agent.role;

  return {
    id: agent.id,
    name: agent.name,
    role,
    description: agent.description || "",
    canEditFiles: agent.role === "developer",
    canRunCommands: false,
    requiresApproval: false,
    modelProviderId: agent.providerId,
    modelName: agent.model,
    enabled: agent.status === "enabled",
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function aggregateMonthly(runs: WorkflowRun[]): MonthlyUsage[] {
  const map = new Map<string, { runs: number; tokens: number; cost: number }>();
  for (const run of runs) {
    const key = toISOMonth(new Date(run.createdAt));
    const entry = map.get(key) || { runs: 0, tokens: 0, cost: 0 };
    entry.runs++;
    const tokens = estimateTokensForRun(run);
    entry.tokens += tokens;
    entry.cost += estimateCostForTokens(tokens);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([month, data]) => ({ month, runs: data.runs, estimatedTokens: data.tokens, estimatedCost: data.cost }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function formatTokenCount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export function formatCost(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `<$0.01`;
}
