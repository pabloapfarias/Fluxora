import { describe, it, expect } from "vitest";
import { buildVoiceContext } from "../builder";

describe("buildVoiceContext", () => {
  it("não infere projeto por palavras-chave e usa o projeto ativo", () => {
    const result = buildVoiceContext({
      transcript: "Quero criar uma nova API no Laravel",
      activeProject: { id: "p-adv", name: "Escritório Advocacia" },
    });
    expect(result.suggestedProjects).toEqual(["Escritório Advocacia"]);
    expect(result.suggestedAgents).not.toContain("backend-dev");
    expect(result.intent).toBe("feature_request");
  });

  it("reconhece projeto mencionado por nome", () => {
    const result = buildVoiceContext({
      transcript: "Preciso mexer no escritório de advocacia",
      availableProjects: [
        { id: "p-adv", name: "Escritório Advocacia" },
        { id: "p-api", name: "eBig Food API" },
      ],
    });
    expect(result.suggestedProjects).toContain("Escritório Advocacia");
  });

  it("não força fallback quando não há projeto ativo nem mencionado", () => {
    const result = buildVoiceContext("Qualquer coisa");
    expect(result.suggestedProjects).toEqual([]);
  });

  it("inclui planner e qa por padrão em missões de entrega", () => {
    const result = buildVoiceContext("Criar landing page");
    expect(result.suggestedAgents).toContain("planner");
    expect(result.suggestedAgents).toContain("qa");
  });

  it("detecta risco alto para pagamento/produção", () => {
    const result = buildVoiceContext("Implementar sistema de pagamentos em produção");
    expect(result.risk).toBe("high");
    expect(result.requiresApproval).toBe(true);
  });

  it("detecta risco médio para criação", () => {
    const result = buildVoiceContext("Criar novo cupom de desconto");
    expect(result.risk).toBe("medium");
    expect(result.requiresApproval).toBe(true);
  });

  it("detecta intent bug_fix", () => {
    const result = buildVoiceContext("Corrigir bug no login");
    expect(result.intent).toBe("bug_fix");
  });

  it("gera título curto a partir do transcript", () => {
    const result = buildVoiceContext("Criar sistema de autenticação completo com OAuth2 e refresh tokens");
    expect(result.title).toBeTruthy();
    expect(result.title.length).toBeLessThanOrEqual(60);
  });

  it("classifica reconhecimento como somente leitura", () => {
    const result = buildVoiceContext("Faça o reconhecimento do projeto");
    expect(result.intent).toBe("project_recognition");
    expect(result.risk).toBe("low");
    expect(result.suggestedAgents).toEqual(["planner"]);
  });

  it("classifica validação sem developer", () => {
    const result = buildVoiceContext("Valide o projeto e rode os testes principais");
    expect(result.intent).toBe("validation");
    expect(result.suggestedAgents).toContain("planner");
    expect(result.suggestedAgents).toContain("qa");
  });

  it("reconhece variações verbais de criar (crie/criar/construir)", () => {
    expect(buildVoiceContext("Crie uma página simples").intent).toBe("feature_request");
    expect(buildVoiceContext("Preciso que você construa um formulário").intent).toBe("feature_request");
    expect(buildVoiceContext("Faça uma tela de login").intent).toBe("feature_request");
  });

  it("summary não cita projeto quando não há projeto conhecido", () => {
    const result = buildVoiceContext({ transcript: "Criar página" });
    expect(result.summary).not.toContain("eBig Food API");
  });
});
