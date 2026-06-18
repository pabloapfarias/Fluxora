import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Helpers — read source files for static analysis
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const cssContent = readFileSync(resolve(__dir, "../styles/globals.css"), "utf-8");
const tailwindContent = readFileSync(resolve(__dir, "../../tailwind.config.js"), "utf-8");

// ---------------------------------------------------------------------------
// 1. Theme tokens exist
// ---------------------------------------------------------------------------

describe("ThemeTokens — CSS custom properties exist", () => {
  it("defines --accent token", () => {
    expect(cssContent).toContain("--accent:");
  });

  it("defines --accent-hover token", () => {
    expect(cssContent).toContain("--accent-hover:");
  });

  it("defines --accent-soft token", () => {
    expect(cssContent).toContain("--accent-soft:");
  });

  it("defines --bg-card token for panels", () => {
    expect(cssContent).toContain("--bg-card:");
  });

  it("defines --bg-elevated token", () => {
    expect(cssContent).toContain("--bg-elevated:");
  });

  it("defines --bg-base token", () => {
    expect(cssContent).toContain("--bg-base:");
  });

  it("defines --text-primary token", () => {
    expect(cssContent).toContain("--text-primary:");
  });

  it("defines --success token", () => {
    expect(cssContent).toContain("--success:");
  });

  it("defines --warning token", () => {
    expect(cssContent).toContain("--warning:");
  });

  it("defines --danger token", () => {
    expect(cssContent).toContain("--danger:");
  });

  it("defines --border-subtle token", () => {
    expect(cssContent).toContain("--border-subtle:");
  });
});

// ---------------------------------------------------------------------------
// 2. Tailwind config has the right tokens
// ---------------------------------------------------------------------------

describe("ThemeTokens — Tailwind config tokens", () => {
  it("accent color is defined in tailwind config", () => {
    expect(tailwindContent).toContain("accent:");
  });

  it("accent DEFAULT is the red/coral color (#ff4d4d)", () => {
    expect(tailwindContent).toContain("#ff4d4d");
  });

  it("bg.card is defined for panel backgrounds", () => {
    expect(tailwindContent).toContain("card:");
  });

  it("bg.elevated is defined", () => {
    expect(tailwindContent).toContain("elevated:");
  });

  it("violet is defined as secondary accent", () => {
    expect(tailwindContent).toContain("violet:");
  });
});

// ---------------------------------------------------------------------------
// 3. Main buttons use new accent token
// ---------------------------------------------------------------------------

describe("ThemeTokens — main buttons use accent token", () => {
  it("flux-btn-primary uses --accent CSS variable", () => {
    expect(cssContent).toContain(".flux-btn-primary");
    // The button should reference the accent variable
    expect(cssContent).toMatch(/\.flux-btn-primary[\s\S]*?var\(--accent\)/);
  });

  it("flux-btn-primary hover uses --accent-hover", () => {
    expect(cssContent).toMatch(/\.flux-btn-primary:hover[\s\S]*?var\(--accent-hover\)/);
  });

  it("accent token value is red/coral, not purple", () => {
    // The accent should be #ff4d4d (red/coral), not a purple color
    const accentMatch = cssContent.match(/--accent:\s*(#[0-9a-fA-F]+)/);
    expect(accentMatch).toBeTruthy();
    expect(accentMatch![1]).toBe("#ff4d4d");
  });
});

// ---------------------------------------------------------------------------
// 4. Panels use cockpit token (bg-card)
// ---------------------------------------------------------------------------

describe("ThemeTokens — panels use cockpit token", () => {
  it("bg-card token is a dark blue/black color (cockpit style)", () => {
    const cardMatch = cssContent.match(/--bg-card:\s*(#[0-9a-fA-F]+)/);
    expect(cardMatch).toBeTruthy();
    // The card background should be a dark color (cockpit style)
    const hex = cardMatch![1];
    // Dark colors have low RGB values
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeLessThan(80);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(100);
  });

  it("bg-base is the darkest background (cockpit deep space)", () => {
    const baseMatch = cssContent.match(/--bg-base:\s*(#[0-9a-fA-F]+)/);
    expect(baseMatch).toBeTruthy();
    const hex = baseMatch![1];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Very dark — deep space blue/black
    expect(r).toBeLessThan(20);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(40);
  });

  it("flux-pill-accent uses accent-soft and accent tokens", () => {
    expect(cssContent).toMatch(/\.flux-pill-accent[\s\S]*?var\(--accent-soft\)/);
    expect(cssContent).toMatch(/\.flux-pill-accent[\s\S]*?var\(--accent\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. No old hardcoded purple colors scattered
// ---------------------------------------------------------------------------

describe("ThemeTokens — no old hardcoded purple colors", () => {
  // Common old purple colors that should NOT appear outside the theme definition
  const oldPurplePatterns = [
    /#7c3aed(?![0-9a-fA-F])/gi, // Tailwind violet-600
    /#8b5cf6(?![0-9a-fA-F])/gi, // Tailwind violet-500
    /#6d28d9(?![0-9a-fA-F])/gi, // Tailwind violet-700
    /#5b21b6(?![0-9a-fA-F])/gi, // Tailwind violet-800
  ];

  it("CSS file does not contain old hardcoded Tailwind purple colors", () => {
    for (const pattern of oldPurplePatterns) {
      const matches = cssContent.match(pattern);
      expect(matches).toBeNull();
    }
  });

  it("tailwind config uses violet as a named token, not scattered hex values", () => {
    // The violet color should be defined as a token, not scattered
    // The token value #7c5bf5 is acceptable (it's the defined violet token)
    expect(tailwindContent).toContain("#7c5bf5");
    // But old Tailwind purples should not appear
    for (const pattern of oldPurplePatterns) {
      const matches = tailwindContent.match(pattern);
      expect(matches).toBeNull();
    }
  });

  it("accent color is red/coral (#ff4d4d), not purple", () => {
    // Verify the primary accent is red/coral, not any shade of purple
    const accentMatch = cssContent.match(/--accent:\s*(#[0-9a-fA-F]+)/);
    expect(accentMatch).toBeTruthy();
    const hex = accentMatch![1].toLowerCase();
    // Red/coral colors have high red, lower green and blue
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // Not purple (purple has high red AND blue with much lower green)
    expect(g).toBeGreaterThan(b * 0.5);
  });
});
