import { describe, it, expect } from "vitest";
import type { CreateProjectInput, CreateWorkflowInput } from "../index";

// Validation functions to test
function validateProjectInput(input: CreateProjectInput): string[] {
  const errors: string[] = [];
  if (!input.name || input.name.trim().length === 0) {
    errors.push("Nome é obrigatório");
  }
  if (!input.path || input.path.trim().length === 0) {
    errors.push("Caminho é obrigatório");
  }
  if (!input.stack || input.stack.length === 0) {
    errors.push("Stack é obrigatória");
  }
  return errors;
}

function validateWorkflowInput(input: CreateWorkflowInput): string[] {
  const errors: string[] = [];
  if (!input.title || input.title.trim().length === 0) {
    errors.push("Título é obrigatório");
  }
  if (!input.prompt || input.prompt.trim().length === 0) {
    errors.push("Prompt é obrigatório");
  }
  if (!input.steps || input.steps.length === 0) {
    errors.push("Steps são obrigatórios");
  }
  if (input.generatedContext === undefined || input.generatedContext === null) {
    errors.push("Contexto gerado é obrigatório");
  }
  return errors;
}

function getInitialWorkflowStatus(): string {
  return "pending_approval";
}

describe("Project Validation", () => {
  it("should accept valid project input", () => {
    const input: CreateProjectInput = {
      name: "Test Project",
      path: "/projects/test",
      stack: ["TypeScript", "React"],
    };
    const errors = validateProjectInput(input);
    expect(errors).toHaveLength(0);
  });

  it("should reject project without name", () => {
    const input: CreateProjectInput = {
      name: "",
      path: "/projects/test",
      stack: ["TypeScript"],
    };
    const errors = validateProjectInput(input);
    expect(errors).toContain("Nome é obrigatório");
  });

  it("should reject project without path", () => {
    const input: CreateProjectInput = {
      name: "Test Project",
      path: "",
      stack: ["TypeScript"],
    };
    const errors = validateProjectInput(input);
    expect(errors).toContain("Caminho é obrigatório");
  });

  it("should reject project without stack", () => {
    const input: CreateProjectInput = {
      name: "Test Project",
      path: "/projects/test",
      stack: [],
    };
    const errors = validateProjectInput(input);
    expect(errors).toContain("Stack é obrigatória");
  });

  it("should reject project with whitespace-only name", () => {
    const input: CreateProjectInput = {
      name: "   ",
      path: "/projects/test",
      stack: ["TypeScript"],
    };
    const errors = validateProjectInput(input);
    expect(errors).toContain("Nome é obrigatório");
  });
});

describe("Workflow Validation", () => {
  it("should accept valid workflow input", () => {
    const input: CreateWorkflowInput = {
      title: "Test Workflow",
      prompt: "Create a new feature",
      generatedContext: '{"intent": "feature_request"}',
      steps: [
        { name: "Planejamento", type: "planner" },
        { name: "Desenvolvimento", type: "developer" },
      ],
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toHaveLength(0);
  });

  it("should reject workflow without title", () => {
    const input: CreateWorkflowInput = {
      title: "",
      prompt: "Create a new feature",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("Título é obrigatório");
  });

  it("should reject workflow without prompt", () => {
    const input: CreateWorkflowInput = {
      title: "Test Workflow",
      prompt: "",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("Prompt é obrigatório");
  });

  it("should reject workflow without steps", () => {
    const input: CreateWorkflowInput = {
      title: "Test Workflow",
      prompt: "Create a new feature",
      generatedContext: "{}",
      steps: [],
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("Steps são obrigatórios");
  });

  it("should reject workflow without generated context", () => {
    const input: CreateWorkflowInput = {
      title: "Test Workflow",
      prompt: "Create a new feature",
      generatedContext: undefined as any,
      steps: [{ name: "Step 1", type: "planner" }],
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("Contexto gerado é obrigatório");
  });
});

describe("Workflow Initial Status", () => {
  it("should have pending_approval as initial status", () => {
    const status = getInitialWorkflowStatus();
    expect(status).toBe("pending_approval");
  });

  it("should not have running as initial status", () => {
    const status = getInitialWorkflowStatus();
    expect(status).not.toBe("running");
  });

  it("should not have completed as initial status", () => {
    const status = getInitialWorkflowStatus();
    expect(status).not.toBe("completed");
  });
});
