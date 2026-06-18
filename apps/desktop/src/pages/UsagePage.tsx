import { useCallback, useState } from "react";
import {
  BarChart3, TrendingUp, DollarSign, Zap, FolderKanban,
  ChevronDown, Settings, Filter, Cpu, Bot, Activity,
  CheckCircle2, XCircle,
} from "lucide-react";
import {
  useUsageStats, formatTokenCount, formatCost, saveLimits,
  type UsagePeriod, type UsageFilters,
} from "../hooks/useUsageStats";
import { BarChart, AreaChart, DonutChart, SparkLine } from "../components/charts/UsageCharts";
import { formatAgentRoleLabel, type AgentRole } from "@fluxora/shared";

const PERIOD_OPTIONS: Array<{ value: UsagePeriod; label: string; shortLabel: string }> = [
  { value: "today", label: "Hoje", shortLabel: "Hoje" },
  { value: "week", label: "Esta Semana", shortLabel: "Semana" },
  { value: "month", label: "Este Mês", shortLabel: "Mês" },
  { value: "quarter", label: "Este Trimestre", shortLabel: "Tri" },
  { value: "year", label: "Este Ano", shortLabel: "Ano" },
  { value: "all", label: "Todo o Período", shortLabel: "Tudo" },
];

export function UsagePage() {
  const [filters, setFilters] = useState<UsageFilters>({ period: "month" });
  const [showSettings, setShowSettings] = useState(false);
  const { stats, projects } = useUsageStats(filters);

  const handlePeriodChange = useCallback((period: UsagePeriod) => {
    setFilters((prev) => ({ ...prev, period, customRange: undefined }));
  }, []);
  const handleProjectChange = useCallback((projectId: string | undefined) => {
    setFilters((prev) => ({ ...prev, projectId }));
  }, []);

  return (
    <div className="space-y-6 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-text-primary leading-tight flex items-center gap-3">
            <BarChart3 size={22} className="text-accent" />
            Uso & Analytics
          </h1>
          <p className="text-[12.5px] text-text-muted mt-1">Acompanhe o consumo de tokens, custos e execuções por período e projeto</p>
        </div>
        <button onClick={() => setShowSettings(!showSettings)} className="no-drag flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-card text-[12px] text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors">
          <Settings size={13} /> Limiares
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-bg-card rounded-xl border border-border-subtle p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => handlePeriodChange(opt.value)} className={`no-drag px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all ${filters.period === opt.value ? "bg-accent text-white shadow-sm" : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"}`}>{opt.shortLabel}</button>
          ))}
        </div>
        <div className="relative">
          <select value={filters.projectId || ""} onChange={(e) => handleProjectChange(e.target.value || undefined)} className="no-drag appearance-none bg-bg-card border border-border-subtle rounded-lg px-3 py-1.5 pr-8 text-[11.5px] text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors cursor-pointer">
            <option value="">Todos os projetos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        </div>
        {(filters.projectId || filters.period !== "month") && (
          <button onClick={() => setFilters({ period: "month" })} className="no-drag flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-accent hover:bg-accent-soft transition-colors"><Filter size={11} /> Limpar filtros</button>
        )}
      </div>

      {showSettings && <UsageSettings onClose={() => setShowSettings(false)} />}

      {/* Aggregated KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Cpu size={16} />} label="Modelos em Uso" value={String(stats.aggregatedMetrics.totalModels)} limit="configurados nos agentes" percent={0} color="info" />
        <KpiCard icon={<Bot size={16} />} label="Agentes Prontos" value={String(stats.aggregatedMetrics.readyAgents)} limit={`${stats.aggregatedMetrics.totalAgents} total`} percent={0} color="success" />
        <KpiCard icon={<Activity size={16} />} label="Taxa Sucesso Média" value={`${Math.round(stats.aggregatedMetrics.averageSuccessRate)}%`} limit="todos agentes" percent={0} color="warning" />
        <KpiCard icon={<TrendingUp size={16} />} label="Modelo Mais Usado" value={stats.aggregatedMetrics.mostUsedModel || "—"} limit={stats.aggregatedMetrics.mostUsedModel ? "por nº de agentes" : "nenhum configurado"} percent={0} color="violet" />
      </div>

      {/* Consumption KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Zap size={16} />} label="Tokens" value={formatTokenCount(stats.estimatedTokens)} limit={`${stats.tokensLimit}M`} percent={stats.periodTokensPercent} color="accent" sparkData={stats.byDay.map((d) => d.estimatedTokens)} />
        <KpiCard icon={<DollarSign size={16} />} label="Custo Estimado" value={formatCost(stats.estimatedCost)} limit={formatCost(stats.costLimit)} percent={stats.periodCostPercent} color="warning" sparkData={stats.byDay.map((d) => d.estimatedCost)} />
        <KpiCard icon={<TrendingUp size={16} />} label="Execuções" value={String(stats.totalRuns)} limit={`${stats.runsLimit}`} percent={stats.periodRunsPercent} color="success" sparkData={stats.byDay.map((d) => d.runs)} />
        <KpiCard icon={<FolderKanban size={16} />} label="Projetos Ativos" value={String(stats.projectCount)} limit={`${projects.length} total`} percent={0} color="info" />
      </div>

      {/* Models & Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
          <div className="flex items-center gap-2 mb-4"><Cpu size={16} className="text-blue-info" /><span className="text-[13px] font-semibold text-text-primary">Modelos Configurados</span></div>
          {stats.modelMetrics.length === 0 ? (
            <div className="text-[12px] text-text-muted py-4 text-center">Nenhum modelo configurado nos agentes</div>
          ) : (
            <div className="space-y-3">
              {stats.modelMetrics.map((model) => (
                <div key={model.modelId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-bg-elevated/50">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold text-text-primary">{model.modelName}</span>
                    {model.isReady ? <CheckCircle2 size={14} className="text-success" /> : <XCircle size={14} className="text-text-muted" />}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-text-muted">{model.agentNames.join(", ")}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-soft text-accent font-medium">{model.agentCount} agente{model.agentCount > 1 ? "s" : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
          <span className="text-[13px] font-semibold text-text-primary">Agentes por Modelo</span>
          <span className="text-[11px] text-text-muted ml-2">Quantos agentes usam cada modelo</span>
          <div className="mt-4">
            <BarChart data={stats.modelMetrics.map((m) => ({ label: m.modelName, value: m.agentCount, subLabel: m.agentNames.join(", ") }))} height={Math.max(150, stats.modelMetrics.length * 40)} formatValue={(v) => `${v} agente${v > 1 ? "s" : ""}`} />
          </div>
        </div>
      </div>

      {/* Agent Detail Table */}
      {stats.agentMetrics.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle">
            <span className="text-[13px] font-semibold text-text-primary">Detalhamento por Agente</span>
            <span className="text-[11px] text-text-muted ml-2">Modelo, execuções e métricas</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="text-[10px] text-text-muted uppercase tracking-wider">
                <th className="text-left px-5 py-2.5 font-medium">Agente</th>
                <th className="text-right px-4 py-2.5 font-medium">Modelo</th>
                <th className="text-right px-4 py-2.5 font-medium">Execuções</th>
                <th className="text-right px-4 py-2.5 font-medium">Tokens</th>
                <th className="text-right px-4 py-2.5 font-medium">Custo</th>
                <th className="text-right px-4 py-2.5 font-medium">Taxa Sucesso</th>
                <th className="text-right px-5 py-2.5 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {stats.agentMetrics.map((agent) => (
                  <tr key={agent.agentId} className="border-t border-border-subtle/50 hover:bg-bg-elevated/50 transition-colors">
                    <td className="px-5 py-3"><span className="text-[12px] font-medium text-text-primary">{agent.agentName}</span><span className="text-[10px] text-text-muted ml-2">({formatAgentRoleLabel(agent.agentRole as AgentRole)})</span></td>
                    <td className="text-right px-4 py-3 text-[12px] font-medium text-accent">{agent.modelName || "—"}</td>
                    <td className="text-right px-4 py-3 text-[12px] text-text-primary font-mono tabular-nums">{agent.runs}</td>
                    <td className="text-right px-4 py-3 text-[12px] text-text-secondary font-mono tabular-nums">{formatTokenCount(agent.estimatedTokens)}</td>
                    <td className="text-right px-4 py-3 text-[12px] text-warning font-mono tabular-nums">{formatCost(agent.estimatedCost)}</td>
                    <td className="text-right px-4 py-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${agent.successRate >= 80 ? "bg-success-soft text-success" : agent.successRate >= 60 ? "bg-warning-soft text-warning" : "bg-error-soft text-error"}`}>{Math.round(agent.successRate)}%</span></td>
                    <td className="text-right px-5 py-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${agent.isReady ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>{agent.isReady ? "Pronto" : "Pendente"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border-subtle bg-bg-card p-5">
          <span className="text-[13px] font-semibold text-text-primary">Evolução Diária</span>
          <span className="text-[11px] text-text-muted ml-2">Execuções & tokens ao longo do tempo</span>
          <AreaChart data={stats.byDay.map((d) => ({ date: d.date, values: [d.runs, d.estimatedTokens / 1000] }))} seriesLabels={["Execuções", "Tokens (K)"]} seriesColors={["#22c55e", "#ff4d4d"]} height={200} formatValue={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)))} />
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-[10px] text-text-muted"><span className="w-2 h-2 rounded-full bg-success" /> Execuções</span>
            <span className="flex items-center gap-1.5 text-[10px] text-text-muted"><span className="w-2 h-2 rounded-full bg-accent" /> Tokens (K)</span>
          </div>
        </div>
        <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
          <span className="text-[13px] font-semibold text-text-primary">Status das Execuções</span>
          <div className="flex flex-col items-center mt-4">
            <DonutChart data={[{ label: "Concluídas", value: stats.completedRuns, color: "#22c55e" }, { label: "Falhas", value: stats.failedRuns, color: "#ff4d4d" }, { label: "Em execução", value: stats.runningRuns, color: "#f5a524" }, { label: "Outros", value: Math.max(0, stats.totalRuns - stats.completedRuns - stats.failedRuns - stats.runningRuns), color: "#6f6f76" }].filter((d) => d.value > 0)} size={150} centerValue={String(stats.totalRuns)} centerLabel="execuções" />
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-4">
              {[{ label: "Concluídas", value: stats.completedRuns, color: "bg-success" }, { label: "Falhas", value: stats.failedRuns, color: "bg-error" }, { label: "Em execução", value: stats.runningRuns, color: "bg-warning" }].filter((d) => d.value > 0).map((d) => <span key={d.label} className="flex items-center gap-1.5 text-[10px] text-text-muted"><span className={`w-2 h-2 rounded-full ${d.color}`} /> {d.label}: {d.value}</span>)}
            </div>
          </div>
        </div>
      </div>

      {/* Project Comparison */}
      {stats.byProject.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
            <span className="text-[13px] font-semibold text-text-primary">Execuções por Projeto</span>
            <div className="mt-4"><BarChart data={stats.byProject.map((p) => ({ label: p.projectName, value: p.runs, subLabel: `${p.completedRuns} concluídas` }))} height={Math.max(150, stats.byProject.length * 36)} formatValue={(v) => `${v} runs`} /></div>
          </div>
          <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
            <span className="text-[13px] font-semibold text-text-primary">Custo por Projeto</span>
            <div className="mt-4"><BarChart data={stats.byProject.map((p) => ({ label: p.projectName, value: p.estimatedCost, subLabel: formatTokenCount(p.estimatedTokens) + " tokens" }))} height={Math.max(150, stats.byProject.length * 36)} formatValue={formatCost} /></div>
          </div>
        </div>
      )}

      {/* Monthly Trend */}
      {stats.byMonth.length > 1 && (
        <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
          <span className="text-[13px] font-semibold text-text-primary">Tendência Mensal</span>
          <AreaChart data={stats.byMonth.map((m) => ({ date: m.month, values: [m.runs, m.estimatedCost * 100] }))} seriesLabels={["Execuções", "Custo (centavos)"]} seriesColors={["#22c55e", "#f5a524"]} height={160} />
        </div>
      )}

      {/* Project Detail Table */}
      {stats.byProject.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border-subtle"><span className="text-[13px] font-semibold text-text-primary">Detalhamento por Projeto</span></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="text-[10px] text-text-muted uppercase tracking-wider">
                <th className="text-left px-5 py-2.5 font-medium">Projeto</th>
                <th className="text-right px-4 py-2.5 font-medium">Execuções</th>
                <th className="text-right px-4 py-2.5 font-medium">Concluídas</th>
                <th className="text-right px-4 py-2.5 font-medium">Falhas</th>
                <th className="text-right px-4 py-2.5 font-medium">Tokens</th>
                <th className="text-right px-4 py-2.5 font-medium">Custo</th>
                <th className="text-right px-5 py-2.5 font-medium">Tendência</th>
              </tr></thead>
              <tbody>
                {stats.byProject.map((p) => {
                  const projectRuns = stats.filteredRuns.filter((r) => r.projectId === p.projectId);
                  const sparkData = getDailySparkData(projectRuns, 14);
                  return (
                    <tr key={p.projectId} className="border-t border-border-subtle/50 hover:bg-bg-elevated/50 transition-colors">
                      <td className="px-5 py-3"><span className="text-[12px] font-medium text-text-primary">{p.projectName}</span></td>
                      <td className="text-right px-4 py-3 text-[12px] text-text-primary font-mono tabular-nums">{p.runs}</td>
                      <td className="text-right px-4 py-3 text-[12px] text-success font-mono tabular-nums">{p.completedRuns}</td>
                      <td className="text-right px-4 py-3 text-[12px] text-error font-mono tabular-nums">{p.failedRuns}</td>
                      <td className="text-right px-4 py-3 text-[12px] text-text-secondary font-mono tabular-nums">{formatTokenCount(p.estimatedTokens)}</td>
                      <td className="text-right px-4 py-3 text-[12px] text-warning font-mono tabular-nums">{formatCost(p.estimatedCost)}</td>
                      <td className="text-right px-5 py-3"><SparkLine data={sparkData} color="#ff4d4d" width={60} height={20} /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t border-border-strong bg-bg-elevated/30">
                <td className="px-5 py-2.5 text-[11px] font-semibold text-text-primary">Total</td>
                <td className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-primary font-mono tabular-nums">{stats.totalRuns}</td>
                <td className="text-right px-4 py-2.5 text-[11px] font-semibold text-success font-mono tabular-nums">{stats.completedRuns}</td>
                <td className="text-right px-4 py-2.5 text-[11px] font-semibold text-error font-mono tabular-nums">{stats.failedRuns}</td>
                <td className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-secondary font-mono tabular-nums">{formatTokenCount(stats.estimatedTokens)}</td>
                <td className="text-right px-4 py-2.5 text-[11px] font-semibold text-warning font-mono tabular-nums">{formatCost(stats.estimatedCost)}</td>
                <td className="px-5 py-2.5" />
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {stats.totalRuns === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-bg-card p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center mx-auto mb-3 border border-accent/30"><BarChart3 size={22} /></div>
          <div className="text-[14px] font-medium text-text-primary">Nenhuma execução no período</div>
          <div className="text-[12px] text-text-muted mt-1 max-w-md mx-auto">Execute missões na Central de Comando para começar a acumular dados de uso e analytics.</div>
        </div>
      )}

      <div className="text-[10px] text-text-faint text-center pb-4">Valores de tokens e custo são estimativas baseadas no volume de prompts e respostas. Limites mensais configuráveis acima.</div>
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, limit, percent, color, sparkData }: { icon: React.ReactNode; label: string; value: string; limit: string; percent: number; color: "accent" | "success" | "warning" | "info" | "violet"; sparkData?: number[] }) {
  const colorMap: Record<string, { text: string; bar: string; spark: string }> = {
    accent: { text: "text-accent", bar: "bg-accent", spark: "#ff4d4d" },
    success: { text: "text-success", bar: "bg-success", spark: "#22c55e" },
    warning: { text: "text-warning", bar: "bg-warning", spark: "#f5a524" },
    info: { text: "text-blue-info", bar: "bg-blue-info", spark: "#38bdf8" },
    violet: { text: "text-violet", bar: "bg-violet", spark: "#7c5bf5" },
  };
  const c = colorMap[color] || colorMap.accent;
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-4 relative overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wider ${c.text}`}>{icon}{label}</div>
        {sparkData && sparkData.length > 1 && <SparkLine data={sparkData} color={c.spark} width={48} height={16} />}
      </div>
      <div className="text-[22px] font-bold text-text-primary tabular-nums">{value}</div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-muted">Limite: {limit}</span>
        {percent > 0 && <span className={`text-[10px] font-medium ${percent >= 80 ? "text-error" : percent >= 60 ? "text-warning" : "text-text-muted"}`}>{Math.round(percent)}%</span>}
      </div>
      {percent > 0 && <div className="mt-2 h-[3px] w-full rounded-full bg-bg-input overflow-hidden"><div className={`h-full rounded-full ${c.bar} transition-all duration-500`} style={{ width: `${Math.min(percent, 100)}%`, opacity: 0.85 }} /></div>}
    </div>
  );
}

// ── Settings Panel ──────────────────────────────────────────────────────────
function UsageSettings({ onClose }: { onClose: () => void }) {
  const [tokensLimit, setTokensLimit] = useState(() => { try { return parseFloat(localStorage.getItem("fluxora:usage:tokensLimit") || "10"); } catch { return 10; } });
  const [costLimit, setCostLimit] = useState(() => { try { return parseFloat(localStorage.getItem("fluxora:usage:costLimit") || "200"); } catch { return 200; } });
  const [runsLimit, setRunsLimit] = useState(() => { try { return parseInt(localStorage.getItem("fluxora:usage:runsLimit") || "100", 10); } catch { return 100; } });
  const handleSave = () => { saveLimits({ tokensLimit, costLimit, runsLimit }); onClose(); };
  return (
    <div className="rounded-xl border border-accent/20 bg-bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[13px] font-semibold text-text-primary flex items-center gap-2"><Settings size={14} /> Limiares Mensais</span>
        <button onClick={onClose} className="no-drag text-[11px] text-text-muted hover:text-text-primary transition-colors">Fechar</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div><label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Limite de Tokens (milhões)</label><input type="number" value={tokensLimit} onChange={(e) => setTokensLimit(parseFloat(e.target.value) || 0)} className="flux-input w-full text-[12px]" min={0} step={1} /></div>
        <div><label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Limite de Custo (USD)</label><input type="number" value={costLimit} onChange={(e) => setCostLimit(parseFloat(e.target.value) || 0)} className="flux-input w-full text-[12px]" min={0} step={10} /></div>
        <div><label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Limite de Execuções</label><input type="number" value={runsLimit} onChange={(e) => setRunsLimit(parseInt(e.target.value) || 0)} className="flux-input w-full text-[12px]" min={0} step={10} /></div>
      </div>
      <div className="mt-4 flex justify-end"><button onClick={handleSave} className="no-drag flux-btn-primary h-8 px-4 text-[11.5px]">Salvar Limiares</button></div>
    </div>
  );
}

function getDailySparkData(runs: Array<{ createdAt: string }>, maxDays: number): number[] {
  const now = new Date();
  const dayMap = new Map<string, number>();
  for (let i = maxDays - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); dayMap.set(d.toISOString().slice(0, 10), 0); }
  for (const run of runs) { const key = new Date(run.createdAt).toISOString().slice(0, 10); const v = dayMap.get(key); if (v !== undefined) dayMap.set(key, v + 1); }
  return Array.from(dayMap.values());
}
