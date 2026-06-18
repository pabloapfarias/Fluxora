import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, ChevronRight, Plus, Save, Settings2, ShieldCheck, Sparkles, Trash2, Wrench, X, XCircle } from "lucide-react";
import {
  BUILT_IN_AGENT_ROLES,
  formatAgentRoleLabel,
  getAgentReadiness,
  isAgentConfiguredForRealExecution,
  isAgentReadyWithFallback,
  readGlobalDefaultAgentModel,
  suggestAgentDefaults,
  type Agent,
  type AgentRole,
  type CreateAgentInput,
  type GlobalDefaultAgentModel,
  type OpenCodeCatalogResult,
  type OpenCodeModel,
  type OpenCodeProvider,
  type Project,
} from "@fluxora/shared";
import { useActiveProject } from "../contexts/ActiveProjectContext";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

type AgentDraft = {
  enabled: boolean;
  canEditFiles: boolean;
  canRunCommands: boolean;
  requiresApproval: boolean;
  modelProviderId: string;
  modelName: string;
};

type FeedbackState = Record<string, { type: "success" | "error"; message: string }>;

type NewAgentForm = CreateAgentInput;

const recommendedUsage: Record<string, string> = {
  orchestrator: "Coordena o fluxo, escolhe pipeline e não deve editar código.",
  planner: "Analisa o pedido e produz plano técnico ou relatório read-only.",
  "backend-dev": "Implementa mudanças de servidor/API e executa validações do backend.",
  "frontend-dev": "Implementa mudanças web/UI e executa validações do frontend.",
  "mobile-dev": "Implementa mudanças mobile e executa validações do app.",
  qa: "Valida, testa, audita e reporta problemas sem editar arquivos.",
  devops: "Cuida de pipeline, infra, CI/CD e operações controladas.",
};

const roleOptions: { value: AgentRole; label: string }[] = BUILT_IN_AGENT_ROLES.map((role) => ({
  value: role,
  label: formatAgentRoleLabel(role),
}));

function createDraft(agent: Agent): AgentDraft {
  return {
    enabled: agent.enabled,
    canEditFiles: agent.canEditFiles,
    canRunCommands: agent.canRunCommands,
    requiresApproval: agent.requiresApproval,
    modelProviderId: agent.modelProviderId || "",
    modelName: agent.modelName || "",
  };
}

/** Verifica se um modelo está disponível no catálogo atual do OpenCode. */
function isModelAvailable(catalog: OpenCodeCatalogResult | null, modelId: string | undefined): boolean {
  if (!catalog || !modelId) return true;
  return catalog.models.some((m) => m.id === modelId);
}

