import { describe, expect, it, vi } from "vitest";
import {
  appendSyntheticEvent,
  approvalTone,
  buildControlledExecutionReport,
  findControlledProject,
  mapApprovalState,
  mapWorkflowStatus,
  statusTone,
} from "../ControlledExecutionPanel";
import type { ControlledExecutionRunResult, WorkflowEvent } from "@fluxora/shared";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeRunResult(overrides: Partial<ControlledExecutionRunResult> = {}): ControlledExecutionRunResult {
  return {
    status: "completed",
    workflowRunId: "wf-123",
    projectId: "proj-1",
    projectRoot: "/tmp/fluxora",
    projectPath: "/tmp/fluxora/tmp/controlled-execution-sandbox",
    sandboxReadmePath: "/tmp/fluxora/tmp/controlled-execution-sandbox/README_CONTROLLED_TEST.md",
    changedFiles: [
      { path: "tmp/controlled-execution-sandbox/README_CONTROLLED_TEST.md", status: "modified", additions: 1, deletions: 1 },
    ],
    outOfScopeFiles: [],
    finalApprovalId: "appr-1",
    ...overrides,
  };
}

function makeEvents(list: Partial<WorkflowEvent>[] = []): WorkflowEvent[] {
  if (list.length === 0) {
    return [
      { id: "evt-1", workflowRunId: "wf-123", type: "controlled_execution.completed", message: "ok", createdAt: "2026-06-14T00:00:00.000Z" },
    ];
  }
  return list.map((e, i) => ({
    id: `evt-${i}`,
    workflowRunId: "wf-123",
    type: "unknown",
    message: "",
    createdAt: "2026-06-14T00:00:00.000Z",
    ...e,
  })) as WorkflowEvent[];
}

