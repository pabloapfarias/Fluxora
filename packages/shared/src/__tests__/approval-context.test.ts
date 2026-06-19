import { describe, it, expect } from "vitest";
import { validateApprovalContext } from "../index";
import type { Approval } from "../index";

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "appr-1",
    title: "Aprovar alterações: 2 arquivo(s)",
    description: [
      "Missão: Implementar feature X",
      "Motivo: Foram detectadas alterações em arquivos.",
      "",
      "Arquivos alterados:",
      "- src/app.ts (modified, +10/-2)",
      "- src/utils.ts (added, +25/-0)",
      "",
      "Resumo: +35/-2 linhas em 2 arquivo(s)",
      "Impacto: Médio",
      "Agente: Fluxora Agent Engine (modo real)",
    ].join("\n"),
    impact: "medium",
    status: "pending",
    projectId: "proj-1",
    workflowRunId: "wf-1",
    createdAt: "2026-06-15T00:00:00Z",
    ...overrides,
  };
}

describe("validateApprovalContext", () => {
  // ---- canApprove = true quando contexto é rico ----

  it("retorna canApprove=true para aprovação com contexto rico", () => {
    const approval = makeApproval();
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
    expect(ctx.invalidReason).toBeUndefined();
  });

  it("extrai missionTitle da descrição", () => {
    const approval = makeApproval();
    const ctx = validateApprovalContext(approval);
    expect(ctx.missionTitle).toBe("Implementar feature X");
  });

  it("extrai reason da descrição", () => {
    const approval = makeApproval();
    const ctx = validateApprovalContext(approval);
    expect(ctx.reason).toBe("Foram detectadas alterações em arquivos.");
  });

  it("extrai generatedBy da descrição", () => {
    const approval = makeApproval();
    const ctx = validateApprovalContext(approval);
    expect(ctx.generatedBy).toBe("Fluxora Agent Engine (modo real)");
  });

  it("extrai changedFiles da descrição", () => {
    const approval = makeApproval();
    const ctx = validateApprovalContext(approval);
    expect(ctx.changedFiles.length).toBe(2);
    expect(ctx.changedFiles[0].path).toBe("src/app.ts");
    expect(ctx.changedFiles[0].additions).toBe(10);
    expect(ctx.changedFiles[0].deletions).toBe(2);
  });

  it("extrai diffSummary da descrição", () => {
    const approval = makeApproval();
    const ctx = validateApprovalContext(approval);
    expect(ctx.diffSummary).toBe("+35/-2 linhas em 2 arquivo(s)");
  });

  // ---- canApprove = false quando contexto é insuficiente ----

  it("retorna canApprove=false para aprovação sem motivo e sem dados acionáveis", () => {
    const approval = makeApproval({
      title: "Revisão manual",
      description: "Revise manualmente.",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(false);
    expect(ctx.invalidReason).toContain("contexto insuficiente");
  });

  it("retorna canApprove=false para descrição vazia", () => {
    const approval = makeApproval({
      description: "",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(false);
  });

  it("retorna canApprove=true quando tem erro na descrição mesmo sem arquivos", () => {
    const approval = makeApproval({
      description: "Motivo: Erro na execução do Planner.\nFalha detectada no agente.",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
  });

  it("retorna canApprove=true quando tem QA summary", () => {
    const approval = makeApproval({
      description: "Motivo: QA reprovou.\nQA: O fluxo ainda permite path inválido.",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
    expect(ctx.qaSummary).toBe("O fluxo ainda permite path inválido.");
  });

  it("retorna canApprove=true quando tem remainingIssues", () => {
    const approval = makeApproval({
      description: "Motivo: QA reprovou.\nProblemas restantes:\n- Falta validação\n- Mensagem não aparece",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
    expect(ctx.remainingIssues.length).toBe(2);
  });

  it("retorna canApprove=true quando tem automaticAttempts", () => {
    const approval = makeApproval({
      description: "Motivo: QA reprovou.\nTentativas automáticas:\n1. Ajuste em ProjectsPage.tsx\n2. Ajuste no IPC",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
    expect(ctx.automaticAttempts.length).toBe(2);
  });

  // ---- Revisão manual com contexto rico ----

  it("processa revisão manual com contexto completo", () => {
    const approval = makeApproval({
      title: "Revisão manual necessária",
      description: [
        "Missão: Implementar validação de path no cadastro de projeto.",
        "Motivo: QA encontrou falha após 2 tentativas automáticas de correção.",
        "",
        "QA:",
        "O fluxo ainda permite salvar path inexistente ao editar projeto.",
        "",
        "Tentativas automáticas:",
        "1. Ajuste em ProjectsPage.tsx",
        "2. Ajuste no IPC project:validatePath",
        "",
        "Problemas restantes:",
        "- Falta bloquear submit quando validatePath retorna erro.",
        "- Mensagem de erro não aparece após selecionar pasta inválida.",
        "",
        "Planner (resumo):",
        "Adicionar validação de path no formulário de projeto.",
        "",
        "Developer (resumo):",
        "Implementei validação no frontend e backend.",
        "",
        "Agente: Multiagente (Planner → Developer → QA)",
        "Projeto: Fluxora (/home/pablo/projects/Fluxora)",
      ].join("\n"),
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
    expect(ctx.missionTitle).toBe("Implementar validação de path no cadastro de projeto.");
    expect(ctx.reason).toContain("QA encontrou falha");
    expect(ctx.qaSummary).toContain("path inexistente");
    expect(ctx.automaticAttempts.length).toBe(2);
    expect(ctx.remainingIssues.length).toBe(2);
    expect(ctx.generatedBy).toContain("Multiagente");
  });

  // ---- Edge cases ----

  it("lida com descrição undefined graciosamente", () => {
    const approval = makeApproval({ description: undefined as any });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(false);
  });

  it("usa title como fallback quando Missão não está na descrição", () => {
    const approval = makeApproval({
      description: "Motivo: Erro na execução.\nErro detectado.",
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.missionTitle).toBe(approval.title);
  });

  // ---- Suporte a pedidos simples (voz/comando direto) ----

  it("aceita prompt simples via runPrompt quando descrição é genérica", () => {
    const approval = makeApproval({
      title: "Aprovar: Eu quero que você crie dentro desse projeto uma página pa...",
      description: "Aprovar: Eu quero que você crie dentro desse projeto uma página para advogados.",
    });
    const ctx = validateApprovalContext(approval, {
      runPrompt:
        "Eu quero que você crie dentro desse projeto uma página para advogados. Essa página tem que ser com um tema escuro e que seja em HTML, CSS, que pode usar também o Tailwind 4.",
    });
    expect(ctx.canApprove).toBe(true);
    expect(ctx.missionTitle.toLowerCase()).toContain("página para advogados");
    expect(ctx.reason).toContain("Tailwind 4");
  });

  it("marca contexto mínimo quando só há prompt curto", () => {
    const approval = makeApproval({
      title: "Aprovar pedido simples",
      description: "Aprovar pedido simples",
    });
    const ctx = validateApprovalContext(approval, { runPrompt: "Criar landing" });
    expect(ctx.canApprove).toBe(true);
    expect(ctx.invalidReason).toContain("Contexto mínimo");
  });

  // ---- HOTFIX UI E2E — Aprovação de apply-patch com payload de PatchProposal ----

  it("retorna canApprove=true quando approval apply-patch tem proposalId+files no payload mesmo sem runPrompt", () => {
    const approval = makeApproval({
      title: "Aplicar patch: Landing de seguros",
      description: "Aplicar patch: Landing de seguros",
      action: "apply-patch",
      // descrição técnica antiga: sem prefixos, sem lista de arquivos
      payload: {
        proposalId: "patch-1781893116793-0",
        missionId: "mission-1",
        projectId: "project-1",
        files: ["index.html", "styles.css", "script.js"],
        source: "mission-engine",
      },
    });
    const ctx = validateApprovalContext(approval);
    expect(ctx.canApprove).toBe(true);
    expect(ctx.invalidReason).toBeUndefined();
  });

  it("retorna canApprove=true quando approval apply-patch tem apenas proposalId (sem files) e runPrompt curto", () => {
    const approval = makeApproval({
      title: "Aplicar patch",
      description: "Aplicar patch",
      action: "apply-patch",
      payload: {
        proposalId: "patch-1781893116793-0",
        missionId: "mission-1",
        projectId: "project-1",
        source: "mission-engine",
      },
    });
    const ctx = validateApprovalContext(approval, { runPrompt: "Criar landing" });
    expect(ctx.canApprove).toBe(true);
  });
});
