import { useState, useRef, useCallback } from "react";
import {
  Send,
  FlaskConical,
  Zap,
  Users,
  AlertTriangle,
  FolderOpen,
  Eraser,
  ArrowRight,
  Cpu,
} from "lucide-react";
import {
  ActionButton,
  StatusBadge,
  ModeBadge,
  type ModeBadgeMode,
} from "../ui";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExecutionModeValue =
  | "simulated"
  | "real"
  | "multi_agent";

interface ModeOption {
  value: ExecutionModeValue;
  label: string;
  icon: typeof FlaskConical;
  badgeMode: ModeBadgeMode;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "simulated", label: "Simulado", icon: FlaskConical, badgeMode: "simulated" },
  { value: "real", label: "Real", icon: Zap, badgeMode: "real" },
  { value: "multi_agent", label: "Multiagente", icon: Users, badgeMode: "multiagent" },
];

function formatDeveloperRole(role: string): string {
  if (role === "backend-dev") return "Backend Dev";
  if (role === "frontend-dev") return "Frontend Dev";
  if (role === "mobile-dev") return "Mobile Dev";
  if (role.startsWith("custom:")) {
    return role.slice("custom:".length).replace(/[-_]/g, " ");
  }
  return role;
}

export interface CommandPanelProps {
  onSubmit?: (text: string) => void;
  placeholder?: string;
  isExecuting?: boolean;
  /** Modo de execução atual — se fornecido, exibe o seletor integrado. */
  executionMode?: ExecutionModeValue;
  /** Callback quando o usuário troca o modo. */
  onModeChange?: (mode: ExecutionModeValue) => void;
  /** Nome do projeto ativo — exibido acima do input */
  activeProjectName?: string;
  /** Caminho do projeto ativo */
  activeProjectPath?: string;
  /** Se o projeto é válido para executar missões */
  projectValid?: boolean;
  /** Mensagem de bloqueio quando projeto não é válido */
  projectBlocker?: string;
  /** Se o checkbox "limpar logs ao iniciar" está marcado. */
  clearLogsOnNewMission?: boolean;
  /** Callback quando o usuário alterna o checkbox. */
  onClearLogsOnNewMissionChange?: (next: boolean) => void;
  /** Callback opcional para abrir diagnóstico detalhado da missão. */
  onRequestDiagnostics?: () => void;
  /** Texto controlado do input (opcional). */
  text?: string;
  /** Callback para mudança controlada do texto. */
  onTextChange?: (next: string) => void;
  /** Recomendação automática de developer para o projeto ativo. */
  developerRecommendation?: {
    role: string;
    stackLabel: string;
    agentName?: string;
    ready: boolean;
  } | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CommandPanel({
  onSubmit,
  placeholder = "Digite uma missão ou converse com o Orquestrador...",
  isExecuting = false,
  executionMode,
  onModeChange,
  activeProjectName,
  activeProjectPath,
  projectValid = true,
  projectBlocker,
  clearLogsOnNewMission = false,
  onClearLogsOnNewMissionChange,
  onRequestDiagnostics,
  text: controlledText,
  onTextChange,
  developerRecommendation,
}: CommandPanelProps) {
  const [internalText, setInternalText] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const text = controlledText !== undefined ? controlledText : internalText;
  const setText = (next: string) => {
    if (controlledText !== undefined && onTextChange) {
      onTextChange(next);
      return;
    }
    setInternalText(next);
  };

  const handle = useCallback(() => {
    if (!text.trim() || isExecuting) return;
    onSubmit?.(text);
    setText("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, isExecuting, onSubmit]);

  const showModeSelector = executionMode !== undefined && onModeChange !== undefined;
  const activeModeOption = MODE_OPTIONS.find((o) => o.value === executionMode);

  return (
    <div
      className={`flux-command-console overflow-hidden transition-shadow duration-300 ${
        focused
          ? "shadow-[0_0_0_1px_rgba(124,91,245,0.35),0_0_32px_-6px_rgba(124,91,245,0.3),inset_0_1px_0_0_rgba(255,255,255,0.04)]"
          : "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
      } ${isExecuting ? "border-accent/25" : ""}`}
    >
      {/* ─── Input area ─── */}
      <div className="px-6 pt-5 pb-4">
        {/* Execution state indicator */}
        {isExecuting && (
          <div className="flex items-center gap-2.5 mb-3">
            <StatusBadge status="running" size="sm" label="Executando missão..." />
            {activeModeOption && (
              <ModeBadge mode={activeModeOption.badgeMode} size="sm" />
            )}
            {activeProjectName && (
              <span className="text-[11px] text-text-muted flex items-center gap-1.5">
                <FolderOpen size={11} />
                {activeProjectName}
              </span>
            )}
          </div>
        )}

        {/* Project blocker warning */}
        {projectBlocker && !isExecuting && (
          <div className="flex items-start gap-2.5 mb-3 px-3 py-2.5 rounded-lg border border-warning/30 bg-warning-soft/10">
            <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-[12px] text-text-secondary block">{projectBlocker}</span>
              {onRequestDiagnostics && (
                <button
                  type="button"
                  onClick={onRequestDiagnostics}
                  className="no-drag mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-accent hover:text-accent-hover font-medium"
                >
                  Ver diagnóstico detalhado
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Developer recommendation chip */}
        {developerRecommendation && !isExecuting && (
          <div className="mb-3 flex items-center gap-2 text-[11.5px] text-text-muted">
            <Cpu size={12} className="text-accent" />
            <span>
              Recomendado para este projeto ({developerRecommendation.stackLabel}):
              <span className="ml-1 text-text-primary font-medium">
                {developerRecommendation.agentName || formatDeveloperRole(developerRecommendation.role)}
              </span>
              {developerRecommendation.agentName && (
                <span
                  className={`ml-2 text-[10.5px] font-semibold ${
                    developerRecommendation.ready ? "text-success" : "text-warning"
                  }`}
                >
                  {developerRecommendation.ready ? "pronto" : "pendente"}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="flex items-end gap-4">
          <div className="flex-1 relative min-w-0">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handle();
                }
              }}
              placeholder={placeholder}
              rows={1}
              aria-label="Campo de comando"
              className="no-drag w-full bg-transparent text-[15px] text-text-primary placeholder:text-text-muted outline-none resize-none min-h-[48px] max-h-[160px] leading-[24px] py-3"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
              }}
            />
          </div>
          <ActionButton
            variant="primary"
            size="lg"
            icon={isExecuting ? undefined : <Send size={16} />}
            loading={isExecuting}
            loadingLabel="Executando missão"
            disabled={!text.trim() || isExecuting || !projectValid}
            onClick={handle}
            className="flex-shrink-0"
          >
            {isExecuting ? "Executando..." : "Enviar"}
          </ActionButton>
        </div>
      </div>

      {/* ─── Mode selector bar ─── */}
      {showModeSelector && (
        <div className="px-6 py-3.5 flex items-center justify-between gap-4 flex-wrap border-t border-border-subtle bg-bg-deep/30">
          <div className="flex items-center gap-2.5 text-[12px] text-text-muted">
            <FlaskConical size={14} className="text-accent/70" />
            <span className="font-semibold tracking-wide">Modo de Execução</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {onClearLogsOnNewMissionChange && (
              <label
                className="no-drag flex items-center gap-2 cursor-pointer select-none px-2.5 h-10 rounded-md border border-border-subtle bg-bg-input/60 text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
                title="Limpar logs e timeline antes de iniciar uma nova missão"
              >
                <Eraser size={12} className={clearLogsOnNewMission ? "text-accent" : "text-text-muted"} />
                <input
                  type="checkbox"
                  className="no-drag w-3.5 h-3.5 rounded border-border-subtle bg-bg-base text-accent focus:ring-accent focus:ring-offset-0 focus:ring-1 cursor-pointer"
                  checked={clearLogsOnNewMission}
                  onChange={(e) => onClearLogsOnNewMissionChange(e.target.checked)}
                  aria-label="Limpar logs e timeline ao iniciar nova missão"
                />
                <span className="text-[11.5px] font-medium whitespace-nowrap">
                  Limpar logs ao iniciar
                </span>
              </label>
            )}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = executionMode === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => onModeChange(option.value)}
                    aria-pressed={isActive}
                    className={`no-drag px-4 h-10 text-[12px] font-medium flex items-center gap-2 transition-all ${
                      isActive
                        ? "bg-accent text-white shadow-[0_0_16px_-4px_rgba(124,91,245,0.5)]"
                        : "bg-bg-input text-text-secondary hover:text-text-primary hover:bg-bg-card-hover"
                    }`}
                  >
                    <Icon size={13} /> {option.label}
                    {option.value === "multi_agent" && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-warning/20 text-warning font-bold">EXP</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
