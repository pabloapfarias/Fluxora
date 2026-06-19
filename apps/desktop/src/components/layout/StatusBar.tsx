import { useEffect, useState } from "react";
import { Database, GitBranch, Clock, Layers, RefreshCcw, Cable } from "lucide-react";
import type { BackgroundWorkflowJob } from "@fluxora/shared";

function useLastUpdated() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatRelative(ts: number) {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s atrás`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} min atrás`;
  const h = Math.floor(m / 60);
  return `${h}h atrás`;
}

export function StatusBar() {
  const [projectCount, setProjectCount] = useState(0);
  const [agentCount, setAgentCount] = useState(0);
  const [providerCount, setProviderCount] = useState(0);
  const [providersReady, setProvidersReady] = useState(false);
  const [activeJobs, setActiveJobs] = useState<BackgroundWorkflowJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [gitBranch, setGitBranch] = useState<string>("...");
  const [gitCommit, setGitCommit] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("...");
  const lastUpdate = useLastUpdated();

  async function loadCounts() {
    const [projects, agents, providers] = await Promise.all([
      window.fluxora.projects.list(),
      window.fluxora.agents.listConfigs(),
      window.fluxora.providers.list(),
    ]);
    setProjectCount(projects.length);
    setAgentCount(agents.filter((agent) => agent.status === "enabled").length);
    setProviderCount(providers.length);
    setProvidersReady(providers.some((provider) => provider.enabled));
  }

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        await loadCounts();
      } catch {
        if (!mounted) return;
      }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadJobs = async () => {
      const jobs = await window.fluxora.workflows.listJobs();
      if (mounted) setActiveJobs(jobs.filter((job) => ["queued", "running"].includes(job.status)));
    };
    void loadJobs();
    const unsubscribe = window.fluxora.events.onJobUpdated((job) => {
      setActiveJobs((current) => {
        const next = [...current.filter((entry) => entry.id !== job.id), job].filter((entry) => ["queued", "running"].includes(entry.status));
        return next;
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [gitInfo, version] = await Promise.all([
          window.fluxora.app.getGitInfo(),
          window.fluxora.app.getVersion(),
        ]);
        if (!mounted) return;
        setGitBranch(gitInfo.branch || "branch desconhecida");
        setGitCommit(gitInfo.commit || "");
        setAppVersion(version ? `v${version}` : "");
      } catch {
        if (mounted) {
          setGitBranch("branch desconhecida");
          setGitCommit("");
        }
      }
    };
    void load();
    const id = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCounts();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="h-7 flex-shrink-0 bg-bg-elevated border-t border-border flex items-center px-3 text-[11px] text-text-muted gap-1 no-drag">
      <StatusPill label="Ambiente" value="Desenvolvimento" />
      <StatusPill label="Banco" value="SQLite" icon={<Database size={10} />} />
      <button
        onClick={handleRefresh}
        className="no-drag flex items-center gap-1.5 px-1.5 hover:text-text-primary"
        title="Atualizar estado do Fluxora"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${providersReady ? "bg-success" : "bg-warning"}`} />
        <Cable size={10} />
        <span className="text-text-secondary">Providers:</span>
        <span className="text-text-primary">{providerCount}</span>
        <RefreshCcw size={9} className={refreshing ? "animate-spin" : ""} />
      </button>
      <StatusPill label="Agentes" value={`${agentCount} ativos`} icon={<Layers size={10} />} />
      <StatusPill label="Projetos" value={`${projectCount}`} />
      {activeJobs.length > 0 && <StatusPill label="Jobs" value={`${activeJobs.length} ativos`} tone="accent" />}

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <GitBranch size={10} />
          {gitBranch}{gitCommit ? ` (${gitCommit})` : ""}
        </span>
        {appVersion && <span>{appVersion}</span>}
        <span className="flex items-center gap-1">
          <Clock size={10} />
          Atualizado {formatRelative(lastUpdate)}
        </span>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "default" | "warning" | "success" | "error" | "accent";
}) {
  const dot = toneDot(tone);
  return (
    <div className="flex items-center gap-1.5 px-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {icon}
      <span className="text-text-secondary">{label}:</span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

function toneDot(tone: "default" | "warning" | "success" | "error" | "accent"): string {
  switch (tone) {
    case "warning": return "bg-warning";
    case "success": return "bg-success";
    case "error": return "bg-error";
    case "accent": return "bg-accent";
    default: return "bg-text-muted";
  }
}
