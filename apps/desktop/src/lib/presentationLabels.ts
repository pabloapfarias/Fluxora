/**
 * Camada central de apresentação — traduz labels técnicos internos
 * para textos amigáveis em português do Brasil.
 *
 * Nenhum componente deve exibir status/mode/role cru em JSX.
 * Sempre passar pelo formatter correspondente.
 */

// ─── Status de execução ──────────────────────────────────────────────

const EXECUTION_STATUS_MAP: Record<string, string> = {
  pending_approval: 'Aguardando aprovação',
  pending: 'Aguardando',
  running: 'Em execução',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  success: 'Concluído',
  error: 'Erro',
  idle: 'Ocioso',
  queued: 'Na fila',
  in_progress: 'Em andamento',
};

export function formatExecutionStatus(status: string): string {
  if (!status) return 'Desconhecido';
  const key = status.toLowerCase().trim();
  if (EXECUTION_STATUS_MAP[key]) return EXECUTION_STATUS_MAP[key];
  // Fallback: trocar underscores por espaços e capitalizar
  return key
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Modo de execução ────────────────────────────────────────────────

const EXECUTION_MODE_MAP: Record<string, string> = {
  simulated: 'Simulado',
  real: 'Real',
  multi_agent: 'Multiagente',
  controlled_execution: 'Execução controlada',
  conversation: 'Conversa',
  demo: 'Demonstração',
};

export function formatExecutionMode(mode: string): string {
  if (!mode) return 'Padrão';
  const key = mode.toLowerCase().trim();
  if (EXECUTION_MODE_MAP[key]) return EXECUTION_MODE_MAP[key];
  return key
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Status de aprovação ─────────────────────────────────────────────

const APPROVAL_STATUS_MAP: Record<string, string> = {
  pending: 'Pendente',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

export function formatApprovalStatus(status: string): string {
  if (!status) return 'Desconhecido';
  const key = status.toLowerCase().trim();
  if (APPROVAL_STATUS_MAP[key]) return APPROVAL_STATUS_MAP[key];
  return key
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Tipo de evento ──────────────────────────────────────────────────

const EVENT_TYPE_MAP: Record<string, string> = {
  workflow: 'Missão',
  command_run: 'Comando',
  controlled_run_test: 'Teste controlado',
  conversation: 'Conversa',
  conversation_responded: 'Conversa respondida',
  approval_request: 'Solicitação de aprovação',
  approval_granted: 'Aprovação concedida',
  approval_rejected: 'Aprovação rejeitada',
  agent_started: 'Agente iniciado',
  agent_completed: 'Agente concluído',
  agent_failed: 'Agente falhou',
  file_changed: 'Arquivo alterado',
  diff_generated: 'Diff gerado',
  log: 'Log',
  error: 'Erro',
  info: 'Informação',
  warning: 'Aviso',
  // Controlled execution
  'controlled_execution.started': 'Execução controlada iniciada',
  'controlled_execution.sandbox_ready': 'Sandbox pronto',
  'controlled_execution.before_git_status_captured': 'Status git pré-execução capturado',
  'controlled_execution.opencode_started': 'Runner iniciado',
  'controlled_execution.opencode_json_event': 'Evento do runner',
  'controlled_execution.opencode_completed': 'Runner concluído',
  'controlled_execution.after_git_status_captured': 'Status git pós-execução capturado',
  'controlled_execution.changed_files_detected': 'Arquivos alterados detectados',
  'controlled_execution.diff_generated': 'Diff gerado',
  'controlled_execution.out_of_scope_changes': 'Alterações fora do escopo',
  'controlled_execution.final_approval_required': 'Aprovação final necessária',
  'controlled_execution.completed': 'Execução controlada concluída',
  'controlled_execution.failed': 'Execução controlada falhou',
  'controlled_execution.cancelled': 'Execução controlada cancelada',
  'controlled_execution.ui_started': 'UI iniciada',
  'controlled_execution.ui_cancel_requested': 'Cancelamento solicitado',
  'controlled_execution.ui_opened_diff': 'Diff aberto na UI',
  'controlled_execution.ui_report_copied': 'Relatório copiado',
  'controlled_execution.approved': 'Execução controlada aprovada',
  'controlled_execution.rejected': 'Execução controlada rejeitada',
  'controlled_execution.progress': 'Progresso da execução controlada',
};

export function formatEventType(type: string): string {
  if (!type) return 'Evento';
  const key = type.toLowerCase().trim();
  if (EVENT_TYPE_MAP[key]) return EVENT_TYPE_MAP[key];
  return key
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Papel do agente ─────────────────────────────────────────────────

const AGENT_ROLE_MAP: Record<string, string> = {
  planner: 'Planejador',
  backend: 'Backend',
  mobile: 'Mobile',
  qa: 'QA',
  finalization: 'Finalização',
  reviewer: 'Revisor',
  orchestrator: 'Orquestrador',
  frontend: 'Frontend',
  devops: 'DevOps',
  security: 'Segurança',
  database: 'Banco de dados',
};

export function formatAgentRole(role: string): string {
  if (!role) return 'Agente';
  const key = role.toLowerCase().trim();
  if (AGENT_ROLE_MAP[key]) return AGENT_ROLE_MAP[key];
  return key
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Categoria de log ─────────────────────────────────────────────────

const LOG_CATEGORY_MAP: Record<string, string> = {
  missão: 'MISSÃO',
  missao: 'MISSÃO',
  mission: 'MISSÃO',
  agente: 'AGENTE',
  agent: 'AGENTE',
  opencode: 'STREAM',
  git: 'GIT',
  arquivos: 'ARQUIVOS',
  files: 'ARQUIVOS',
  aprovação: 'APROVAÇÃO',
  aprovacao: 'APROVAÇÃO',
  approval: 'APROVAÇÃO',
  erro: 'ERRO',
  error: 'ERRO',
  sistema: 'SISTEMA',
  system: 'SISTEMA',
  qa: 'QA',
  segurança: 'SEGURANÇA',
  seguranca: 'SEGURANÇA',
  security: 'SEGURANÇA',
};

export function formatLogCategory(category: string): string {
  if (!category) return 'SISTEMA';
  const key = category.toLowerCase().trim();
  if (LOG_CATEGORY_MAP[key]) return LOG_CATEGORY_MAP[key];
  return key.toUpperCase();
}

// ─── Classificador de intenção do chat ───────────────────────────────

const CONVERSATION_PATTERNS = [
  /^(oi|olá|ola|hey|hi|hello|e aí|eai|fala|salve|bom dia|boa tarde|boa noite|boa madrugada)$/i,
  /^(teste|test|tst|ping|echo)$/i,
  /^(quem é você|o que você faz|o que você faz\?|quem e voce|como funciona|ajuda|help)$/i,
  /^(obrigado|obrigada|valeu|thanks|thank you|brigado)$/i,
  /^(ok|beleza|blz|certo|entendi|entendido|show|perfeito|perfeita)$/i,
  /^(tchau|bye|até|ate|flw|falou|adeus)$/i,
];

/**
 * Classifica se a entrada do usuário é uma conversa simples
 * ou uma missão concreta para os agentes.
 */
export function classifyCommandIntent(
  input: string
): 'conversation' | 'mission' {
  const trimmed = input.trim().toLowerCase();

  // Empty or very short without technical content
  if (trimmed.length === 0) return 'conversation';

  // Check conversation patterns
  for (const pattern of CONVERSATION_PATTERNS) {
    if (pattern.test(trimmed)) return 'conversation';
  }

  // Very short messages (<= 3 chars) without technical keywords
  if (trimmed.length <= 3) return 'conversation';

  // Mission keywords
  const missionKeywords = [
    'criar', 'crie', 'crie', 'cria',
    'alterar', 'altere', 'altera', 'mude', 'modifique',
    'implementar', 'implemente', 'implementa',
    'corrigir', 'corrija', 'corrige', 'conserte', 'consertar',
    'refatorar', 'refatore', 'refatora',
    'executar', 'execute', 'executa',
    'testar', 'teste', 'testa',
    'revisar', 'revise', 'revisa',
    'gerar', 'gere', 'gera',
    'atualizar', 'atualize', 'atualiza',
    'adicionar', 'adicione', 'adiciona', 'inclua', 'incluir',
    'remover', 'remova', 'remove', 'delete', 'exclua',
    'deploy', 'build', 'commit', 'push', 'merge', 'rebase',
    'pr ', 'pull request',
    'bug', 'fix', 'hotfix',
    'readme', 'changelog', 'documentação', 'documentacao',
    'sandbox', 'projeto', 'arquivo', 'código', 'codigo',
    'componente', 'tela', 'página', 'pagina', 'rota', 'api',
    'banco', 'database', 'migration', 'model',
    'laravel', 'flutter', 'react', 'vue', 'angular', 'next',
    'docker', 'kubernetes', 'ci', 'cd',
    'configurar', 'config', 'setup', 'instalar', 'install',
    'analisar', 'analise', 'analisa', 'verificar', 'verifique',
    'melhorar', 'melhore', 'melhora', 'otimizar', 'otimize',
    'criar um', 'fazer um', 'faz um', 'desenvolver',
    'reconhecimento', 'reconhecer', 'reconheça',
  ];

  // Check if any mission keyword is present
  for (const keyword of missionKeywords) {
    if (trimmed.includes(keyword)) return 'mission';
  }

  // If message is long (> 15 chars), likely a mission
  if (trimmed.length > 15) return 'mission';

  // Default to conversation for ambiguous short messages
  return 'conversation';
}

// ─── Helpers para títulos de execução ────────────────────────────────

/**
 * Gera um título amigável para execuções recentes.
 */
export function formatExecutionTitle(
  title: string,
  mode?: string
): string {
  if (!title) return 'Execução';

  const intent = classifyCommandIntent(title);

  if (intent === 'conversation') {
    const lower = title.trim().toLowerCase();
    if (/^(oi|olá|ola|hey|hi|hello)$/i.test(lower)) return 'Conversa rápida';
    if (/^(teste|test|ping)$/i.test(lower)) return 'Teste de conversa';
    if (title.trim().length <= 10) return `Conversa: "${title.trim()}"`;
    return 'Conversa rápida';
  }

  // Mission - capitalize first letter
  const formatted = title.trim().replace(/^\w/, (c) => c.toUpperCase());
  if (mode) {
    const modeLabel = formatExecutionMode(mode);
    return `${formatted} (${modeLabel})`;
  }
  return formatted;
}

/**
 * Gera subtítulo amigável para execuções recentes.
 */
export function formatExecutionSubtitle(
  title: string,
  intent?: 'conversation' | 'mission'
): string {
  const resolvedIntent = intent ?? classifyCommandIntent(title);
  if (resolvedIntent === 'conversation') {
    return `"${title.trim()}"`;
  }
  return title.trim();
}
