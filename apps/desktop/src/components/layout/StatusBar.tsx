import { useEffect, useState } from "react";
import { Database, Zap, GitBranch, Clock, Layers, RefreshCcw } from "lucide-react";
import type { BackgroundWorkflowJob, OpenCodeStatus, OpenCodeSettings } from "@fluxora/shared";
import { formatExecutionStatus } from "../../lib/presentationLabels";

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

const opencodeLabels: Record<OpenCodeStatus, string> = {
  not_configured: "Não configurado",
  not_detected: "Não detectado",
  detected: "Detectado",
  running: "Executando",
  error: "Erro",
};

const opencodeTone: Record<OpenCodeStatus, "default" | "warning" | "success" | "error" | "accent"> = {
  not_configured: "default",
  not_detected: "warning",
  detected: "success",
  running: "accent",
  error: "error",
};

export function StatusBar() {
  const [projectCount, setProjectCount] = useState(0);
  const [agentCount, setAgentCount] = useState(0);
  const [opencodeStatus, setOpencodeStatus] = useState<OpenCodeStatus>("not_detected");
  const [opencodeSettings, setOpencodeSettings] = useState<OpenCodeSettings | null>(null);
  const [activeJobs, setActiveJobs] = useState<BackgroundWorkflowJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [gitBranch, setGitBranch] = useState<string>("...");
  const [gitCommit, setGitCommit] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("...");
  const lastUpdate = useLastUpdated();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [p, a] = await Promise.all([
        window.fluxora.projects.list(),
        window.fluxora.agents.list(),
      ]);
      if (!mounted) return;
      setProjectCount(p.length);
      setAgentCount(a.filter((ag) => ag.enabled).length);
    };
    load();
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
    loadJobs();
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
        const [s, settings] = await Promise.all([
          window.fluxora.opencode.getStatus(),
          window.fluxora.opencode.getSettings(),
        ]);
        if (!mounted) return;
        setOpencodeStatus(s);
        setOpencodeSettings(settings);
      } catch {
        if (mounted) setOpencodeStatus("error");
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      mounted = false;
      clearInterval(id);
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
    load();
    const id = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const det = await window.fluxora.opencode.detect();
      setOpencodeStatus(det.status);
      const settings = await window.fluxora.opencode.getSettings();
      setOpencodeSettings(settings);
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
        title="Detectar OpenCode novamente"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${toneDot(opencodeTone[opencodeStatus])} ${opencodeStatus === "running" ? "flux-pulse-dot" : ""}`} />
        <Zap size={10} />
        <span className="text-text-secondary">OpenCode:</span>
        <span className="text-text-primary">{opencodeLabels[opencodeStatus]}</span>
        {opencodeSettings && opencodeSettings.binaryPath !== "opencode" && (
          <span className="text-text-faint ml-1">({shortPath(opencodeSettings.binaryPath)})</span>
        )}
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

function shortPath(p: string): string {
  if (p.length <= 24) return p;
  return "…" + p.slice(-22);
}
