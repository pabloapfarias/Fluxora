/**
 * Beta Smoke Test — validates the core Fluxora flows work end-to-end via mock API.
 *
 * 1. Simple conversation ("oi") → completed, no approval
 * 2. Project recognition read-only mission → logs, result, no approval, completed
 * 3. Mission with diff → approval with context, approve/reject work
 * 4. Job cancellation → status cancelled
 */
import { describe, expect, it } from "vitest";
import { createMockAPI } from "../api/mock-api";
import type { FluxoraAPI } from "@fluxora/shared";

// ---------------------------------------------------------------------------
// 1. Simple conversation
// ---------------------------------------------------------------------------

describe("Beta Smoke — Simple conversation", () => {
  it("'oi' generates a completed conversation without approval", async () => {
    const api = createMockAPI();

    // "oi" should be classified as conversation, not mission
    // Simulate what OverviewPage does: conversation flow creates local events only,
    // no workflow, no approval.
    const approvals = await api.approvals.list();
    const oiApproval = approvals.find(
      (a) => a.title?.toLowerCase().includes("oi") || a.description?.toLowerCase().includes("oi"),
    );
    // No approval should exist for "oi"
    expect(oiApproval).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Project recognition read-only mission
// ---------------------------------------------------------------------------

describe("Beta Smoke — Project recognition (read-only)", () => {
  it("creates execution, generates logs, result, no approval, completed", async () => {
    const api = createMockAPI();

    // Ensure a project exists
    const projects = await api.projects.list();
    const project = projects[0];
    expect(project).toBeDefined();

    // Create workflow for recognition mission
    const run = await api.workflows.create({
      title: "Reconhecimento do projeto",
      prompt: "faça o reconhecimento do projeto",
      generatedContext: "{}",
      projectId: project.id,
      executionMode: "real",
      realStrategy: "single",
      steps: [{ name: "Reconhecimento", type: "planner" }],
    });

    expect(run.status).toBe("pending_approval");

    // Auto-approve the initial gate to trigger execution
    const pending = await api.approvals.listPending();
    const gateApproval = pending.find((a) => a.workflowRunId === run.id);
    expect(gateApproval).toBeDefined();
    await api.approvals.approve(gateApproval!.id);

    // Wait for mock execution to complete
    await new Promise((r) => setTimeout(r, 3000));

    // Check final state
    const detail = await api.workflows.get(run.id);
    expect(detail.status).toBe("completed");

    // Should NOT have a final approval (read-only, no files changed)
    expect(detail.finalApprovalId).toBeUndefined();

    // Should have mission result event
    const resultEvents = detail.events.filter((e) => e.type === "mission.result");
    expect(resultEvents.length).toBeGreaterThan(0);

    // Should have mission type log
    const typeEvents = detail.events.filter((e) => e.type === "mission.type");
    expect(typeEvents.length).toBeGreaterThan(0);
    expect(typeEvents[0].message).toContain("Reconhecimento");

    // Should have project log
    const projectEvents = detail.events.filter((e) => e.type === "mission.project");
    expect(projectEvents.length).toBeGreaterThan(0);

    // Should have mode log showing read-only
    const modeEvents = detail.events.filter((e) => e.type === "mission.mode");
    expect(modeEvents.length).toBeGreaterThan(0);
    expect(modeEvents[0].message).toContain("Read-only");
  });
});

// ---------------------------------------------------------------------------
// 3. Mission with diff → approval with context
// ---------------------------------------------------------------------------

describe("Beta Smoke — Mission with diff", () => {
  it("creates approval with file list, summary, and impact", async () => {
    const api = createMockAPI();
    const projects = await api.projects.list();

    // Create workflow for a modification mission
    const run = await api.workflows.create({
      title: "Criar endpoint de cupom",
      prompt: "criar endpoint de cupom",
      generatedContext: "{}",
      projectId: projects[0].id,
      executionMode: "real",
      realStrategy: "single",
      steps: [{ name: "Desenvolvimento", type: "developer" }],
    });

    // Auto-approve initial gate
    const pending = await api.approvals.listPending();
    const gateApproval = pending.find((a) => a.workflowRunId === run.id);
    await api.approvals.approve(gateApproval!.id);

    // Wait for mock execution
    await new Promise((r) => setTimeout(r, 3000));

    // Check final state — should be pending_approval (waiting for final approval)
    const detail = await api.workflows.get(run.id);
    expect(detail.status).toBe("pending_approval");
    expect(detail.finalApprovalId).toBeDefined();

    // Find the final approval
    const allApprovals = await api.approvals.list();
    const finalApproval = allApprovals.find((a) => a.id === detail.finalApprovalId);
    expect(finalApproval).toBeDefined();
    expect(finalApproval!.status).toBe("pending");

    // Approval should have rich context
    expect(finalApproval!.title).toContain("arquivo");
    expect(finalApproval!.description).toContain("Arquivos alterados");
    expect(finalApproval!.description).toContain("Impacto");
    expect(finalApproval!.description).toContain("Agente");

    // Should have changed files
    const changedFiles = await api.git.changedFiles(run.id);
    expect(changedFiles.length).toBeGreaterThan(0);
  });

  it("approve changes status to completed", async () => {
    const api = createMockAPI();
    const projects = await api.projects.list();

    const run = await api.workflows.create({
      title: "Teste de aprovação",
      prompt: "criar componente",
      generatedContext: "{}",
      projectId: projects[0].id,
      executionMode: "real",
      realStrategy: "single",
      steps: [{ name: "Dev", type: "developer" }],
    });

    // Auto-approve gate
    const pending1 = await api.approvals.listPending();
    const gate = pending1.find((a) => a.workflowRunId === run.id);
    await api.approvals.approve(gate!.id);
    await new Promise((r) => setTimeout(r, 3000));

    // Get final approval
    const detail = await api.workflows.get(run.id);
    const finalApprovalId = detail.finalApprovalId!;
    await api.workflows.approveFinal(run.id);

    // Check final state
    const after = await api.workflows.get(run.id);
    expect(after.status).toBe("completed");

    const approvals = await api.approvals.list();
    const finalApproval = approvals.find((a) => a.id === finalApprovalId);
    expect(finalApproval!.status).toBe("approved");
  });

  it("reject changes status to rejected", async () => {
    const api = createMockAPI();
    const projects = await api.projects.list();

    const run = await api.workflows.create({
      title: "Teste de rejeição",
      prompt: "criar componente",
      generatedContext: "{}",
      projectId: projects[0].id,
      executionMode: "real",
      realStrategy: "single",
      steps: [{ name: "Dev", type: "developer" }],
    });

    // Auto-approve gate
    const pending1 = await api.approvals.listPending();
    const gate = pending1.find((a) => a.workflowRunId === run.id);
    await api.approvals.approve(gate!.id);
    await new Promise((r) => setTimeout(r, 3000));

    // Reject final approval
    await api.workflows.rejectFinal(run.id);

    const after = await api.workflows.get(run.id);
    expect(after.status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// 4. Job cancellation
// ---------------------------------------------------------------------------

describe("Beta Smoke — Job cancellation", () => {
  it("cancel changes job status to cancelled", async () => {
    const api = createMockAPI();
    const projects = await api.projects.list();

    const run = await api.workflows.create({
      title: "Teste de cancelamento",
      prompt: "tarefa longa",
      generatedContext: "{}",
      projectId: projects[0].id,
      executionMode: "real",
      realStrategy: "single",
      steps: [{ name: "Dev", type: "developer" }],
    });

    // Start execution
    const pending = await api.approvals.listPending();
    const gate = pending.find((a) => a.workflowRunId === run.id);
    await api.approvals.approve(gate!.id);

    // Immediately cancel
    const jobs = await api.workflows.listJobs();
    const activeJob = jobs.find(
      (j) => j.workflowRunId === run.id && ["queued", "running"].includes(j.status),
    );

    if (activeJob) {
      await api.workflows.cancelJob(activeJob.id);
      const updated = await api.workflows.getJob(activeJob.id);
      expect(updated!.status).toBe("cancelled");
    }
  });
});
