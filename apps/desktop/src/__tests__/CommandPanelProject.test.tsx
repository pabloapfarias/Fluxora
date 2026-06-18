import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPanel } from "../components/overview/CommandPanel";

// ---------------------------------------------------------------------------
// Tests — CommandPanel com props de projeto
// ---------------------------------------------------------------------------

describe("CommandPanel — project validation", () => {
  it("shows project blocker warning when projectBlocker is set", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        projectBlocker="Nenhum projeto selecionado. Selecione um projeto antes de enviar uma missão."
        projectValid={false}
      />,
    );
    expect(html).toContain("Nenhum projeto selecionado");
  });

  it("shows custom blocker message", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        projectBlocker="O caminho do projeto não existe ou não está acessível."
        projectValid={false}
      />,
    );
    expect(html).toContain("não existe ou não está acessível");
  });

  it("send button is disabled when projectValid is false", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        projectValid={false}
        projectBlocker="Nenhum projeto selecionado."
      />,
    );
    // The button should have disabled attribute
    expect(html).toMatch(/disabled/);
  });

  it("send button is disabled when text is empty even with valid project", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        projectValid={true}
      />,
    );
    // Default state: text is empty, so button is disabled
    expect(html).toMatch(/disabled/);
  });

  it("shows active project name in execution state when executing", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        isExecuting={true}
        activeProjectName="Fluxora"
        projectValid={true}
      />,
    );
    expect(html).toContain("Fluxora");
    expect(html).toContain("Executando missão...");
  });

  it("does not show blocker warning when projectValid is true", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        projectValid={true}
      />,
    );
    expect(html).not.toContain("Nenhum projeto selecionado");
    expect(html).not.toContain("não existe");
  });
});
