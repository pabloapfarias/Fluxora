import { describe, it, expect } from "vitest";
import {
  parseDiffForViewer,
  countAdditions,
  countDeletions,
  extractFilePathFromDiff,
} from "../DiffViewer";

describe("parseDiffForViewer", () => {
  it("retorna lista vazia para string vazia", () => {
    expect(parseDiffForViewer("")).toEqual([]);
  });

  it("classifica linhas adicionadas", () => {
    const lines = parseDiffForViewer("+++ b/x.ts\n@@ -1 +1 @@\n+nova")
    expect(lines.some((l) => l.type === "add" && l.text === "nova")).toBe(true)
  })

  it("classifica linhas removidas", () => {
    const lines = parseDiffForViewer("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-velha")
    expect(lines.some((l) => l.type === "del" && l.text === "velha")).toBe(true)
  })

  it("classifica linhas de contexto", () => {
    const lines = parseDiffForViewer("@@ -1 +1 @@\n ctx")
    expect(lines.some((l) => l.type === "ctx" && l.text === "ctx")).toBe(true)
  })

  it("processa hunk header", () => {
    const lines = parseDiffForViewer("@@ -10,3 +20,5 @@\n+added")
    expect(lines.some((l) => l.type === "meta" && l.text.startsWith("@@"))).toBe(true)
    // após o hunk @@ -10,3 +20,5 @@, a próxima linha + começa com newLineNo=20
    const added = lines.find((l) => l.type === "add")
    expect(added?.newLineNo).toBe(20)
  })

  it("lida com diff grande sem quebrar", () => {
    const big = "+a\n".repeat(5000)
    const lines = parseDiffForViewer(big)
    expect(lines.length).toBeGreaterThan(1000)
  })
})

describe("countAdditions/countDeletions", () => {
  it("conta corretamente", () => {
    const lines = parseDiffForViewer("+a\n-b\n+c\n-d\n e")
    expect(countAdditions(lines)).toBe(2)
    expect(countDeletions(lines)).toBe(2)
  })

  it("retorna 0 para diff vazio", () => {
    expect(countAdditions([])).toBe(0)
    expect(countDeletions([])).toBe(0)
  })
})

describe("extractFilePathFromDiff", () => {
  it("extrai path do header +++", () => {
    const diff = "--- a/foo.txt\n+++ b/foo.txt\n@@ -1 +1 @@"
    expect(extractFilePathFromDiff(diff)).toBe("foo.txt")
  })

  it("retorna undefined se não encontrar", () => {
    expect(extractFilePathFromDiff("nada aqui")).toBeUndefined()
  })
})
