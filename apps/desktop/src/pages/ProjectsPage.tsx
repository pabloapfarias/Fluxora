import { useEffect, useMemo, useState } from "react";
import { Plus, Edit2, Trash2, X, FolderOpen, FolderSearch, Sparkles } from "lucide-react";
import {
  deriveProviderEngineGlobalDefault,
  isAgentConfiguredForRealExecution,
  isAgentReadyWithFallback,
  recommendDeveloperRoleForStack,
  recommendProjectStackLabel,
  formatAgentRoleLabel,
  type Project,
  type CreateProjectInput,
  type Agent,
  type AgentConfig,
  type AiProviderConfig,
  type OpenCodeCatalogResult,
} from "@fluxora/shared";
import { loadProviderCatalog } from "../lib/providerCatalog";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateProjectInput>({ name: "", path: "", stack: [] });
  const [stackInput, setStackInput] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathWarning, setPathWarning] = useState<string | null>(null);
  const [isSelectingDir, setIsSelectingDir] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [catalog, setCatalog] = useState<OpenCodeCatalogResult | null>(null);

  useEffect(() => {
    loadProjects();
    loadAgentsAndProviders();
  }, []);

  async function loadProjects() {
    setProjects(await window.fluxora.projects.list());
  }

  async function loadAgentsAndProviders() {
    const [agentList, providerList] = await Promise.all([
      window.fluxora.agents.listConfigs(),
      window.fluxora.providers.list(),
    ]);
    const catalogResult = await loadProviderCatalog(providerList);
    setAgents(agentList.map(toLegacyAgent));
    setProviders(providerList);
    setCatalog(catalogResult);
  }

  const globalDefault = useMemo(() => deriveProviderEngineGlobalDefault(providers), [providers]);

  function projectReadiness(project: Project) {
    const role = recommendDeveloperRoleForStack(project.stack);
    const agent = agents.find((entry) => entry.role === role);
    const direct = agent ? isAgentConfiguredForRealExecution(agent, catalog) : false;
    const ready = agent ? isAgentReadyWithFallback(agent, catalog, globalDefault) : false;
    return {
      role,
      label: formatAgentRoleLabel(role),
      stackLabel: recommendProjectStackLabel(project.stack),
      agentName: agent?.name,
      direct,
      ready,
      usingFallback: ready && !direct,
    };
  }

  async function handleSelectDirectory() {
    setIsSelectingDir(true);
    try {
      const result = await window.fluxora.projects.selectDirectory();
      if (!result.canceled && result.path) {
        setForm((prev) => ({ ...prev, path: result.path! }));
        setPathError(null);
        await validatePath(result.path);
      }
    } finally {
      setIsSelectingDir(false);
    }
  }

  async function validatePath(projectPath: string) {
    if (!projectPath.trim()) {
      setPathError("O caminho não pode estar vazio.");
      setPathWarning(null);
      return false;
    }
    const result = await window.fluxora.projects.validatePath(projectPath);
    if (!result.valid) {
      setPathError(result.error || "Caminho inválido.");
      setPathWarning(null);
      return false;
    }
    setPathError(null);
    if (!result.hasGit) {
      setPathWarning("A pasta selecionada não parece ser um repositório Git. Algumas funções de diff e execução controlada podem não funcionar.");
    } else {
      setPathWarning(null);
    }
    return true;
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.path.trim()) return;

    const isValid = await validatePath(form.path);
    if (!isValid) return;

    if (editingId) {
      await window.fluxora.projects.update(editingId, { ...form, stack: form.stack.length ? form.stack : undefined });
    } else {
      await window.fluxora.projects.create(form);
    }
    resetForm();
    loadProjects();
  }

  async function handleDelete(id: string) {
    await window.fluxora.projects.remove(id);
    loadProjects();
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setForm({ name: project.name, path: project.path, stack: project.stack });
    setStackInput(project.stack.join(", "));
    setPathError(null);
    setPathWarning(null);
    setShowForm(true);
  }

  function resetForm() {
    setForm({ name: "", path: "", stack: [] });
    setStackInput("");
    setEditingId(null);
    setPathError(null);
    setPathWarning(null);
    setShowForm(false);
  }

  function addStackFromInput() {
    const stacks = stackInput.split(",").map((s) => s.trim()).filter(Boolean);
    setForm({ ...form, stack: stacks });
  }

  const statusColors: Record<string, string> = {
    idle: "bg-text-muted",
    planning: "bg-accent",
    running: "bg-success",
    validating: "bg-warning",
    waiting_approval: "bg-warning",
    error: "bg-error",
    completed: "bg-success",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projetos</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Novo Projeto
        </button>
      </div>

      {showForm && (
        <div className="bg-bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">{editingId ? "Editar Projeto" : "Novo Projeto"}</h3>
            <button onClick={resetForm} className="text-text-muted hover:text-text-primary">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-text-muted mb-1 block">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Nome do projeto"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Caminho</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.path}
                  onChange={(e) => {
                    setForm({ ...form, path: e.target.value });
                    setPathError(null);
                    setPathWarning(null);
                  }}
                  className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                  placeholder="/caminho/do/projeto"
                />
                <button
                  type="button"
                  onClick={handleSelectDirectory}
                  disabled={isSelectingDir}
                  className="flex items-center gap-1.5 bg-bg-hover hover:bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 whitespace-nowrap"
                  title="Selecionar pasta"
                >
                  <FolderSearch size={14} />
                  <span>Selecionar pasta</span>
                </button>
              </div>
              {pathError && (
                <p className="mt-1.5 text-xs text-error">{pathError}</p>
              )}
              {pathWarning && (
                <p className="mt-1.5 text-xs text-warning">{pathWarning}</p>
              )}
            </div>
            <div className="col-span-2">
              <label className="text-xs text-text-muted mb-1 block">Stack (separado por vírgula)</label>
              <input
                type="text"
                value={stackInput}
                onChange={(e) => setStackInput(e.target.value)}
                onBlur={addStackFromInput}
                className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Laravel, PHP, API"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={resetForm} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!form.name.trim() || !form.path.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {editingId ? "Salvar" : "Criar Projeto"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {projects.map((project) => {
          const readiness = projectReadiness(project);
          return (
          <div key={project.id} className="bg-bg-card border border-border rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full ${statusColors[project.status] || "bg-text-muted"}`} />
              <div>
                <div className="font-medium">{project.name}</div>
                <div className="text-xs text-text-muted flex items-center gap-1">
                  <FolderOpen size={12} /> {project.path}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Sparkles size={11} className="text-accent" />
                  <span>
                    {readiness.label}
                    {readiness.agentName ? ` (${readiness.agentName})` : " (sem agente)"}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      readiness.ready
                        ? readiness.usingFallback
                          ? "bg-warning/10 text-warning border-warning/20"
                          : "bg-success/10 text-success border-success/20"
                        : "bg-error/10 text-error border-error/20"
                    }`}
                  >
                    {readiness.ready
                      ? readiness.usingFallback
                        ? "via fallback global"
                        : "pronto"
                      : "sem agente pronto"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex gap-1">
                {project.stack.map((s) => (
                  <span key={s} className="text-xs bg-bg-hover px-2 py-0.5 rounded">{s}</span>
                ))}
              </div>
              <span className="text-xs text-text-muted capitalize">{project.status}</span>
              <div className="flex gap-1">
                <button onClick={() => startEdit(project)} className="p-1.5 hover:bg-bg-hover rounded-lg text-text-muted hover:text-text-primary">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(project.id)} className="p-1.5 hover:bg-bg-hover rounded-lg text-text-muted hover:text-error">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
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
