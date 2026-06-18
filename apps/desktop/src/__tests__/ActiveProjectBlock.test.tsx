import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActiveProjectBlock } from "../components/overview/ActiveProjectBlock";
import type { Project } from "@fluxora/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fluxoraProject: Project = {
  id: "proj-fluxora",
  name: "Fluxora",
  path: "/home/pablo/projects/Fluxora",
  stack: ["TypeScript", "React"],
  status: "idle",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const projectNoGit: Project = {
  id: "proj-nogit",
  name: "NoGitProject",
  path: "/tmp/nogit",
  stack: ["Python"],
  status: "idle",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActiveProjectBlock", () => {
  it("shows project name and path when project is provided", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
      />,
    );
    expect(html).toContain("Fluxora");
    expect(html).toContain("/home/pablo/projects/Fluxora");
  });

  it("shows 'Nenhum projeto selecionado' when project is null", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={null}
        gitAvailable={null}
        opencodeStatus={null}
      />,
    );
    expect(html).toContain("Nenhum projeto selecionado");
    expect(html).toContain("Selecione um projeto antes de enviar uma missão.");
  });

  it("shows Git OK when gitAvailable is true", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
      />,
    );
    expect(html).toContain("Git OK");
  });

  it("shows 'Sem Git' when gitAvailable is false", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={false}
        opencodeStatus="detected"
      />,
    );
    expect(html).toContain("Sem Git");
  });

  it("shows 'OpenCode detectado' when opencodeStatus is detected", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
      />,
    );
    expect(html).toContain("OpenCode detectado");
  });

  it("shows 'OpenCode não detectado' when opencodeStatus is not_detected", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="not_detected"
      />,
    );
    expect(html).toContain("OpenCode não detectado");
  });

  it("shows branch when provided", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
        branch="feature/test"
      />,
    );
    expect(html).toContain("feature/test");
  });

  it("shows Trocar projeto button when onSwitchProject is provided", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
        onSwitchProject={() => {}}
      />,
    );
    expect(html).toContain("Trocar projeto");
  });

  it("shows Validar projeto button when onValidate is provided", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
        onValidate={() => {}}
      />,
    );
    expect(html).toContain("Validar projeto");
  });

  it("shows validation success message", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
        validationResult={{ valid: true }}
      />,
    );
    expect(html).toContain("Projeto validado com sucesso");
  });

  it("shows validation error message", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
        validationResult={{ valid: false, error: "Caminho não encontrado" }}
      />,
    );
    expect(html).toContain("Caminho não encontrado");
  });

  it("shows warning when git is not available", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={false}
        opencodeStatus="detected"
      />,
    );
    expect(html).toContain("não parece ser um repositório Git");
  });

  it("shows 'Selecionar projeto' button when no project and onSwitchProject provided", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={null}
        gitAvailable={null}
        opencodeStatus={null}
        onSwitchProject={() => {}}
      />,
    );
    expect(html).toContain("Selecionar projeto");
  });

  it("shows stack info", () => {
    const html = renderToStaticMarkup(
      <ActiveProjectBlock
        project={fluxoraProject}
        gitAvailable={true}
        opencodeStatus="detected"
      />,
    );
    expect(html).toContain("TypeScript, React");
  });
});
