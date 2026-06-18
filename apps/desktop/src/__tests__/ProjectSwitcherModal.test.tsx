import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSwitcherModal } from "../components/overview/ProjectSwitcherModal";
import type { Project } from "@fluxora/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const projects: Project[] = [
  {
    id: "proj-1",
    name: "Fluxora",
    path: "/home/pablo/projects/Fluxora",
    stack: ["TypeScript", "React"],
    status: "idle",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  },
  {
    id: "proj-2",
    name: "eBig Food API",
    path: "/projects/ebig-food-api",
    stack: ["Laravel", "PHP"],
    status: "idle",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectSwitcherModal", () => {
  it("renders project list when open", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={true}
        onClose={() => {}}
        projects={projects}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Fluxora");
    expect(html).toContain("eBig Food API");
  });

  it("shows ATUAL badge for current project", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={true}
        onClose={() => {}}
        projects={projects}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("ATUAL");
  });

  it("shows project paths", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={true}
        onClose={() => {}}
        projects={projects}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("/home/pablo/projects/Fluxora");
    expect(html).toContain("/projects/ebig-food-api");
  });

  it("shows empty state when no projects", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={true}
        onClose={() => {}}
        projects={[]}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Nenhum projeto cadastrado");
  });

  it("renders nothing when open is false", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={false}
        onClose={() => {}}
        projects={projects}
        onSelect={() => {}}
      />,
    );
    expect(html).not.toContain("Trocar projeto");
  });

  it("shows Git status when provided", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={true}
        onClose={() => {}}
        projects={projects}
        onSelect={() => {}}
        gitStatus={{ "proj-1": true, "proj-2": false }}
      />,
    );
    expect(html).toContain("Git");
    expect(html).toContain("Sem Git");
  });

  it("shows invalid status when validation fails", () => {
    const html = renderToStaticMarkup(
      <ProjectSwitcherModal
        open={true}
        onClose={() => {}}
        projects={projects}
        onSelect={() => {}}
        validationResults={{ "proj-2": { valid: false, error: "Path not found" } }}
      />,
    );
    expect(html).toContain("Inválido");
  });
});
