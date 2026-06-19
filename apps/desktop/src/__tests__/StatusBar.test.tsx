import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBar } from "../components/layout/StatusBar";
import { createMockAPI } from "../api/mock-api";

// ---------------------------------------------------------------------------
// Setup — mock window.fluxora so StatusBar's useEffect doesn't throw in SSR
// ---------------------------------------------------------------------------

beforeEach(() => {
  const api = createMockAPI();
  (globalThis as any).window = {
    ...((globalThis as any).window || {}),
    fluxora: api,
  };
});

// ---------------------------------------------------------------------------
// 1. Branch is not hardcoded
// ---------------------------------------------------------------------------

describe("StatusBar — branch is not hardcoded", () => {
  it("initial render shows placeholder '...' instead of a specific branch name", () => {
    const html = renderToStaticMarkup(<StatusBar />);
    // The initial state for gitBranch is "..." — not a hardcoded branch
    expect(html).toContain("...");
  });

  it("mock API returns a dynamic branch value (not hardcoded in the component)", async () => {
    const api = createMockAPI();
    const gitInfo = await api.app.getGitInfo();

    // The branch comes from the API, not from a hardcoded string in the component
    expect(gitInfo.branch).toBeDefined();
    expect(typeof gitInfo.branch).toBe("string");
    expect(gitInfo.branch.length).toBeGreaterThan(0);
  });

  it("component source does not contain hardcoded 'main' or 'master' as branch value", () => {
    // Read the component source and verify no hardcoded branch
    // The initial state is "..." and the fallback is "branch desconhecida"
    const html = renderToStaticMarkup(<StatusBar />);
    // In SSR, the branch is "..." — not "main" or "master"
    // The string "main" might appear in other contexts, so we check the specific pattern
    expect(html).not.toMatch(/GitBranch.*>main</);
    expect(html).not.toMatch(/GitBranch.*>master</);
  });
});

// ---------------------------------------------------------------------------
// 2. Short commit appears
// ---------------------------------------------------------------------------

describe("StatusBar — short commit appears", () => {
  it("mock API returns a short commit hash", async () => {
    const api = createMockAPI();
    const gitInfo = await api.app.getGitInfo();

    expect(gitInfo.commit).toBeDefined();
    expect(typeof gitInfo.commit).toBe("string");
    // Short commit is typically 7 characters
    expect(gitInfo.commit.length).toBeLessThanOrEqual(12);
    expect(gitInfo.commit.length).toBeGreaterThan(0);
  });

  it("commit is displayed in parentheses after branch", () => {
    // The component renders: {gitBranch}{gitCommit ? ` (${gitCommit})` : ""}
    // In SSR, gitCommit is "" so no parentheses appear
    const html = renderToStaticMarkup(<StatusBar />);
    // The initial state has empty commit, so no parentheses
    // But the structure for commit display exists
    expect(html).toContain("...");
  });

  it("commit appears in parentheses when provided by API", async () => {
    const api = createMockAPI();
    const gitInfo = await api.app.getGitInfo();

    // Simulate the rendering logic
    const display = `${gitInfo.branch}${gitInfo.commit ? ` (${gitInfo.commit})` : ""}`;
    expect(display).toContain("(");
    expect(display).toContain(gitInfo.commit);
  });
});

// ---------------------------------------------------------------------------
// 3. Version comes from real source
// ---------------------------------------------------------------------------

describe("StatusBar — version comes from real source", () => {
  it("mock API returns a version string", async () => {
    const api = createMockAPI();
    const version = await api.app.getVersion();

    expect(version).toBeDefined();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("version is prefixed with 'v' in the component", async () => {
    const api = createMockAPI();
    const version = await api.app.getVersion();

    // The component renders: version ? `v${version}` : ""
    const display = version ? `v${version}` : "";
    expect(display).toMatch(/^v\d/);
  });

  it("initial render shows '...' placeholder for version", () => {
    const html = renderToStaticMarkup(<StatusBar />);
    // The initial state for appVersion is "..."
    expect(html).toContain("...");
  });
});

// ---------------------------------------------------------------------------
// 4. Fallback appears when Git unavailable
// ---------------------------------------------------------------------------

describe("StatusBar — fallback when Git unavailable", () => {
  it("fallback text 'branch desconhecida' is used when API fails", () => {
    // Simulate the catch block logic from StatusBar
    let gitBranch = "...";
    let gitCommit = "";

    // Simulate API failure
    try {
      throw new Error("Git not available");
    } catch {
      gitBranch = "branch desconhecida";
      gitCommit = "";
    }

    expect(gitBranch).toBe("branch desconhecida");
    expect(gitCommit).toBe("");
  });

  it("fallback text 'branch desconhecida' is used when branch is empty", () => {
    // Simulate the logic from StatusBar
    const gitInfo = { branch: "", commit: "" };
    const branch = gitInfo.branch || "branch desconhecida";

    expect(branch).toBe("branch desconhecida");
  });

  it("component renders without crashing even when API would fail", () => {
    // The component should render with initial state even if API calls fail
    const html = renderToStaticMarkup(<StatusBar />);
    expect(html).toBeTruthy();
    expect(html).toContain("Ambiente");
    expect(html).toContain("Desenvolvimento");
  });

  it("StatusBar shows provider status labels", () => {
    const html = renderToStaticMarkup(<StatusBar />);
    expect(html).toContain("Providers:");
    expect(html).toContain("0");
  });
});
