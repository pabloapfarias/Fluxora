import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStepOutputPanel } from "../AgentStepOutputPanel";

const outputs = [
  {
    id: "1",
    workflowRunId: "wf-1",
    projectId: "proj-1",
    agentRole: "planner",
    agentName: "Planner",
    prompt: "planeje",
    output: "Plano pronto",
    parsedOutput: '[{"type":"message"}]',
    status: "completed",
    startedAt: "2026-06-11T10:00:00.000Z",
    completedAt: "2026-06-11T10:00:02.000Z",
  },
  {
    id: "2",
    workflowRunId: "wf-1",
    projectId: "proj-1",
    agentRole: "backend-dev",
    agentName: "Backend Dev",
    prompt: "implemente",
    output: "Arquivos modificados: src/app.ts",
    parsedOutput: "[]",
    status: "completed",
    startedAt: "2026-06-11T10:00:03.000Z",
    completedAt: "2026-06-11T10:00:06.000Z",
  },
  {
    id: "3",
    workflowRunId: "wf-1",
    projectId: "proj-1",
    agentRole: "qa",
    agentName: "QA",
    prompt: "valide",
    output: "Status: aprovado",
    parsedOutput: "[]",
    status: "completed",
    startedAt: "2026-06-11T10:00:07.000Z",
    completedAt: "2026-06-11T10:00:08.000Z",
  },
] as any;

describe("AgentStepOutputPanel", () => {
  it("renderiza Planner, Developer e QA", () => {
    const html = renderToStaticMarkup(<AgentStepOutputPanel outputs={outputs} />);
    expect(html).toContain("Planner");
    expect(html).toContain("Backend Dev");
    expect(html).toContain("QA");
  });

  it("lida com output vazio", () => {
    const html = renderToStaticMarkup(<AgentStepOutputPanel outputs={[{ ...outputs[0], output: "" }]} />);
    expect(html).toContain("Planner");
  });

  it("mostra estado vazio", () => {
    const html = renderToStaticMarkup(<AgentStepOutputPanel outputs={[]} />);
    expect(html).toContain("Nenhuma saída de agente registrada");
  });
});
