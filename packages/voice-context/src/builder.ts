import { classifyMissionIntent, resolveMissionPipeline, type VoiceContextResult, type AgentRole } from "@fluxora/shared";

export interface BuildVoiceContextInput {
  transcript: string;
  /** Projeto ativo no app. Quando informado, vira o projeto sugerido padrão. */
  activeProject?: { id: string; name: string } | null;
  /** Lista de projetos disponíveis. Usada como fallback se não houver ativo. */
  availableProjects?: Array<{ id: string; name: string }>;
}

export function buildVoiceContext(
  input: string | BuildVoiceContextInput
): VoiceContextResult {
  const params: BuildVoiceContextInput = typeof input === "string" ? { transcript: input } : input;
  const transcript = params.transcript || "";
  const lower = transcript.toLowerCase();

  // ============================================================
  // 1. Sugestão de projeto
  //    - Se o usuário mencionar explicitamente um nome de projeto conhecido, usa esse.
  //    - Caso contrário, usa o projeto ATIVO do app (não um fallback hardcoded).
  //    - Se nem ativo nem mencionado existir, fica vazio (a UI exibe "—").
  // ============================================================
  const suggestedProjects: string[] = [];
  const lowerProjectNames = (params.availableProjects || []).map((p) => ({
    id: p.id,
    name: p.name,
    lower: p.name.toLowerCase(),
  }));

  for (const candidate of lowerProjectNames) {
    const normalizedText = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const nameTokens = candidate.lower
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\s+/)
      .filter((token) => token.length > 2);
    if (nameTokens.length === 0) continue;
    const allTokensPresent = nameTokens.every((token) => normalizedText.includes(token));
    if (allTokensPresent || normalizedText.includes(candidate.lower.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
      suggestedProjects.push(candidate.name);
    }
  }

  if (suggestedProjects.length === 0 && params.activeProject) {
    suggestedProjects.push(params.activeProject.name);
  }

  // ============================================================
  // 2. Sugestão de agentes
  //    Não inferimos stack a partir de palavras-chave. Sugerimos o conjunto
  //    mínimo de papéis que faz sentido para o pipeline e deixamos a UI
  //    permitir editar/ajustar.
  // ============================================================
  const suggestedAgents: AgentRole[] = [];

  const intent = classifyMissionIntent(lower);
  const pipeline = resolveMissionPipeline(intent);

  if (pipeline === "recognition") {
    suggestedAgents.push("planner");
  } else if (pipeline === "validation") {
    suggestedAgents.push("planner", "qa");
  } else {
    suggestedAgents.push("planner", "qa");
  }

  const risk = determineRisk(lower, intent);
  const title = generateTitle(transcript);
  const summary = generateSummary(transcript, suggestedProjects);

  return {
    intent,
    title,
    summary,
    suggestedProjects,
    suggestedAgents,
    risk,
    requiresApproval: risk !== "low",
  };
}

function determineRisk(text: string, intent: VoiceContextResult["intent"]): "low" | "medium" | "high" {
  if (intent === "project_recognition" || intent === "validation" || intent === "investigation") {
    return "low";
  }
  if (/\b(deletar|remover|excluir|eliminar|pagamento|produção|producao|deploy|publicar)\b/i.test(text)) {
    return "high";
  }
  if (/\b(criar|crie|adicionar|implementar|alterar|modificar|desenvolver|construir|gerar)\b/i.test(text)) {
    return "medium";
  }
  return "low";
}

function generateTitle(transcript: string): string {
  const cleaned = transcript.replace(/[?.!]/g, "").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.substring(0, 57) + "...";
}

function generateSummary(transcript: string, projects: string[]): string {
  if (projects.length === 0) {
    return `Missão: "${transcript}".`;
  }
  const projectList = projects.join(", ");
  return `Missão: "${transcript}" — projeto: ${projectList}.`;
}
