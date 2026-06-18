import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenCodeDiagnosticPanel } from "../OpenCodeDiagnosticPanel";

const diagnostic = {
  status: "usable",
  severity: "success",
  binaryPath: "opencode",
  resolvedPath: "/home/pablo/.opencode/bin/opencode",
  version: "1.16.2",
  providersDetected: ["openrouter", "openai"],
  supportsRun: true,
  supportsFormatJson: true,
  supportsAgent: true,
  supportsModel: true,
  supportsDir: true,
  isCliUsable: true,
  isRunCommandAvailable: true,
  isSmokeTestBlocking: false,
  runSmokeTest: { attempted: true, success: true, stdout: '{"type":"text","text":"OK"}' },
  controlledRunTest: { attempted: true, success: true, exitCode: 0, changedFilesDetected: false, jsonEvents: [{ type: "text", text: "OK" }] },
  checks: [
    { name: "version", command: "opencode --version", success: true, exitCode: 0, durationMs: 3, severity: "info", interpretation: "ok", stdout: "1.16.2" },
    { name: "providers_list", command: "opencode providers list", success: true, exitCode: 0, durationMs: 5, severity: "info", interpretation: "Providers listados com sucesso.", stdout: "openrouter\nopenai" },
    { name: 'run_smoke_json', command: 'opencode run "Responda apenas: OK" --format json --dir /home/pablo/projects/Fluxora', success: true, exitCode: 0, durationMs: 10, severity: "info", interpretation: "OK", stdout: '{"type":"text","text":"OK"}' },
    { name: 'controlled_run_test', command: 'opencode run <controlled> --format json --dir /home/pablo/projects/Fluxora', success: true, exitCode: 0, durationMs: 11, severity: "info", interpretation: "O teste controlado respondeu com sucesso sem alterar arquivos.", stdout: '{"ok":true}' },
  ],
  environment: {
    platform: "linux",
    arch: "x64",
    cwd: "/home/pablo/projects/Fluxora",
    execPath: "/usr/bin/fluxora-v1",
    home: "/home/pablo",
    path: "/usr/bin:/bin",
    shell: "/bin/bash",
    resolvedBinaryPath: "/home/pablo/.opencode/bin/opencode",
  },
  recommendations: ["Compare PATH/HOME do Electron com o terminal."],
  checkedAt: "2026-06-12T00:00:00.000Z",
} as any;

describe("OpenCodeDiagnosticPanel", () => {
  it("mostra status OpenCode: Usavel", () => {
    const html = renderToStaticMarkup(
      <OpenCodeDiagnosticPanel diagnostic={diagnostic} running={false} onDetect={vi.fn()} onRun={vi.fn()} onRunJson={vi.fn()} onProviders={vi.fn()} onControlledRun={vi.fn()} onCopy={vi.fn()} />,
    );
    expect(html).toContain("OpenCode detectado e utilizável");
    expect(html).toContain("OpenCode: Usavel");
  });

  it("mostra ambiente do Electron", () => {
    const html = renderToStaticMarkup(
      <OpenCodeDiagnosticPanel diagnostic={diagnostic} running={false} onDetect={vi.fn()} onRun={vi.fn()} onRunJson={vi.fn()} onProviders={vi.fn()} onControlledRun={vi.fn()} onCopy={vi.fn()} />,
    );
    expect(html).toContain("PATH:");
    expect(html).toContain("HOME:");
    expect(html).toContain("resolvedBinaryPath");
  });

  it("mostra checks e botoes novos", () => {
    const html = renderToStaticMarkup(
      <OpenCodeDiagnosticPanel diagnostic={diagnostic} running={false} onDetect={vi.fn()} onRun={vi.fn()} onRunJson={vi.fn()} onProviders={vi.fn()} onControlledRun={vi.fn()} onCopy={vi.fn()} />,
    );
    expect(html).toContain("opencode --version");
    expect(html).toContain("opencode providers list");
    expect(html).toContain("Testar providers");
    expect(html).toContain("Executar teste controlado");
    expect(html).toContain("Providers detectados");
  });
});