/** Verifica se um provider está disponível no catálogo atual do OpenCode. */
function isProviderAvailable(catalog: OpenCodeCatalogResult | null, providerId: string | undefined): boolean {
  if (!catalog || !providerId) return true;
  return catalog.providers.some((p) => p.id === providerId);
}

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [catalog, setCatalog] = useState<OpenCodeCatalogResult | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AgentDraft>>({});
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [useCustomRole, setUseCustomRole] = useState(false);
  const [customRole, setCustomRole] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<Agent | null>(null);
  const [removing, setRemoving] = useState(false);
  const [newAgent, setNewAgent] = useState<NewAgentForm>({
    name: "",
    role: "backend-dev",
    description: "",
    canEditFiles: true,
    canRunCommands: true,
    requiresApproval: true,
    enabled: true,
    modelProviderId: undefined,
    modelName: undefined,
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [globalDefault, setGlobalDefault] = useState<GlobalDefaultAgentModel>({ providerId: null, modelName: null });
  const { activeProjectId } = useActiveProject();
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    const [agentList, projectList, catalogResult] = await Promise.all([
      window.fluxora.agents.list(),
      window.fluxora.projects.list(),
      window.fluxora.opencode.getCatalog(),
    ]);
    setAgents(agentList);
    setProjects(projectList);
    setCatalog(catalogResult);
    setGlobalDefault(readGlobalDefaultAgentModel(window.localStorage));
    setDrafts(Object.fromEntries(agentList.map((agent) => [agent.id, createDraft(agent)])));
  }

  const activeProjectStack = activeProject?.stack;

  const navigate = useNavigate();
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);

  function focusAgentByOffset(currentId: string | null, offset: number) {
    if (agents.length === 0) return;
    const order = agents.map((a) => a.id);
    const idx = currentId ? order.indexOf(currentId) : -1;
    const nextIdx = Math.max(0, Math.min(order.length - 1, (idx < 0 ? 0 : idx) + offset));
    const nextId = order[nextIdx];
    const el = cardRefs.current[nextId];
    if (el) {
      el.focus();
      setFocusedAgentId(nextId);
    }
  }

  function openCreateModal() {
    const suggestion = suggestAgentDefaults(activeProjectStack);
    setNewAgent({
      name: "",
      role: suggestion.suggestedRole,
      description: "",
      canEditFiles: suggestion.permissions.canEditFiles,
      canRunCommands: suggestion.permissions.canRunCommands,
      requiresApproval: suggestion.permissions.requiresApproval,
      enabled: true,
      modelProviderId: undefined,
      modelName: undefined,
    });
    setUseCustomRole(false);
    setCustomRole("");
    setShowCreateModal(true);
  }

  function updateDraft(agentId: string, patch: Partial<AgentDraft>) {
    setDrafts((current) => ({
      ...current,
      [agentId]: {
        ...current[agentId],
        ...patch,
      },
    }));
    setFeedback((current) => {
      if (!current[agentId]) return current;
      const next = { ...current };
      delete next[agentId];
      return next;
    });
  }

  async function handleSaveAgent(agent: Agent) {
    const draft = drafts[agent.id];
    if (!draft) return;

    setSavingAgentId(agent.id);
    try {
      await window.fluxora.agents.update(agent.id, {
        enabled: draft.enabled,
        canEditFiles: draft.canEditFiles,
        canRunCommands: draft.canRunCommands,
        requiresApproval: draft.requiresApproval,
        modelProviderId: draft.modelProviderId || undefined,
        modelName: draft.modelName.trim() || undefined,
      });

      setFeedback((current) => ({
        ...current,
        [agent.id]: { type: "success", message: "Configurações salvas com sucesso." },
      }));

      await loadData();
      setSelectedAgentId(agent.id);
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [agent.id]: {
          type: "error",
          message: error instanceof Error ? error.message : "Falha ao salvar as configurações do agente.",
        },
      }));
    } finally {
      setSavingAgentId(null);
    }
  }

  async function handleCreateAgent() {
    if (!newAgent.name.trim() || !newAgent.description.trim()) {
      setCreateError("Preencha nome e descrição do agente.");
      return;
    }

    let resolvedRole: AgentRole = newAgent.role;
    if (useCustomRole) {
      const trimmed = customRole.trim().toLowerCase().replace(/\s+/g, "-");
      if (!trimmed) {
        setCreateError("Informe o nome do papel personalizado.");
        return;
      }
      if (BUILT_IN_AGENT_ROLES.includes(trimmed as any)) {
        setCreateError("Esse papel já existe entre os papéis padrão. Escolha-o na lista.");
        return;
      }
      resolvedRole = `custom:${trimmed}` as AgentRole;
    }

    setCreatingAgent(true);
    setCreateError(null);
    try {
      const created = await window.fluxora.agents.create({
        ...newAgent,
        role: resolvedRole,
        name: newAgent.name.trim(),
        description: newAgent.description.trim(),
      });
      await loadData();
      setShowCreateModal(false);
      setSelectedAgentId(created.id);
      setUseCustomRole(false);
      setCustomRole("");
      setNewAgent({
        name: "",
        role: "backend-dev",
        description: "",
        canEditFiles: true,
        canRunCommands: true,
        requiresApproval: true,
        enabled: true,
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Falha ao criar agente.");
    } finally {
      setCreatingAgent(false);
    }
  }

  async function handleRemoveAgent() {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await window.fluxora.agents.remove(pendingRemoval.id);
      setPendingRemoval(null);
      setSelectedAgentId(null);
      await loadData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Falha ao remover agente.");
    } finally {
      setRemoving(false);
    }
  }

  const readyCount = useMemo(
    () => agents.filter((agent) => isAgentReadyWithFallback(agent, catalog, globalDefault)).length,
    [agents, catalog, globalDefault]
  );

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Agentes</h1>
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-deep/40 px-3 py-2 text-[12px] text-text-secondary">
              <span className="font-medium text-text-primary">Prontos para execução real:</span>
              <span className="text-success font-semibold">{readyCount}</span>
              <span>/ {agents.length}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="no-drag flex items-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-[12px] font-medium"
          >
            <Plus size={14} /> Novo agente
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const draft = drafts[agent.id] || createDraft(agent);
          const provider = catalog?.providers.find((entry) => entry.id === draft.modelProviderId);
          const isReady = isAgentReadyWithFallback(
            {
              ...agent,
              enabled: draft.enabled,
              modelProviderId: draft.modelProviderId || undefined,
              modelName: draft.modelName || undefined,
            },
            catalog,
            globalDefault
          );

          return (
            <button
              key={agent.id}
              ref={(el) => {
                cardRefs.current[agent.id] = el;
              }}
              type="button"
              onClick={() => setSelectedAgentId(agent.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  focusAgentByOffset(agent.id, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  focusAgentByOffset(agent.id, -1);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  focusAgentByOffset(null, 0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  focusAgentByOffset(null, agents.length - 1);
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedAgentId(agent.id);
                }
              }}
              onFocus={() => setFocusedAgentId(agent.id)}
              tabIndex={focusedAgentId === null || focusedAgentId === agent.id ? 0 : -1}
              aria-label={`Configurar agente ${agent.name}`}
              className="no-drag text-left bg-bg-card border border-border rounded-xl p-4 hover:border-accent/30 hover:bg-bg-card-hover/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${draft.enabled ? "bg-success" : "bg-text-muted"}`} />
                    <div className="min-w-0">
                      <div className="font-medium text-[15px] text-text-primary truncate">{agent.name}</div>
                      <div className="text-xs text-text-muted">{formatAgentRoleLabel(agent.role)}</div>
                    </div>
                  </div>
                  <p className="mt-3 text-[12.5px] text-text-secondary line-clamp-2">{agent.description}</p>
                </div>
                <ChevronRight size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className={`text-xs px-2 py-0.5 rounded border ${isReady ? "bg-success/10 text-success border-success/20" : "bg-warning/10 text-warning border-warning/20"}`}>
                  {isReady ? "Pronto para execução real" : "Configuração pendente"}
                </span>
                {draft.canEditFiles && <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded">Edita arquivos</span>}
                {draft.canRunCommands && <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded">Executa comandos</span>}
                {draft.requiresApproval && <span className="text-xs bg-error/10 text-error px-2 py-0.5 rounded">Requer aprovação</span>}
              </div>

              <div className="mt-4 rounded-lg border border-border-subtle bg-bg-deep/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold mb-1">Resumo de configuração</div>
                <div className="text-[11.5px] text-text-secondary">
                  Provider: {provider ? provider.displayName : "Não configurado"}
                </div>
                <div className="text-[11.5px] text-text-secondary mt-0.5">
                  Modelo: {draft.modelName ? draft.modelName.split("/").pop() : "Não configurado"}
                </div>
                {provider && !isProviderAvailable(catalog, provider.id) && (
                  <div className="text-[11px] text-warning mt-0.5">⚠ Provider não está no OpenCode atual</div>
                )}
                {draft.modelName && !isModelAvailable(catalog, draft.modelName) && (
                  <div className="text-[11px] text-warning mt-0.5">⚠ Modelo não está no OpenCode atual</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedAgent && (
        <AgentConfigModal
          agent={selectedAgent}
          catalog={catalog}
          draft={drafts[selectedAgent.id] || createDraft(selectedAgent)}
          feedback={feedback[selectedAgent.id]}
          saving={savingAgentId === selectedAgent.id}
          globalDefault={globalDefault}
          onClose={() => setSelectedAgentId(null)}
          onChange={(patch) => updateDraft(selectedAgent.id, patch)}
          onSave={() => void handleSaveAgent(selectedAgent)}
          onRequestRemove={() => setPendingRemoval(selectedAgent)}
        />
      )}

      {showCreateModal && (
        <CreateAgentModal
          value={newAgent}
          error={createError}
          saving={creatingAgent}
          useCustomRole={useCustomRole}
          customRole={customRole}
          autoSuggestion={suggestAgentDefaults(activeProjectStack)}
          activeProjectName={activeProject?.name}
          onChange={(patch) => setNewAgent((current) => ({ ...current, ...patch }))}
          onCustomRoleChange={(enabled, custom) => {
            setUseCustomRole(enabled);
            if (custom !== undefined) setCustomRole(custom);
            if (enabled) setCreateError(null);
          }}
          onClose={() => {
            setShowCreateModal(false);
            setCreateError(null);
            setUseCustomRole(false);
            setCustomRole("");
          }}
          onSave={() => void handleCreateAgent()}
        />
      )}

      {pendingRemoval && (
        <RemoveAgentModal
          agent={pendingRemoval}
          removing={removing}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => void handleRemoveAgent()}
        />
      )}
    </div>
  );
}

function RemoveAgentModal({
  agent,
  removing,
  onClose,
  onConfirm,
}: {
  agent: Agent;
  removing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Fechar modal" />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-2xl border border-error/30 bg-bg-card shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-agent-modal-title"
        aria-describedby="remove-agent-modal-desc"
      >
        <div className="p-5 flex items-start gap-3 border-b border-border-subtle">
          <AlertCircle size={20} className="text-error flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 id="remove-agent-modal-title" className="text-lg font-semibold text-text-primary">Remover agente</h2>
            <p id="remove-agent-modal-desc" className="text-[12.5px] text-text-secondary mt-1">
              Esta ação remove <strong className="text-text-primary">{agent.name}</strong> permanentemente. Execuções em andamento que dependam dele podem falhar.
            </p>
          </div>
        </div>
        <div className="p-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/25">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={removing}
            className="no-drag flex items-center gap-1 bg-error hover:bg-error/90 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-white"
          >
            <Trash2 size={12} /> {removing ? "Removendo..." : "Remover agente"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateAgentModal({
  value,
  error,
  saving,
  useCustomRole,
  customRole,
  autoSuggestion,
  activeProjectName,
  onChange,
  onCustomRoleChange,
  onClose,
  onSave,
}: {
  value: NewAgentForm;
  error: string | null;
  saving: boolean;
  useCustomRole: boolean;
  customRole: string;
  autoSuggestion: ReturnType<typeof suggestAgentDefaults>;
  activeProjectName?: string;
  onChange: (patch: Partial<NewAgentForm>) => void;
  onCustomRoleChange: (enabled: boolean, custom?: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Fechar modal" />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-modal-title"
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border-subtle">
          <div>
            <h2 id="create-agent-modal-title" className="text-xl font-semibold text-text-primary">Novo agente</h2>
            <div className="text-[12px] text-text-muted mt-1">Escolha um papel padrão ou crie um papel personalizado para este agente.</div>
          </div>
          <button type="button" onClick={onClose} className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center" aria-label="Fechar modal de criação de agente">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {autoSuggestion && autoSuggestion.inferredFromStack && (
            <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-text-secondary flex items-start gap-2">
              <Sparkles size={14} className="text-accent flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-text-primary font-medium">
                  Sugestão automática: {formatAgentRoleLabel(autoSuggestion.suggestedRole)}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  Baseado no stack do projeto{activeProjectName ? ` "${activeProjectName}"` : ""}. Ajuste se necessário.
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-text-muted block mb-1">Nome</label>
              <input value={value.name} onChange={(e) => onChange({ name: e.target.value })} className="flux-input" placeholder="Ex.: Security Reviewer" />
            </div>
            <div>
              <label className="text-[11px] text-text-muted block mb-1">Papel</label>
              <select
                value={useCustomRole ? "__custom__" : value.role}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    onCustomRoleChange(true);
                  } else {
                    onCustomRoleChange(false);
                    onChange({ role: e.target.value as AgentRole });
                  }
                }}
                className="flux-input"
              >
                {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                <option value="__custom__">Personalizado…</option>
              </select>
            </div>
          </div>
          {useCustomRole && (
            <div>
              <label className="text-[11px] text-text-muted block mb-1">Identificador do papel personalizado</label>
              <input
                value={customRole}
                onChange={(e) => onCustomRoleChange(true, e.target.value)}
                className="flux-input"
                placeholder="ex.: security-reviewer"
              />
              <p className="text-[10.5px] text-text-muted mt-1">
                Use letras minúsculas, números e hífens. Não pode ser igual a um papel padrão.
              </p>
            </div>
          )}
          <div>
            <label className="text-[11px] text-text-muted block mb-1">Descrição</label>
            <textarea value={value.description} onChange={(e) => onChange({ description: e.target.value })} className="flux-input min-h-[96px]" placeholder="Descreva o que este agente faz no fluxo." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <ToggleCard label="Agente habilitado" description="Disponível para o orquestrador." checked={value.enabled !== false} onChange={(checked) => onChange({ enabled: checked })} />
            <ToggleCard label="Pode editar arquivos" description="Permite alterações no projeto." checked={value.canEditFiles} onChange={(checked) => onChange({ canEditFiles: checked })} />
            <ToggleCard label="Pode executar comandos" description="Permite testes e comandos seguros." checked={value.canRunCommands} onChange={(checked) => onChange({ canRunCommands: checked })} />
            <ToggleCard label="Requer aprovação" description="Mantém controle humano." checked={value.requiresApproval} onChange={(checked) => onChange({ requiresApproval: checked })} />
          </div>
          {error && <div className="rounded-lg border border-error/20 bg-error/10 text-error px-3 py-2 text-[12px]">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/25">Cancelar</button>
            <button type="button" onClick={onSave} disabled={saving} className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
              <Save size={12} /> {saving ? "Criando..." : "Criar agente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentConfigModal({
  agent,
  catalog,
  draft,
  feedback,
  saving,
  onClose,
  onChange,
  onSave,
  onRequestRemove,
  globalDefault,
}: {
  agent: Agent;
  catalog: OpenCodeCatalogResult | null;
  draft: AgentDraft;
  feedback?: { type: "success" | "error"; message: string };
  saving: boolean;
  onClose: () => void;
  onChange: (patch: Partial<AgentDraft>) => void;
  onSave: () => void;
  onRequestRemove: () => void;
  globalDefault: GlobalDefaultAgentModel;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  const [providerModels, setProviderModels] = useState<OpenCodeModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const provider: OpenCodeProvider | undefined = catalog?.providers.find((entry) => entry.id === draft.modelProviderId);

  // Carrega modelos ao trocar de provider.
  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      if (!draft.modelProviderId) {
        setProviderModels([]);
        return;
      }
      setLoadingModels(true);
      try {
        const models = await window.fluxora.opencode.getModelsForProvider(draft.modelProviderId);
        if (!cancelled) setProviderModels(models);
      } catch (err) {
        if (!cancelled) setProviderModels([]);
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [draft.modelProviderId]);

  const readiness = getAgentReadiness(
    {
      ...agent,
      enabled: draft.enabled,
      modelProviderId: draft.modelProviderId || undefined,
      modelName: draft.modelName || undefined,
    },
    catalog,
    globalDefault
  );
  const isReady = readiness.ready;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Fechar modal" />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-auto rounded-2xl border border-border bg-bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-config-modal-title"
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border-subtle sticky top-0 bg-bg-card z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${draft.enabled ? "bg-success" : "bg-text-muted"}`} aria-hidden="true" />
              <h2 id="agent-config-modal-title" className="text-xl font-semibold text-text-primary">{agent.name}</h2>
            </div>
            <div className="text-[12px] text-text-muted mt-1">{formatAgentRoleLabel(agent.role)}</div>
          </div>
          <button type="button" onClick={onClose} className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center" aria-label="Fechar modal de configuração do agente">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            <span className={`text-xs px-2 py-0.5 rounded border ${isReady ? "bg-success/10 text-success border-success/20" : "bg-warning/10 text-warning border-warning/20"}`}>
              {isReady ? "Pronto para execução real" : "Configuração pendente"}
            </span>
            {draft.canEditFiles && <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded">Edita arquivos</span>}
            {draft.canRunCommands && <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded">Executa comandos</span>}
            {draft.requiresApproval && <span className="text-xs bg-error/10 text-error px-2 py-0.5 rounded">Requer aprovação</span>}
          </div>

          <p className="text-[12.5px] text-text-secondary">{agent.description}</p>

          <div className="rounded-lg border border-border-subtle bg-bg-deep/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold mb-1">Configuração recomendada</div>
            <div className="text-[11.5px] text-text-secondary">
              {recommendedUsage[agent.role] || "Personalize as permissões conforme o papel deste agente."}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-text-primary">
                <ShieldCheck size={14} className="text-accent" /> Permissões do agente
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <ToggleCard label="Agente habilitado" description="Permite que o orquestrador use este agente." checked={draft.enabled} onChange={(checked) => onChange({ enabled: checked })} />
                <ToggleCard label="Pode editar arquivos" description="Autoriza alterações reais no projeto." checked={draft.canEditFiles} onChange={(checked) => onChange({ canEditFiles: checked })} />
                <ToggleCard label="Pode executar comandos" description="Autoriza testes, builds e comandos seguros." checked={draft.canRunCommands} onChange={(checked) => onChange({ canRunCommands: checked })} />
                <ToggleCard label="Requer aprovação" description="Mantém a etapa sujeita à validação humana." checked={draft.requiresApproval} onChange={(checked) => onChange({ requiresApproval: checked })} />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-text-primary">
                <Wrench size={14} className="text-accent" /> Modelo e provider
              </div>
              <div className="space-y-2">
                {!catalog ? (
                  <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
                    {catalog === null
                      ? "Carregando catálogo do OpenCode..."
                      : "Não foi possível carregar o catálogo do OpenCode. Verifique o CLI e tente novamente."}
                  </div>
                ) : catalog.providers.length === 0 ? (
                  <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
                    O OpenCode não retornou providers. Configure credenciais via <code className="px-1 rounded bg-bg-input">opencode providers</code>.
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-[11px] text-text-muted block mb-1">Provider (via OpenCode)</label>
                      <select
                        value={draft.modelProviderId}
                        onChange={(event) => {
                          const nextProviderId = event.target.value;
                          onChange({
                            modelProviderId: nextProviderId,
                            modelName: "",
                          });
                        }}
                        className="flux-input"
                      >
                        <option value="">Selecione um provider</option>
                        {catalog.providers.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.displayName} • {entry.authType}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-text-muted block mb-1">Modelo (via OpenCode)</label>
                      <select
                        value={draft.modelName}
                        onChange={(event) => onChange({ modelName: event.target.value })}
                        className="flux-input"
                        disabled={!draft.modelProviderId || loadingModels}
                      >
                        <option value="">
                          {!draft.modelProviderId
                            ? "Selecione um provider primeiro"
                            : loadingModels
                              ? "Carregando modelos..."
                              : providerModels.length === 0
                                ? "Nenhum modelo disponível para este provider"
                                : "Selecione um modelo"}
                        </option>
                        {providerModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.modelName}</option>
                        ))}
                      </select>
                      {draft.modelName && !isModelAvailable(catalog, draft.modelName) && (
                        <p className="text-[10.5px] text-warning mt-1">
                          ⚠ Este modelo não está mais disponível no OpenCode atual. Selecione outro.
                        </p>
                      )}
                      {draft.modelProviderId && providerModels.length === 0 && !loadingModels && (
                        <p className="text-[10.5px] text-warning mt-1">
                          O OpenCode não retornou modelos para este provider.
                        </p>
                      )}
                    </div>

                    <div className="text-[11px] text-text-muted">
                      Provider atual: {provider ? provider.displayName : "Não configurado"}
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>

          {feedback && (
            <div className={`rounded-lg border px-3 py-2 text-[12px] flex items-center gap-2 ${feedback.type === "success" ? "border-success/20 bg-success/10 text-success" : "border-error/20 bg-error/10 text-error"}`}>
              {feedback.type === "success" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>{feedback.message}</span>
            </div>
          )}

          {isReady && !agent.modelProviderId && globalDefault.providerId && (
            <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[12px] text-success flex items-start gap-2">
              <Sparkles size={12} className="flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Usando modelo padrão global</div>
                <div className="text-text-secondary text-[11.5px] mt-0.5">
                  Este agente não tem provider/modelo próprios. Será usado o fallback configurado em Configurações.
                </div>
              </div>
            </div>
          )}

          {!isReady && readiness.reasons.length > 0 && (
            <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-[12px] text-warning space-y-1">
              <div className="font-medium text-[12.5px]">Pendências para execução real</div>
              <ul className="list-disc pl-5 space-y-0.5 text-text-secondary">
                {readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={onRequestRemove}
              className="no-drag flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-error/30 text-error hover:bg-error/10"
            >
              <Trash2 size={12} /> Remover agente
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/25">
                Fechar
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                <Save size={12} /> {saving ? "Salvando..." : "Salvar configurações"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleCard({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`no-drag text-left rounded-lg border px-3 py-2 transition-colors ${disabled ? "opacity-50 cursor-not-allowed border-border-subtle bg-bg-deep/20" : checked ? "border-accent/35 bg-accent/10" : "border-border-subtle bg-bg-deep/20 hover:border-accent/25"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-text-primary">{label}</div>
          <div className="text-[11px] text-text-muted mt-0.5">{description}</div>
        </div>
        <span className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${checked ? "bg-accent/70" : "bg-bg-input border border-border-subtle"}`}>
          <span className={`w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
        </span>
      </div>
    </button>
  );
}
