import { describe, it, expect } from "vitest";
import { createMockAPI } from "../api/mock-api";

describe("Project Validation", () => {
  it("should create a project with valid name, path and stack", async () => {
    const api = createMockAPI();
    const project = await api.projects.create({
      name: "Test Project",
      path: "/test/path",
      stack: ["TypeScript", "React"],
    });

    expect(project).toBeDefined();
    expect(project.name).toBe("Test Project");
    expect(project.path).toBe("/test/path");
    expect(project.stack).toEqual(["TypeScript", "React"]);
    expect(project.status).toBe("idle");
    expect(project.id).toBeTruthy();
  });

  it("should list created projects", async () => {
    const api = createMockAPI();
    const projects = await api.projects.list();

    // Should have seed projects + any created
    expect(projects.length).toBeGreaterThanOrEqual(5);
    expect(projects.some((p) => p.name === "eBig Food API")).toBe(true);
  });

  it("should update a project", async () => {
    const api = createMockAPI();
    const projects = await api.projects.list();
    const project = projects[0];

    const updated = await api.projects.update(project.id, {
      name: "Updated Name",
      status: "running",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.status).toBe("running");
  });

  it("should remove a project", async () => {
    const api = createMockAPI();
    const project = await api.projects.create({
      name: "To Delete",
      path: "/delete/me",
      stack: ["Test"],
    });

    const beforeCount = (await api.projects.list()).length;
    await api.projects.remove(project.id);
    const afterCount = (await api.projects.list()).length;

    expect(afterCount).toBe(beforeCount - 1);
  });
});

describe("Workflow Validation", () => {
  it("should create a workflow with valid data", async () => {
    const api = createMockAPI();
    const run = await api.workflows.create({
      title: "Test Workflow",
      prompt: "Create a feature",
      generatedContext: "{}",
      steps: [
        { name: "Planejamento", type: "planner" },
        { name: "Desenvolvimento", type: "developer" },
        { name: "Testes", type: "qa" },
        { name: "Finalização", type: "finalization" },
      ],
    });

    expect(run).toBeDefined();
    expect(run.title).toBe("Test Workflow");
    expect(run.prompt).toBe("Create a feature");
    expect(run.status).toBe("pending_approval");
    expect(run.id).toBeTruthy();
  });

  it("should create a pending approval when workflow is created", async () => {
    const api = createMockAPI();
    await api.workflows.create({
      title: "Approval Test",
      prompt: "Test approval",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    });

    const pending = await api.approvals.listPending();
    expect(pending.some((a) => a.title.includes("Approval Test"))).toBe(true);
  });

  it("should not start workflow until approved", async () => {
    const api = createMockAPI();
    const run = await api.workflows.create({
      title: "Pending Workflow",
      prompt: "Should stay pending",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    });

    const detail = await api.workflows.get(run.id);
    expect(detail.status).toBe("pending_approval");
  });

  it("should start workflow after approval", async () => {
    const api = createMockAPI();
    const run = await api.workflows.create({
      title: "To Approve",
      prompt: "Approve me",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    });

    // Find and approve
    const approvals = await api.approvals.list();
    const approval = approvals.find((a) => a.workflowRunId === run.id);
    expect(approval).toBeDefined();

    await api.approvals.approve(approval!.id);

    // Wait for simulation
    await new Promise((r) => setTimeout(r, 2000));

    const detail = await api.workflows.get(run.id);
    expect(detail.status).toBe("completed");
  });

  it("should reject workflow when approval is rejected", async () => {
    const api = createMockAPI();
    const run = await api.workflows.create({
      title: "To Reject",
      prompt: "Reject me",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    });

    const approvals = await api.approvals.list();
    const approval = approvals.find((a) => a.workflowRunId === run.id);

    await api.approvals.reject(approval!.id);

    const detail = await api.workflows.get(run.id);
    expect(detail.status).toBe("rejected");
  });
});
