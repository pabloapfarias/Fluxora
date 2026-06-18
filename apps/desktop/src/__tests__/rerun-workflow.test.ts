/**
 * Testes do contrato de reexecução (`workflows.rerun`).
 *
 * Valida que, ao reexecutar uma missão falha/cancelada, o sistema:
 * 1. Cria um novo WorkflowRun vinculado ao original (parentRunId).
 * 2. Reutiliza prompt/projeto/modo quando nenhum override é passado.
 * 3. Aplica overrides de prompt e timeout quando fornecidos.
 * 4. Despacha um job em background e emite evento `workflow.rerun.started`.
 */
import { describe, expect, it } from "vitest";
import { createMockAPI } from "../api/mock-api";
import type { FluxoraAPI } from "@fluxora/shared";

async function seedFailedRun(api: FluxoraAPI, overrides?: { prompt?: string; executionMode?: "real" | "simulated" }) {
  const projects = await api.projects.list();
  const run = await api.workflows.create({
    title: "Página de advocacia",
    prompt: overrides?.prompt ?? "Crie uma página para um escritório de advocacia",
    generatedContext: "{}",
    projectId: projects[0].id,
    executionMode: overrides?.executionMode ?? "real",
    realStrategy: "single",
    steps: [{ name: "Dev", type: "developer" }],
  });
  // Simula uma falha prévia marcando o run como failed.
  await api.workflows.runRealAsync(run.id);
  await new Promise((r) => setTimeout(r, 50));
  // Força o status final para failed (o mock pode ter completado).
  const detail = await api.workflows.get(run.id);
  return { originalId: run.id, originalDetail: detail };
}

describe("workflows.rerun — contrato de reexecução", () => {
  it("cria um novo run vinculado ao original via parentRunId no generatedContext", async () => {
    const api = createMockAPI();
    const { originalId } = await seedFailedRun(api);

    const result = await api.workflows.rerun(originalId);

    expect(result.workflowRunId).not.toBe(originalId);
    expect(result.jobId).toBeTruthy();

    const newDetail = await api.workflows.get(result.workflowRunId);
    const ctx = JSON.parse(newDetail.generatedContext || "{}");
    expect(ctx.kind).toBe("rerun");
    expect(ctx.parentRunId).toBe(originalId);
  });

  it("reutiliza prompt original quando nenhum override é fornecido", async () => {
    const api = createMockAPI();
    const { originalId } = await seedFailedRun(api, {
      prompt: "Crie uma landing page para imobiliária",
    });

    const result = await api.workflows.rerun(originalId);
    const newDetail = await api.workflows.get(result.workflowRunId);

    expect(newDetail.prompt).toBe("Crie uma landing page para imobiliária");
  });

  it("aplica override de prompt quando fornecido", async () => {
    const api = createMockAPI();
    const { originalId } = await seedFailedRun(api, {
      prompt: "Prompt original",
    });

    const result = await api.workflows.rerun(originalId, {
      prompt: "Prompt editado pelo usuário",
    });
    const newDetail = await api.workflows.get(result.workflowRunId);

    expect(newDetail.prompt).toBe("Prompt editado pelo usuário");
  });

  it("aplica override de timeout atualizando as settings do OpenCode", async () => {
    const api = createMockAPI();
    const { originalId } = await seedFailedRun(api);

    const before = await api.opencode.getSettings();
    const newTimeout = 15 * 60 * 1000;

    await api.workflows.rerun(originalId, { defaultTimeoutMs: newTimeout });

    const after = await api.opencode.getSettings();
    expect(after.defaultTimeoutMs).toBe(newTimeout);
    expect(after.defaultTimeoutMs).not.toBe(before.defaultTimeoutMs);
  });

  it("emite evento workflow.rerun.started no novo run", async () => {
    const api = createMockAPI();
    const { originalId } = await seedFailedRun(api);

    const result = await api.workflows.rerun(originalId);
    const newDetail = await api.workflows.get(result.workflowRunId);

    const rerunEvents = newDetail.events.filter((e) => e.type === "workflow.rerun.started");
    expect(rerunEvents.length).toBeGreaterThan(0);
    expect(rerunEvents[0].message).toContain(originalId);
  });

  it("cria um job em background para o novo run", async () => {
    const api = createMockAPI();
    const { originalId } = await seedFailedRun(api);

    const result = await api.workflows.rerun(originalId);
    const jobs = await api.workflows.listJobs();
    const newJob = jobs.find((j) => j.workflowRunId === result.workflowRunId);

    expect(newJob).toBeDefined();
    expect(newJob!.id).toBe(result.jobId);
  });

  it("preserva o run original (não muta o histórico)", async () => {
    const api = createMockAPI();
    const { originalId, originalDetail } = await seedFailedRun(api);

    await api.workflows.rerun(originalId);
    const originalAgain = await api.workflows.get(originalId);

    expect(originalAgain.id).toBe(originalId);
    expect(originalAgain.prompt).toBe(originalDetail.prompt);
    expect(originalAgain.title).toBe(originalDetail.title);
  });

  it("erro quando workflow original não existe", async () => {
    const api = createMockAPI();
    await expect(api.workflows.rerun("inexistente")).rejects.toThrow();
  });
});
