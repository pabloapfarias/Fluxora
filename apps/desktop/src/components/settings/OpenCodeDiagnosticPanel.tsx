import type { OpenCodeDiagnosticCheck, OpenCodeDiagnosticResult } from "@fluxora/shared";

export function OpenCodeDiagnosticPanel({
  diagnostic,
  running,
  onDetect,
  onRun,
  onRunJson,
  onProviders,
  onControlledRun,
  onCopy,
}: {
  diagnostic: OpenCodeDiagnosticResult | null;
  running: boolean;
  onDetect: () => void;
  onRun: () => void;
  onRunJson: () => void;
  onProviders: () => void;
  onControlledRun: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-deep p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-text-primary">Diagnóstico do OpenCode</div>
          <div className="text-[11.5px] text-text-muted">Valida CLI, checks individuais e ambiente do Electron.</div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={onDetect} className="no-drag flux-btn-secondary h-8 text-[11px]" disabled={running}>Detectar instalação</button>
          <button onClick={onRun} className="no-drag flux-btn-secondary h-8 text-[11px]" disabled={running}>Testar run</button>
          <button onClick={onRunJson} className="no-drag flux-btn-secondary h-8 text-[11px]" disabled={running}>Testar run JSON</button>
          <button onClick={onProviders} className="no-drag flux-btn-secondary h-8 text-[11px]" disabled={running}>Testar providers</button>
          <button onClick={onControlledRun} className="no-drag flux-btn-secondary h-8 text-[11px]" disabled={running}>Executar teste controlado</button>
          <button onClick={onCopy} className="no-drag flux-btn-ghost h-8 text-[11px]">Copiar diagnóstico</button>
        </div>
      </div>

      {diagnostic && (
        <>
          <div className={`rounded-lg border p-3 text-[12px] ${toneBox(diagnostic.severity)}`}>
            <div className="font-medium mb-1">Status geral</div>
            <div>{summaryLabel(diagnostic)}</div>
            <div className="mt-2 text-[11.5px]">OpenCode: {diagnostic.status === "usable" ? "Usavel" : diagnostic.status}</div>
            {diagnostic.status === "session_warning" && (
              <div className="mt-2 text-[11.5px]">
                Atenção: o OpenCode foi detectado e o comando run existe, mas o smoke test retornou "Session not found". Isso não significa necessariamente que o OpenCode está quebrado.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <DiagnosticCard label="CLI" value={diagnostic.isCliUsable ? "Utilizável" : "Indisponível"} />
            <DiagnosticCard label="run" value={diagnostic.isRunCommandAvailable ? "Disponível" : "Indisponível"} />
            <DiagnosticCard label="Smoke test" value={diagnostic.runSmokeTest?.attempted ? (diagnostic.runSmokeTest.success ? "Passou" : "Falhou") : "Não executado"} />
            <DiagnosticCard label="Blocking" value={diagnostic.isSmokeTestBlocking ? "Sim" : "Não"} />
            <DiagnosticCard label="Versão" value={diagnostic.version || "—"} />
            <DiagnosticCard label="Binary" value={diagnostic.resolvedPath || diagnostic.binaryPath} />
            <DiagnosticCard label="Run JSON" value={findCheck(diagnostic, "run_smoke_json")?.success ? "Sucesso" : "—"} />
            <DiagnosticCard label="Providers list" value={findCheck(diagnostic, "providers_list")?.success ? "Sucesso" : findCheck(diagnostic, "providers_ls")?.success ? "Sucesso (ls)" : "Warning"} />
            <DiagnosticCard label="Providers detectados" value={diagnostic.providersDetected?.join(", ") || "—"} />
            <DiagnosticCard label="Teste controlado" value={diagnostic.controlledRunTest?.attempted ? (diagnostic.controlledRunTest.success ? "Sucesso" : "Falhou") : "Não executado"} />
          </div>

          {diagnostic.controlledRunTest && (
            <div className={`rounded-lg border p-3 text-[12px] ${diagnostic.controlledRunTest.changedFilesDetected ? "border-error/30 bg-error/10 text-text-secondary" : "border-success/30 bg-success-soft/20 text-text-secondary"}`}>
              <div className="font-medium text-text-primary mb-2">Resultado do teste controlado</div>
              <div>Exit code: {diagnostic.controlledRunTest.exitCode ?? "—"}</div>
              <div>Arquivos alterados detectados: {diagnostic.controlledRunTest.changedFilesDetected ? "Sim" : "Nao"}</div>
              {diagnostic.controlledRunTest.changedFilesDetected && (
                <div className="mt-2">Atenção: o teste controlado não deveria alterar arquivos, mas alterações foram detectadas.</div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">Checks</div>
            <div className="space-y-2">
              {diagnostic.checks.map((check) => <CheckRow key={check.name} check={check} />)}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">Ambiente detectado pelo Fluxora</div>
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-text-secondary">{formatEnvironment(diagnostic)}</pre>
          </div>

          <div className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">Comparar com o terminal</div>
            <pre className="font-mono text-[11px] whitespace-pre-wrap text-text-secondary">{`which opencode
echo $PATH
echo $HOME
opencode --version
opencode run --help
opencode providers list`}</pre>
          </div>

          <div className="rounded-lg border border-warning/30 bg-warning-soft/20 p-3 text-[12px] text-text-secondary">
            <div className="font-medium text-text-primary mb-2">Recomendações</div>
            <div className="space-y-1">
              {diagnostic.recommendations.map((item, index) => (
                <div key={`${item}-${index}`}>{index + 1}. {item}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: OpenCodeDiagnosticCheck }) {
  return (
    <div className="rounded-md border border-border bg-bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-text-primary">{iconFor(check)} {check.command}</div>
        <div className="flex items-center gap-2">
          <div className="text-[10.5px] text-text-muted">{check.success ? "sucesso" : check.severity}</div>
          <div className="text-[10.5px] text-text-muted">exit {check.exitCode ?? "—"}</div>
          <div className="text-[10.5px] text-text-muted">{check.durationMs ? `${check.durationMs}ms` : "—"}</div>
          <button
            onClick={() => void copyCheck(check)}
            className="no-drag text-[10.5px] text-text-secondary hover:text-text-primary"
          >
            Copiar
          </button>
        </div>
      </div>
      <div className="text-[11px] text-text-muted mt-1">{check.interpretation}</div>
      {(check.stdout || check.stderr) && (
        <pre className="mt-2 rounded border border-border bg-bg-deep p-2 font-mono text-[10.5px] whitespace-pre-wrap break-all text-text-secondary max-h-32 overflow-auto">{(check.stdout || check.stderr || "").slice(0, 600)}</pre>
      )}
    </div>
  );
}

async function copyCheck(check: OpenCodeDiagnosticCheck) {
  const payload = JSON.stringify(check, null, 2);
  await navigator.clipboard?.writeText(payload);
}

function iconFor(check: OpenCodeDiagnosticCheck) {
  if (check.success) return "OK";
  if (check.severity === "error") return "ERRO";
  if (check.severity === "warning") return "WARN";
  return "INFO";
}

function summaryLabel(diagnostic: OpenCodeDiagnosticResult) {
  switch (diagnostic.status) {
    case "usable":
      return "OpenCode detectado e utilizável.";
    case "session_warning":
      return "OpenCode detectado com avisos. CLI disponível; smoke test falhou com Session not found.";
    case "environment_mismatch":
      return "OpenCode detectado com possível diferença de ambiente entre Electron e terminal.";
    case "smoke_test_failed":
      return "OpenCode detectado, mas o smoke test falhou no ambiente atual do Fluxora.";
    case "not_installed":
      return "OpenCode não encontrado.";
    default:
      return `Status: ${diagnostic.status}`;
  }
}

function findCheck(diagnostic: OpenCodeDiagnosticResult, name: string) {
  return diagnostic.checks.find((check) => check.name === name);
}

function toneBox(severity: OpenCodeDiagnosticResult["severity"]) {
  if (severity === "error") return "border-error/30 bg-error/10 text-text-secondary";
  if (severity === "warning") return "border-warning/30 bg-warning-soft/20 text-text-secondary";
  return "border-success/30 bg-success-soft/20 text-text-secondary";
}

function formatEnvironment(diagnostic: OpenCodeDiagnosticResult) {
  return [
    `binaryPath: ${diagnostic.binaryPath}`,
    `resolvedBinaryPath: ${diagnostic.environment.resolvedBinaryPath || diagnostic.resolvedPath || "—"}`,
    `PATH: ${diagnostic.environment.path || "—"}`,
    `HOME: ${diagnostic.environment.home || "—"}`,
    `SHELL: ${diagnostic.environment.shell || "—"}`,
    `cwd: ${diagnostic.environment.cwd}`,
    `execPath: ${diagnostic.environment.execPath}`,
    `platform: ${diagnostic.environment.platform}`,
    `arch: ${diagnostic.environment.arch}`,
  ].join("\n");
}

function DiagnosticCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-input/40 p-3">
      <div className="text-[10.5px] text-text-muted mb-1">{label}</div>
      <div className="text-[12.5px] text-text-primary font-medium break-all">{value}</div>
    </div>
  );
}
