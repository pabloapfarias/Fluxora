import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Clock,
  FolderKanban,
  Keyboard,
  ListChecks,
  Mic,
  PlayCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useModalAccessibility } from "../../hooks/useModalAccessibility";

export type CommandPaletteGroup =
  | "Favoritos"
  | "Recentes"
  | "Ações"
  | "Navegação"
  | "Projetos"
  | "Execuções"
  | "Agentes"
  | "Aprovações";

export interface CommandPaletteAction {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  run: () => void;
  icon?: React.ReactNode;
  /** Categoria/agrupamento da ação. */
  group?: CommandPaletteGroup;
  /** Aliases curtos (ex: "gp" para "go projects"). */
  aliases?: string[];
  /** Score mais alto = melhor match de busca. */
  rank?: number;
}

/** Item universal (não fixo) — projetos, execuções, agentes, aprovações. */
export interface CommandPaletteUniversalItemAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Cor do botão: "primary" usa accent, "success" usa verde, "danger" usa vermelho. */
  tone?: "primary" | "success" | "danger";
  run: () => void;
}

export interface CommandPaletteUniversalItem {
  id: string;
  title: string;
  description: string;
  keywords?: string[];
  group: "Projetos" | "Execuções" | "Agentes" | "Aprovações";
  /** Sub-categoria opcional (ex: status de execução). */
  status?: string;
  run: () => void;
  icon?: React.ReactNode;
  /** Ações inline exibidas no preview (ex: aprovar/rejeitar). */
  actions?: CommandPaletteUniversalItemAction[];
  /** Score mais alto = melhor match. */
  rank?: number;
}

interface GroupedItems {
  label: string;
  items: CommandPaletteItem[];
}

type CommandPaletteItem = CommandPaletteAction | CommandPaletteUniversalItem;

function isAction(item: CommandPaletteItem): item is CommandPaletteAction {
  return (item as CommandPaletteAction).group !== undefined &&
    !["Projetos", "Execuções", "Agentes", "Aprovações"].includes((item as CommandPaletteAction).group as string);
}

/**
 * Normaliza uma string removendo acentos, colocando em minúsculas
 * e colapsando espaços. Útil para busca fuzzy em PT-BR.
 */
