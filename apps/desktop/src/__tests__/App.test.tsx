import { describe, it, expect } from "vitest";

describe("Fluxora Desktop", () => {
  it("should export shared types correctly", async () => {
    const shared = await import("@fluxora/shared");
    expect(shared).toBeDefined();
    expect(typeof shared).toBe("object");
  });
});
