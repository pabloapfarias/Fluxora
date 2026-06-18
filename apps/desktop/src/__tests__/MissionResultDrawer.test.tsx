import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MissionResultDrawer } from "../components/overview/MissionResultDrawer";
import type { WorkflowRun } from "@fluxora/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const completedRun: WorkflowRun = {
  id: "wf-1",
  projectId: "proj-1",
  title: "Implementar cupom de desconto",
  prompt: "Criar cupom",
  status: "completed",
  executionMode: "real",
  createdAt: "2026-06-14T10:00:00.000Z",
  updatedAt: "2026-06-14T10:05:00.000Z",
  completedAt: "2026-06-14T10:05:00.000Z",
};

const failedRun: WorkflowRun = {
  ...completedRun,
  id: "wf-2",
  status: "failed",
};

const resultText = `# Relatório de Reconhecimento do Projeto

## 1. Visão geral do projeto
Fluxora é um aplicativo desktop Electron + React + TypeScript.

## 2. Tecnologias detectadas
- Stack: TypeScript, React
- Framework: Electron
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MissionResultDrawer", () => {
  it("shows result text when open", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
          projectName="Fluxora"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Relatório de Reconhecimento");
    expect(html).toContain("Fluxora é um aplicativo desktop");
  });

  it("shows 'Nenhum resultado disponível' when resultText is null", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={null}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Nenhum resultado disponível");
  });

  it("shows error message when isError is true", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={null}
          run={failedRun}
          isError={true}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("A execução falhou");
  });

  it("shows run title", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Implementar cupom de desconto");
  });

  it("shows project name", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
          projectName="Fluxora"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Fluxora");
  });

  it("shows Copiar button when resultText is provided", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Copiar");
  });

  it("shows Fechar button", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Fechar");
  });

  it("shows Abrir detalhes button when run has id", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Abrir detalhes");
  });

  it("shows execution date", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={true}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Executado em");
  });

  it("renders nothing when open is false", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MissionResultDrawer
          open={false}
          onClose={() => {}}
          resultText={resultText}
          run={completedRun}
        />
      </MemoryRouter>,
    );
    // Modal should not render when open is false
    expect(html).not.toContain("Resultado da missão");
  });
});
