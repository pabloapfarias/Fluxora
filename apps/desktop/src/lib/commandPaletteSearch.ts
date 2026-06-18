import type { CommandPaletteAction, CommandPaletteUniversalItem } from "../components/help/CommandPalette";

/**
 * Normaliza uma string removendo acentos, colocando em minúsculas
 * e colapsando espaços. Útil para busca fuzzy em PT-BR.
 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcula um score de similaridade fuzzy simples.
 */
export function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) return 100;
  if (!haystack) return 0;
  if (haystack.startsWith(needle)) return 100;
  if (haystack.includes(needle)) return 80;

  let nIdx = 0;
  for (let i = 0; i < haystack.length && nIdx < needle.length; i++) {
    if (haystack[i] === needle[nIdx]) nIdx++;
  }
  if (nIdx === needle.length) return 60;
  return 0;
}

export type CommandPaletteItem = CommandPaletteAction | CommandPaletteUniversalItem;

export function scoreItem(
  value: string,
  item: CommandPaletteItem
): number {
  if (item.rank !== undefined && value) return item.rank;

  const title = normalize(item.title);
  const description = normalize(item.description);
  const group = normalize(item.group || "");
  const keywords = (item.keywords || []).map(normalize).join(" ");

  if ("aliases" in item && item.aliases) {
    for (const alias of item.aliases) {
      if (normalize(alias) === value) return 200;
    }
  }

  return Math.max(
    fuzzyScore(value, title) + 5,
    fuzzyScore(value, description),
    fuzzyScore(value, keywords),
    fuzzyScore(value, group)
  );
}

const STATUS_LABELS: Record<string, string> = {
  running: "Rodando",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Rejeitada",
  completed: "Concluídas",
  failed: "Falhas",
  cancelled: "Canceladas",
};

export function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

export interface PrefixScope {
  scope: string | null;
  searchValue: string;
  filterLabel: string | null;
  statusFilter: string | null;
}

const PREFIX_MAP: Record<string, string> = {
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
  "/running": "Execuções",
  "/rodando": "Execuções",
  "/completed": "Execuções",
  "/concluidas": "Execuções",
  "/failed": "Execuções",
  "/falhas": "Execuções",
  "/approval-pending": "Execuções",
  "/pendentes": "Execuções",
};

const STATUS_SUBFILTER: Record<string, string> = {
  "/running": "running",
  "/rodando": "running",
  "/completed": "completed",
  "/concluidas": "completed",
  "/failed": "failed",
  "/falhas": "failed",
  "/approval-pending": "pending_approval",
  "/pendentes": "pending_approval",
};

export function parseQueryPrefix(rawValue: string): PrefixScope {
  const value = normalize(rawValue);
  if (!value) return { scope: null, searchValue: "", filterLabel: null, statusFilter: null };

  if (value.startsWith("@")) {
    return {
      scope: null,
      searchValue: value.slice(1).trim(),
      filterLabel: `Busca por ID: ${value.slice(1).trim() || "*"}`,
      statusFilter: null,
    };
  }

  const prefixMatch = Object.keys(PREFIX_MAP).find((p) => value === p || value.startsWith(p + " "));
  if (!prefixMatch) {
    return { scope: null, searchValue: value, filterLabel: null, statusFilter: null };
  }

  const scope = PREFIX_MAP[prefixMatch];
  const searchValue = value.slice(prefixMatch.length).trim();
  const statusFilter = STATUS_SUBFILTER[prefixMatch] || null;
  const filterLabel = statusFilter
    ? `Execuções: ${statusFilter}`
    : `Filtro: ${scope}`;

  return { scope, searchValue, filterLabel, statusFilter };
}