import {
  scoreItem,
  parseQueryPrefix,
  formatStatusLabel,
} from "../../lib/commandPaletteSearch";
// Re-export keeps existing import paths stable
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function CommandPalette({
  actions,
  universalItems = [],
  recents,
  favorites,
  prefixHistory = [],
  isFavorite,
  toggleFavorite,
  onSelect,
  onSelectUniversal,
  onClose,
  onPrefixUsed,
}: {
  actions: CommandPaletteAction[];
  universalItems?: CommandPaletteUniversalItem[];
  recents: string[];
  favorites: string[];
  prefixHistory?: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  onSelect: (action: CommandPaletteAction) => void;
  onSelectUniversal?: (item: CommandPaletteUniversalItem) => void;
  onClose: () => void;
  onPrefixUsed?: (prefix: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  useModalAccessibility(dialogRef, { onClose });

  // Foco inicial sempre no campo de busca
  useEffect(() => {
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const indexedActions = useMemo(() => {
    const map = new Map<string, CommandPaletteAction>();
    actions.forEach((action) => map.set(action.id, action));
    return map;
  }, [actions]);

  const filtered = useMemo<{ groups: GroupedItems[]; filterLabel: string | null }>(() => {
    const value = normalize(query);
    if (!value) {
      const favoriteActions = favorites
        .map((id) => indexedActions.get(id))
        .filter((action): action is CommandPaletteAction => Boolean(action));
      const recentActions = recents
        .map((id) => indexedActions.get(id))
        .filter((action): action is CommandPaletteAction => Boolean(action))
        .filter((action) => !favoriteActions.some((fav) => fav.id === action.id));
      const groups: GroupedItems[] = [];
      if (favoriteActions.length > 0) groups.push({ label: "Favoritos", items: favoriteActions });
      if (recentActions.length > 0) groups.push({ label: "Recentes", items: recentActions });
      // Ações universais também no overview, mas com limite
      if (universalItems.length > 0) {
        const projects = universalItems.filter((i) => i.group === "Projetos").slice(0, 3);
        if (projects.length > 0) groups.push({ label: "Projetos", items: projects });
      }
      groups.push({ label: "Ações", items: actions });
      return { groups, filterLabel: null };
    }

    // Filtros por prefixo (escopo explícito)
    const prefixMap: Record<string, CommandPaletteGroup | "all"> = {
      "/proj": "Projetos",
      "/projeto": "Projetos",
      "/exec": "Execuções",
      "/execucao": "Execuções",
      "/agent": "Agentes",
      "/agente": "Agentes",
      "/approval": "Aprovações",
      "/aprovacao": "Aprovações",
      "/nav": "Navegação",
      "/acao": "Ações",
      "/action": "Ações",
      // Sub-filtros de status em execuções
      "/running": "Execuções",
      "/rodando": "Execuções",
      "/completed": "Execuções",
      "/concluidas": "Execuções",
      "/failed": "Execuções",
      "/falhas": "Execuções",
      "/approval-pending": "Execuções",
      "/pendentes": "Execuções",
    };

    const statusSubFilter: Record<string, string> = {
      "/running": "running",
      "/rodando": "running",
      "/completed": "completed",
      "/concluidas": "completed",
      "/failed": "failed",
      "/falhas": "failed",
      "/approval-pending": "pending_approval",
      "/pendentes": "pending_approval",
    };

    let scope: CommandPaletteGroup | "all" | null = null;
    let searchValue = value;
    let filterLabel: string | null = null;
    let statusFilter: string | null = null;

    const prefixMatch = Object.keys(prefixMap).find((p) => value.startsWith(p));
    if (prefixMatch) {
      scope = prefixMap[prefixMatch];
      searchValue = value.slice(prefixMatch.length).trim();
      if (statusSubFilter[prefixMatch]) {
        statusFilter = statusSubFilter[prefixMatch];
        filterLabel = `Execuções: ${statusFilter}`;
      } else {
        filterLabel = `Filtro: ${prefixMap[prefixMatch]}`;
      }
    }

    // Busca por ID direto: prefixo @
    let idFilter: string | null = null;
    if (value.startsWith("@")) {
      idFilter = value.slice(1).trim();
      filterLabel = `Busca por ID: ${idFilter || "*"}`;
    }

    function inScope(item: CommandPaletteItem) {
      if (scope === null) return true;
      if (scope === "all") return true;
      return normalize(item.group || "") === normalize(scope);
    }

    // Match universal items
    const scoredUniversal = universalItems
      .map((item) => ({ item, score: scoreItem(searchValue, item) }))
      .filter((entry) => entry.score > 0 && inScope(entry.item))
      .sort((a, b) => b.score - a.score);

    // Match actions
    const scoredActions = actions
      .map((action) => ({ action, score: scoreItem(searchValue, action) }))
      .filter((entry) => entry.score > 0 && inScope(entry.action))
      .sort((a, b) => b.score - a.score);

    let projects = scoredUniversal.filter((e) => e.item.group === "Projetos").map((e) => e.item);
    let executions = scoredUniversal.filter((e) => e.item.group === "Execuções").map((e) => e.item);
    let agents = scoredUniversal.filter((e) => e.item.group === "Agentes").map((e) => e.item);
    let approvals = scoredUniversal.filter((e) => e.item.group === "Aprovações").map((e) => e.item);

    let navActions = scoredActions.filter((entry) => entry.action.group === "Navegação").map((e) => e.action);
    let otherActions = scoredActions.filter((entry) => entry.action.group !== "Navegação").map((e) => e.action);

    // Filtro por ID direto
    if (idFilter !== null) {
      const matchesId = (id: string) => normalize(id).includes(idFilter);
      projects = projects.filter((i) => matchesId(i.id) || matchesId(i.title));
      executions = executions.filter((i) => matchesId(i.id) || matchesId(i.title));
      agents = agents.filter((i) => matchesId(i.id) || matchesId(i.title));
      approvals = approvals.filter((i) => matchesId(i.id) || matchesId(i.title));
      navActions = navActions.filter((i) => matchesId(i.id) || matchesId(i.title));
      otherActions = otherActions.filter((i) => matchesId(i.id) || matchesId(i.title));
    }

    // Sub-filtro por status em Execuções
    if (statusFilter) {
      executions = executions.filter((e) => e.status === statusFilter);
    }

    const groups: GroupedItems[] = [];
    if (projects.length > 0) groups.push({ label: "Projetos", items: projects });
    if (executions.length > 0) {
      // Sub-agrupar por status dentro de Execuções (somente se houver mais de um status)
      const statusBuckets = new Map<string, CommandPaletteUniversalItem[]>();
      executions.forEach((exec) => {
        const status = exec.status || "outros";
        if (!statusBuckets.has(status)) statusBuckets.set(status, []);
        statusBuckets.get(status)!.push(exec);
      });
      const orderedStatuses = ["running", "pending_approval", "failed", "completed", "cancelled", "approved", "rejected"];
      const presentStatuses = orderedStatuses.filter((s) => statusBuckets.has(s));
      presentStatuses.forEach((status) => {
        const items = statusBuckets.get(status)!;
        if (items.length === 0) return;
        groups.push({ label: `Execuções • ${formatStatusLabel(status)}`, items });
      });
      // Status fora da lista ordenada
      statusBuckets.forEach((items, status) => {
        if (!presentStatuses.includes(status) && items.length > 0) {
          groups.push({ label: `Execuções • ${formatStatusLabel(status)}`, items });
        }
      });
    }
    if (agents.length > 0) groups.push({ label: "Agentes", items: agents });
    if (approvals.length > 0) groups.push({ label: "Aprovações", items: approvals });
    if (otherActions.length > 0) groups.push({ label: "Ações", items: otherActions });
    if (navActions.length > 0) groups.push({ label: "Navegação", items: navActions });

    return { groups, filterLabel };
  }, [actions, indexedActions, favorites, recents, query, universalItems]);

function formatStatusLabel(status: string): string {
  const map: Record<string, string> = {
    running: "Rodando",
    pending_approval: "Aguardando aprovação",
    approved: "Aprovada",
    rejected: "Rejeitada",
    completed: "Concluídas",
    failed: "Falhas",
    cancelled: "Canceladas",
  };
  return map[status] || status;
}

  const flatItems = useMemo(() => filtered.groups.flatMap((group) => group.items), [filtered]);

  useEffect(() => {
    if (flatItems.length === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !flatItems.some((item) => item.id === focusedId)) {
      setFocusedId(flatItems[0].id);
    }
  }, [flatItems, focusedId]);

  useEffect(() => {
    setStatusMessage("");
  }, [focusedId]);

  // Detecta o uso de prefixos (ex: "/running", "/approval") e os registra.
  useEffect(() => {
    const value = normalize(query);
    if (!value.startsWith("/") || value === "/" || value.startsWith("//")) return;
    const knownPrefixes = [
      "/proj", "/projeto", "/exec", "/execucao", "/agent", "/agente",
      "/approval", "/aprovacao", "/nav", "/acao", "/action",
      "/running", "/rodando", "/completed", "/concluidas",
      "/failed", "/falhas", "/approval-pending", "/pendentes",
    ];
    const matched = knownPrefixes.find((p) => value === p || value.startsWith(p + " "));
    if (matched && onPrefixUsed) {
      onPrefixUsed(matched);
    }
  }, [query, onPrefixUsed]);

  const focusedItem = focusedId ? flatItems.find((i) => i.id === focusedId) || null : null;
  const focusedIsAction = focusedItem ? isAction(focusedItem) : false;
  const focusedIsFavorite = focusedItem ? isFavorite(focusedItem.id) : false;

  function announce(message: string) {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(""), 1500);
  }

  function handleSelect(item: CommandPaletteItem | null) {
    if (!item) return;
    if (isAction(item)) {
      onSelect(item);
    } else {
      onSelectUniversal?.(item);
    }
    onClose();
  }

  function handleKeyNavigation(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      return;
    }

    if (document.activeElement !== searchInputRef.current) return;

    if (
      event.key === "f" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      focusedIsAction
    ) {
      event.preventDefault();
      if (!focusedItem) return;
      toggleFavorite(focusedItem.id);
      announce(isFavorite(focusedItem.id) ? "Removido dos favoritos" : "Adicionado aos favoritos");
      return;
    }

    // Atalhos inline em aprovações: 'a' aprova, 'r' rejeita
    if (
      focusedItem &&
      !focusedIsAction &&
      (focusedItem as CommandPaletteUniversalItem).group === "Aprovações" &&
      (focusedItem as CommandPaletteUniversalItem).actions &&
      (event.key === "a" || event.key === "r") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const item = focusedItem as CommandPaletteUniversalItem;
      const targetAction = item.actions?.find((a) =>
        a.id === (event.key === "a" ? "approve" : "reject")
      );
      if (targetAction) {
        announce(`${event.key === "a" ? "Aprovando" : "Rejeitando"} ${item.title}...`);
        Promise.resolve(targetAction.run())
          .then(() => {
            announce(event.key === "a" ? "Aprovação concluída" : "Rejeição concluída");
            onClose();
          })
          .catch((err) => {
            announce(err instanceof Error ? err.message : "Falha na ação");
          });
      }
      return;
    }

    if (flatItems.length === 0) return;

    const currentIndex = focusedId ? flatItems.findIndex((a) => a.id === focusedId) : -1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : Math.min(flatItems.length - 1, currentIndex + 1);
      setFocusedId(flatItems[nextIndex].id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1);
      setFocusedId(flatItems[nextIndex].id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      handleSelect(focusedItem);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-24 px-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Fechar paleta de comando"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="relative z-10 w-full max-w-4xl rounded-2xl border border-border bg-bg-card shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-[1.6fr_1fr]"
        onKeyDown={handleKeyNavigation}
      >
        <div className="sr-only" role="status" aria-live="polite">
          {statusMessage}
        </div>

        {/* Coluna principal: busca + ações */}
        <div className="flex flex-col min-w-0">
          <div className="px-5 py-4 border-b border-border-subtle flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 text-accent flex items-center justify-center">
              <Search size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div id="command-palette-title" className="text-[14px] font-semibold text-text-primary">Paleta de comando</div>
              <div className="text-[11px] text-text-muted">Ctrl+K · ↑↓ navegar · Enter executar · <Kbd>f</Kbd> favoritar · Esc fechar</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="no-drag w-8 h-8 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center"
              aria-label="Fechar paleta de comando"
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-4 border-b border-border-subtle bg-bg-deep/20">
            <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-bg-deep/40 px-3 py-2">
              <Search size={14} className="text-text-muted" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busque ações, páginas, projetos, execuções, agentes..."
                className="flex-1 bg-transparent outline-none text-[13px] text-text-primary placeholder:text-text-muted"
                aria-label="Buscar ação ou item"
                spellCheck={false}
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  className="text-[10.5px] text-text-muted hover:text-text-primary flex items-center gap-1"
                  aria-label="Limpar busca"
                >
                  <Trash2 size={11} /> limpar
                </button>
              )}
            </div>
            {filtered.filterLabel && (
              <div className="mt-2 flex items-center gap-2 text-[10.5px] text-accent">
                <span className="px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 font-semibold uppercase tracking-[0.12em]">
                  {filtered.filterLabel}
                </span>
                <span className="text-text-muted flex flex-wrap items-center gap-1">
                  Use <Kbd>/proj</Kbd> · <Kbd>/exec</Kbd> · <Kbd>/agent</Kbd> · <Kbd>/approval</Kbd> · <Kbd>/running</Kbd> · <Kbd>/completed</Kbd> · <Kbd>@id</Kbd>
                </span>
              </div>
            )}

            {!query && prefixHistory.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-[10.5px] text-text-muted flex-wrap">
                <span className="uppercase tracking-[0.12em] font-semibold">prefixos recentes</span>
                {prefixHistory.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setQuery(p)}
                    className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/30"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto p-3 space-y-3" role="listbox" aria-label="Resultados">
            {filtered.groups.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-2 text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
                  <GroupIcon group={group.label} />
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={focusedId === item.id}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setFocusedId(item.id)}
                    className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
                      focusedId === item.id
                        ? "border-accent/35 bg-accent/10"
                        : "border-border-subtle bg-bg-deep/20 hover:border-accent/20 hover:bg-bg-card-hover/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-bg-elevated border border-border-subtle text-accent flex items-center justify-center flex-shrink-0">
                        {item.icon || <ArrowRight size={14} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text-primary truncate">{item.title}</span>
                          {focusedIsAction && isFavorite(item.id) && (
                            <Star size={12} className="text-accent flex-shrink-0" fill="currentColor" aria-label="Favorito" />
                          )}
                          {item.rank !== undefined && query && (
                            <span className="ml-auto text-[9.5px] text-text-faint font-mono">{item.rank}</span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-text-secondary mt-0.5">{item.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}

            {filtered.groups.length === 0 && (
              <div className="rounded-xl border border-border-subtle bg-bg-deep/20 px-4 py-6 text-center text-[12px] text-text-muted">
                Nenhuma ação encontrada para “{query}”.
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border-subtle bg-bg-deep/20 flex items-center gap-2 text-[11px] text-text-muted flex-wrap">
            <div className="flex items-center gap-1"><Keyboard size={12} /> <span>Atalhos</span></div>
            <span className="text-border-subtle">•</span>
            <span className="inline-flex items-center gap-1"><Mic size={12} /> Abra voz rapidamente</span>
            <span className="text-border-subtle">•</span>
            <span className="inline-flex items-center gap-1"><ListChecks size={12} /> Busca universal</span>
            <span className="text-border-subtle">•</span>
            <span className="inline-flex items-center gap-1 flex-wrap">
              <Kbd>/proj</Kbd> <Kbd>/exec</Kbd> <Kbd>/agent</Kbd> <Kbd>/approval</Kbd> <Kbd>/running</Kbd> <Kbd>/completed</Kbd> <Kbd>/failed</Kbd> <Kbd>@id</Kbd>
            </span>
          </div>
        </div>

        {/* Coluna lateral: preview */}
        <aside className="hidden lg:flex flex-col border-l border-border-subtle bg-bg-deep/30 min-w-0">
          <div className="px-5 py-4 border-b border-border-subtle">
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-text-muted">Pré-visualização</div>
            <div className="text-[12px] text-text-muted mt-0.5">
              Detalhes do item selecionado.
            </div>
          </div>
          <div className="p-5 flex-1 overflow-auto">
            {focusedItem ? (
              focusedIsAction ? (
                <ActionPreview
                  action={focusedItem as CommandPaletteAction}
                  isFavorite={focusedIsFavorite}
                  onToggleFavorite={() => {
                    toggleFavorite(focusedItem.id);
                    announce(isFavorite(focusedItem.id) ? "Removido dos favoritos" : "Adicionado aos favoritos");
                  }}
                />
              ) : (
                <UniversalPreview item={focusedItem as CommandPaletteUniversalItem} />
              )
            ) : (
              <div className="text-[12px] text-text-muted">
                Selecione um item para ver os detalhes.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1 py-0.5 rounded bg-bg-input border border-border-subtle text-text-secondary text-[10px]">
      {children}
    </kbd>
  );
}

function GroupIcon({ group }: { group: string }) {
  if (group === "Favoritos") return <Star size={11} className="text-accent" />;
  if (group === "Recentes") return <Clock size={11} />;
  if (group === "Navegação") return <ArrowRight size={11} />;
  if (group === "Projetos") return <FolderKanban size={11} />;
  if (group === "Agentes") return <Sparkles size={11} />;
  if (group === "Aprovações") return <ShieldCheck size={11} />;
  if (group.startsWith("Execuções")) return <PlayCircle size={11} />;
  return <Sparkles size={11} />;
}

function ActionPreview({
  action,
  isFavorite,
  onToggleFavorite,
}: {
  action: CommandPaletteAction;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 text-accent flex items-center justify-center">
          {action.icon || <ArrowRight size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text-primary">{action.title}</div>
          {action.group && (
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-text-muted mt-0.5">{action.group}</div>
          )}
        </div>
      </div>

      <p className="text-[12.5px] text-text-secondary leading-relaxed">{action.description}</p>

      {action.aliases && action.aliases.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-text-muted">Alias:</span>
          {action.aliases.map((alias) => (
            <code key={alias} className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border-subtle text-text-secondary font-mono">
              {alias}
            </code>
          ))}
        </div>
      )}

      {action.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {action.keywords.map((keyword) => (
            <span
              key={keyword}
              className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border-subtle text-text-muted"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle">
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`no-drag flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] font-medium transition-colors ${
            isFavorite
              ? "bg-accent/10 text-accent border-accent/30"
              : "bg-bg-elevated text-text-secondary border-border-subtle hover:border-accent/25"
          }`}
        >
          <Star size={13} className="flex-shrink-0" fill={isFavorite ? "currentColor" : "none"} />
          {isFavorite ? "Remover dos favoritos" : "Marcar como favorito"}
        </button>
        <div className="text-[10.5px] text-text-muted flex items-center gap-1.5 flex-wrap">
          <Keyboard size={11} /> <Kbd>Enter</Kbd> executar · <Kbd>f</Kbd> favoritar
        </div>
      </div>
    </div>
  );
}

function UniversalPreview({ item }: { item: CommandPaletteUniversalItem }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 text-accent flex items-center justify-center">
          {item.icon || <ArrowRight size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text-primary">{item.title}</div>
          <div className="text-[10.5px] uppercase tracking-[0.12em] text-text-muted mt-0.5">{item.group}</div>
        </div>
      </div>
      <p className="text-[12.5px] text-text-secondary leading-relaxed">{item.description}</p>
      {item.keywords && item.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.keywords.map((keyword) => (
            <span
              key={keyword}
              className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border-subtle text-text-muted"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}

      {item.actions && item.actions.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle">
          {item.actions.map((action) => {
            const tone = action.tone || "primary";
            const toneClass =
              tone === "success"
                ? "bg-success/15 text-success border-success/30 hover:bg-success/20"
                : tone === "danger"
                ? "bg-error/15 text-error border-error/30 hover:bg-error/20"
                : "bg-accent/15 text-accent border-accent/30 hover:bg-accent/20";
            const shortcut = action.id === "approve" ? "a" : action.id === "reject" ? "r" : null;
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.run}
                className={`no-drag flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-[12px] font-medium transition-colors ${toneClass}`}
              >
                <span className="flex items-center gap-2">
                  {action.icon}
                  {action.label}
                </span>
                {shortcut && (
                  <Kbd>{shortcut}</Kbd>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="text-[10.5px] text-text-muted flex items-center gap-1.5">
        <Keyboard size={11} /> <Kbd>Enter</Kbd> para abrir
      </div>
    </div>
  );
}