// ---------------------------------------------------------------------------
// findControlledProject
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — findControlledProject", () => {
  it("encontra o projeto Fluxora pelo nome, independente do path", () => {
    expect(findControlledProject([
      { id: "1", name: "Outro", path: "/tmp/outro", stack: [], status: "idle", createdAt: "", updatedAt: "" },
      { id: "2", name: "Fluxora", path: "/qualquer/caminho", stack: [], status: "idle", createdAt: "", updatedAt: "" },
    ] as any)?.id).toBe("2");
  });

  it("não encontra projeto quando o nome não corresponde, mesmo que o path exista", () => {
    expect(findControlledProject([
      { id: "1", name: "Outro", path: "/home/pablo/projects/Fluxora", stack: [], status: "idle", createdAt: "", updatedAt: "" },
    ] as any)).toBeNull();
  });

  it("encontra independente de maiúsculas/minúsculas", () => {
    expect(findControlledProject([
      { id: "1", name: "fluxora", path: "/tmp/x", stack: [], status: "idle", createdAt: "", updatedAt: "" },
    ] as any)?.id).toBe("1");
  });

  it("encontra com espaços ao redor do nome", () => {
    expect(findControlledProject([
      { id: "1", name: "  Fluxora  ", path: "/tmp/x", stack: [], status: "idle", createdAt: "", updatedAt: "" },
    ] as any)?.id).toBe("1");
  });

  it("retorna null para lista vazia", () => {
    expect(findControlledProject([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildControlledExecutionReport
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — buildControlledExecutionReport", () => {
  it("gera relatório textual com resumo obrigatório", () => {
    const report = buildControlledExecutionReport({
      status: "concluído",
      approvalState: "pendente",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: false,
      runResult: makeRunResult(),
      events: makeEvents(),
    });

    expect(report).toContain("Projeto: Fluxora");
    expect(report).toContain("Sandbox: tmp/controlled-execution-sandbox");
    expect(report).toContain("OpenCode: usable");
    expect(report).toContain("Arquivos alterados: 1");
  });

  it("inclui status, sandbox, diff resumido e aprovação", () => {
    const report = buildControlledExecutionReport({
      status: "concluído",
      approvalState: "aprovada",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: false,
      runResult: makeRunResult(),
      events: makeEvents(),
    });

    expect(report).toContain("Status: concluído");
    expect(report).toContain("Sandbox: tmp/controlled-execution-sandbox");
    expect(report).toContain("Aprovação: aprovada");
    expect(report).toContain("Diff resumido:");
    expect(report).toContain("README_CONTROLLED_TEST.md");
    expect(report).toContain("+1/-1");
  });

  it("não contém caminhos internos sensíveis do runResult no relatório", () => {
    const report = buildControlledExecutionReport({
      status: "concluído",
      approvalState: "pendente",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: false,
      runResult: makeRunResult({
        projectRoot: "/home/pablo/.ssh/secret-key",
        projectPath: "/home/pablo/.env",
      }),
      events: makeEvents([
        { type: "controlled_execution.completed", message: "concluído com sucesso" },
      ]),
    });

    // Internal paths from runResult should not leak into the report
    expect(report).not.toContain("/home/pablo/.ssh");
    expect(report).not.toContain("/home/pablo/.env");
    // The report should only reference the controlled sandbox path
    expect(report).toContain("Sandbox: tmp/controlled-execution-sandbox");
  });

  it("exibe 'Nenhuma alteração registrada' quando não há arquivos alterados", () => {
    const report = buildControlledExecutionReport({
      status: "aguardando",
      approvalState: "pendente",
      workflowRunId: null,
      hasOutOfScopeChanges: false,
      runResult: null,
      events: [],
    });

    expect(report).toContain("Nenhuma alteração registrada");
    expect(report).toContain("Arquivos alterados: 0");
    expect(report).toContain("Nenhum evento registrado");
  });

  it("indica alterações fora do escopo quando hasOutOfScopeChanges é true", () => {
    const report = buildControlledExecutionReport({
      status: "concluído",
      approvalState: "pendente",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: true,
      runResult: makeRunResult({ outOfScopeFiles: ["src/secret.ts", "config.env"] }),
      events: makeEvents(),
    });

    expect(report).toContain("Alterações fora do escopo: Sim (2 arquivo(s))");
  });

  it("indica 'Não' para fora do escopo quando não há alterações fora", () => {
    const report = buildControlledExecutionReport({
      status: "concluído",
      approvalState: "pendente",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: false,
      runResult: makeRunResult(),
      events: makeEvents(),
    });

    expect(report).toContain("Alterações fora do escopo: Não");
  });

  it("filtra eventos ruidosos (stdout/stderr/json_event) do resumo", () => {
    const report = buildControlledExecutionReport({
      status: "rodando",
      approvalState: "pendente",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: false,
      runResult: null,
      events: makeEvents([
        { type: "opencode.stdout", message: "raw stdout output" },
        { type: "opencode.stderr", message: "raw stderr output" },
        { type: "opencode.json_event", message: '{"type":"text"}' },
        { type: "controlled_execution.started", message: "iniciado" },
      ]),
    });

    // The noisy events should not appear in the event summary
    expect(report).not.toContain("raw stdout output");
    expect(report).not.toContain("raw stderr output");
    // But the meaningful event should appear
    expect(report).toContain("iniciado");
    // Total count should still be 4
    expect(report).toContain("Eventos: 4");
    // But relevant count should be 1
    expect(report).toContain("1 relevantes");
  });

  it("calcula totais de adições e deleções no diff resumido", () => {
    const report = buildControlledExecutionReport({
      status: "concluído",
      approvalState: "pendente",
      workflowRunId: "wf-123",
      hasOutOfScopeChanges: false,
      runResult: makeRunResult({
        changedFiles: [
          { path: "a.ts", status: "added", additions: 10, deletions: 0 },
          { path: "b.ts", status: "modified", additions: 5, deletions: 3 },
        ],
      }),
      events: makeEvents(),
    });

    expect(report).toContain("Total: 2 arquivo(s), +15/-3");
  });
});

// ---------------------------------------------------------------------------
// appendSyntheticEvent
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — appendSyntheticEvent", () => {
  it("produz evento com shape válido e projectId", () => {
    const setter = vi.fn();
    appendSyntheticEvent("wf-1", "hello", "opencode.stdout", setter, "proj-1");

    expect(setter).toHaveBeenCalledTimes(1);
    const updater = setter.mock.calls[0][0];
    const produced: WorkflowEvent[] = updater([]);

    expect(produced).toHaveLength(1);
    expect(produced[0].workflowRunId).toBe("wf-1");
    expect(produced[0].projectId).toBe("proj-1");
    expect(produced[0].type).toBe("opencode.stdout");
    expect(produced[0].message).toBe("hello");
    expect(produced[0].id).toMatch(/^stream-opencode\.stdout-/);
    expect(produced[0].createdAt).toBeTruthy();
  });

  it("ignora mensagem vazia", () => {
    const setter = vi.fn();
    appendSyntheticEvent("wf-1", "   ", "opencode.stdout", setter);
    expect(setter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// mapWorkflowStatus
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — mapWorkflowStatus", () => {
  it("mapeia 'queued' para 'rodando'", () => {
    expect(mapWorkflowStatus("queued")).toBe("rodando");
  });

  it("mapeia 'running' para 'rodando'", () => {
    expect(mapWorkflowStatus("running")).toBe("rodando");
  });

  it("mapeia 'approved' para 'rodando'", () => {
    expect(mapWorkflowStatus("approved")).toBe("rodando");
  });

  it("mapeia 'pending_approval' para 'rodando'", () => {
    expect(mapWorkflowStatus("pending_approval")).toBe("rodando");
  });

  it("mapeia 'completed' para 'concluído'", () => {
    expect(mapWorkflowStatus("completed")).toBe("concluído");
  });

  it("mapeia 'failed' para 'falhou'", () => {
    expect(mapWorkflowStatus("failed")).toBe("falhou");
  });

  it("mapeia 'rejected' para 'falhou'", () => {
    expect(mapWorkflowStatus("rejected")).toBe("falhou");
  });

  it("mapeia 'cancelled' para 'falhou'", () => {
    expect(mapWorkflowStatus("cancelled")).toBe("falhou");
  });

  it("mapeia status desconhecido para 'aguardando'", () => {
    expect(mapWorkflowStatus("unknown_status")).toBe("aguardando");
  });

  it("mapeia string vazia para 'aguardando'", () => {
    expect(mapWorkflowStatus("")).toBe("aguardando");
  });
});

// ---------------------------------------------------------------------------
// mapApprovalState
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — mapApprovalState", () => {
  it("mapeia 'approved' para 'aprovada'", () => {
    expect(mapApprovalState("approved")).toBe("aprovada");
  });

  it("mapeia 'rejected' para 'rejeitada'", () => {
    expect(mapApprovalState("rejected")).toBe("rejeitada");
  });

  it("mapeia 'pending' para 'pendente'", () => {
    expect(mapApprovalState("pending")).toBe("pendente");
  });
});

// ---------------------------------------------------------------------------
// statusTone
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — statusTone", () => {
  it("retorna 'text-success' para 'concluído'", () => {
    expect(statusTone("concluído")).toBe("text-success");
  });

  it("retorna 'text-accent' para 'rodando'", () => {
    expect(statusTone("rodando")).toBe("text-accent");
  });

  it("retorna 'text-error' para 'falhou'", () => {
    expect(statusTone("falhou")).toBe("text-error");
  });

  it("retorna 'text-text-primary' para 'aguardando'", () => {
    expect(statusTone("aguardando")).toBe("text-text-primary");
  });
});

// ---------------------------------------------------------------------------
// approvalTone
// ---------------------------------------------------------------------------

describe("ControlledExecutionPanel — approvalTone", () => {
  it("retorna 'text-success' para 'aprovada'", () => {
    expect(approvalTone("aprovada")).toBe("text-success");
  });

  it("retorna 'text-error' para 'rejeitada'", () => {
    expect(approvalTone("rejeitada")).toBe("text-error");
  });

  it("retorna 'text-warning' para 'pendente'", () => {
    expect(approvalTone("pendente")).toBe("text-warning");
  });
});
