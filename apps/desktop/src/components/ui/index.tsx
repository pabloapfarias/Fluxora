/**
 * Fluxora UI Kit — componentes primitivos reutilizáveis do cockpit.
 *
 * Estes componentes são a base visual de toda a aplicação. Devem ser
 * usados em vez de composição inline com Tailwind para garantir
 * consistência, acessibilidade e identidade visual premium.
 *
 * Convenções:
 *  - Sempre expor `className` como prop extra para permitir ajustes pontuais.
 *  - Tipos discriminados são exportados (`StatusBadgeStatus`, etc.) para reuso
 *    em outras camadas (filtros, mocks, testes).
 *  - Ícones vêm do `lucide-react`. Não usar outras bibliotecas.
 *  - Cores seguem o token set de `globals.css`. Quando uma variante não
 *    tem um token dedicado, declaramos a paleta localmente com a mesma
 *    semântica (soft background, mid border, vivid text).
 */

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  FlaskConical,
  Loader2,
  Minus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { formatExecutionMode, formatExecutionStatus } from "../../lib/presentationLabels";

// ────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────────

export type StatusBadgeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "waiting_approval";

export type ModeBadgeMode = "real" | "simulated" | "multiagent" | "controlled";

export type ImpactBadgeImpact = "low" | "medium" | "high" | "critical";

export type BadgeSize = "sm" | "md";

export type ActionButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "success"
  | "danger";

export type ActionButtonSize = "sm" | "md" | "lg";

export type CardVariant = "default" | "elevated" | "interactive";

export type CardPadding = "sm" | "md" | "lg";

export type TrendDirection = "up" | "down" | "neutral";

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

type Tone = {
  /** classes para background, border e text */
  className: string;
  /** cor hex usada em ícones pontuais (tone=mono) */
  color?: string;
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "text-[10.5px] px-2 py-[2px] gap-1",
  md: "text-[11px] px-2.5 py-1 gap-1.5",
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatImpactLabel(impact: ImpactBadgeImpact): string {
  switch (impact) {
    case "low":
      return "Baixo";
    case "medium":
      return "Médio";
    case "high":
      return "Alto";
    case "critical":
      return "Crítico";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// StatusBadge
// ────────────────────────────────────────────────────────────────────────────

const STATUS_TONES: Record<StatusBadgeStatus, Tone> = {
  pending: {
    className:
      "bg-bg-input text-text-secondary border-border-subtle",
  },
  running: {
    className:
      "bg-accent/12 text-text-primary border-accent/35",
    color: "#ff4d4d",
  },
  completed: {
    className:
      "bg-success-soft text-success border-success/25",
    color: "#22c55e",
  },
  failed: {
    className:
      "bg-error-soft text-error border-error/25",
    color: "#ff4d4d",
  },
  rejected: {
    className:
      "bg-error-soft text-error border-error/25",
    color: "#ff4d4d",
  },
  waiting_approval: {
    className:
      "bg-warning-soft text-warning border-warning/30",
    color: "#f5a524",
  },
};

function statusIcon(status: StatusBadgeStatus): React.ReactNode {
  const iconSize = 12;
  switch (status) {
    case "pending":
      return <Circle size={iconSize} aria-hidden="true" />;
    case "running":
      return (
        <Loader2
          size={iconSize}
          className="animate-spin"
          aria-hidden="true"
        />
      );
    case "completed":
      return <CheckCircle2 size={iconSize} aria-hidden="true" />;
    case "failed":
      return <AlertTriangle size={iconSize} aria-hidden="true" />;
    case "rejected":
      return <XCircle size={iconSize} aria-hidden="true" />;
    case "waiting_approval":
      return <ShieldCheck size={iconSize} aria-hidden="true" />;
  }
}

export interface StatusBadgeProps {
  status: StatusBadgeStatus;
  size?: BadgeSize;
  className?: string;
  /** Oculta o ícone mantendo o texto. Útil em espaços muito compactos. */
  hideIcon?: boolean;
  /** Sobrescreve o texto padrão. Por padrão usa o `formatExecutionStatus`. */
  label?: string;
}

export function StatusBadge({
  status,
  size = "md",
  className,
  hideIcon = false,
  label,
}: StatusBadgeProps) {
  const tone = STATUS_TONES[status];
  return (
    <span
      role="status"
      aria-label={label ?? `Status: ${formatExecutionStatus(status)}`}
      className={cn(
        "inline-flex items-center rounded-md font-medium border whitespace-nowrap select-none",
        SIZE_CLASSES[size],
        tone.className,
        className,
      )}
    >
      {!hideIcon && statusIcon(status)}
      <span>{label ?? formatExecutionStatus(status)}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ModeBadge
// ────────────────────────────────────────────────────────────────────────────

const MODE_TONES: Record<ModeBadgeMode, Tone> = {
  real: {
    className:
      "bg-bg-elevated text-text-primary border-border-strong",
  },
  simulated: {
    className:
      "bg-accent/12 text-text-primary border-accent/30",
  },
  multiagent: {
    className:
      "bg-violet/10 text-violet border-violet/25",
  },
  controlled: {
    className:
      "bg-warning/12 text-text-primary border-warning/30",
  },
};

function modeIcon(mode: ModeBadgeMode): React.ReactNode {
  const iconSize = 12;
  switch (mode) {
    case "real":
      return <Zap size={iconSize} aria-hidden="true" />;
    case "simulated":
      return <FlaskConical size={iconSize} aria-hidden="true" />;
    case "multiagent":
      return <Users size={iconSize} aria-hidden="true" />;
    case "controlled":
      return <ShieldCheck size={iconSize} aria-hidden="true" />;
  }
}

export interface ModeBadgeProps {
  mode: ModeBadgeMode;
  size?: BadgeSize;
  className?: string;
  hideIcon?: boolean;
  label?: string;
}

export function ModeBadge({
  mode,
  size = "md",
  className,
  hideIcon = false,
  label,
}: ModeBadgeProps) {
  const tone = MODE_TONES[mode];
  return (
    <span
      aria-label={label ?? `Modo: ${formatExecutionMode(mode)}`}
      className={cn(
        "inline-flex items-center rounded-md font-medium border whitespace-nowrap select-none",
        SIZE_CLASSES[size],
        tone.className,
        className,
      )}
    >
      {!hideIcon && modeIcon(mode)}
      <span>{label ?? formatExecutionMode(mode)}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ImpactBadge
// ────────────────────────────────────────────────────────────────────────────

const IMPACT_TONES: Record<ImpactBadgeImpact, Tone> = {
  low: {
    className:
      "bg-success-soft text-success border-success/25",
  },
  medium: {
    className:
      "bg-warning-soft text-warning border-warning/25",
  },
  high: {
    // laranja — saturação entre amber e red para indicar "alto" sem
    // confundir com "crítico".
    className:
      "bg-[rgba(251,146,60,0.12)] text-[#fb923c] border-[rgba(251,146,60,0.28)]",
  },
  critical: {
    className:
      "bg-error-soft text-error border-error/30",
  },
};

export interface ImpactBadgeProps {
  impact: ImpactBadgeImpact;
  size?: BadgeSize;
  className?: string;
  label?: string;
  /** Anexa a palavra "impacto" ao rótulo (ex.: "Alto impacto"). */
  verbose?: boolean;
}

export function ImpactBadge({
  impact,
  size = "md",
  className,
  label,
  verbose = false,
}: ImpactBadgeProps) {
  const tone = IMPACT_TONES[impact];
  const text = label ?? (verbose ? `${formatImpactLabel(impact)} impacto` : formatImpactLabel(impact));
  return (
    <span
      aria-label={label ?? `Impacto: ${formatImpactLabel(impact)}`}
      className={cn(
        "inline-flex items-center rounded-md font-medium border whitespace-nowrap select-none uppercase tracking-wider",
        SIZE_CLASSES[size],
        tone.className,
        className,
      )}
    >
      <span>{text}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ActionButton
// ────────────────────────────────────────────────────────────────────────────

const ACTION_VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-[0_6px_18px_-8px_rgba(124,91,245,0.6)] hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent-ring",
  secondary:
    "bg-bg-input text-text-primary border border-border-subtle hover:bg-bg-card-hover hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent-ring",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-input focus-visible:ring-2 focus-visible:ring-accent-ring",
  success:
    "bg-success-soft text-success border border-success/30 hover:bg-success/20 focus-visible:ring-2 focus-visible:ring-success/40",
  danger:
    "bg-error-soft text-error border border-error/30 hover:bg-error/20 focus-visible:ring-2 focus-visible:ring-error/40",
};

const ACTION_SIZE_CLASSES: Record<ActionButtonSize, string> = {
  sm: "h-8 px-2.5 text-[12px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[12.5px] gap-2 rounded-lg",
  lg: "h-11 px-5 text-sm gap-2.5 rounded-lg",
};

export interface ActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  /** Posição do ícone em relação ao label. Default: antes. */
  iconPosition?: "start" | "end";
  /** Texto acessível para leitores de tela enquanto `loading`. */
  loadingLabel?: string;
}

export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton(
    {
      variant = "primary",
      size = "md",
      icon,
      loading = false,
      disabled,
      iconPosition = "start",
      loadingLabel = "Carregando",
      className,
      children,
      type,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    const renderIcon = loading
      ? (
          <Loader2
            size={size === "lg" ? 16 : size === "sm" ? 12 : 14}
            className="animate-spin"
            aria-hidden="true"
          />
        )
      : icon;

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        className={cn(
          "no-drag inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none",
          ACTION_VARIANT_CLASSES[variant],
          ACTION_SIZE_CLASSES[size],
          className,
        )}
        {...rest}
      >
        {loading && <span className="sr-only">{loadingLabel}</span>}
        {renderIcon && iconPosition === "start" && renderIcon}
        <span>{children}</span>
        {renderIcon && iconPosition === "end" && renderIcon}
      </button>
    );
  },
);

// ────────────────────────────────────────────────────────────────────────────
// SectionHeader
// ────────────────────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  /** Renderiza o título usando `<h2>` em vez de `<div>`. */
  as?: "div" | "h2" | "h3" | "header";
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
  as = "div",
}: SectionHeaderProps) {
  const TitleTag = as === "h2" || as === "h3" ? as : "div";
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-3 flex-wrap",
        className,
      )}
    >
      <div className="min-w-0">
        <TitleTag
          className={cn(
            "flux-section-label",
            as === "h2" && "text-[12px]",
            as === "h3" && "text-[11.5px]",
          )}
        >
          {title}
        </TitleTag>
        {subtitle && (
          <p className="mt-1.5 text-[14px] font-normal text-text-secondary leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 flex-shrink-0">{action}</div>}
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MissionCard
// ────────────────────────────────────────────────────────────────────────────

const CARD_VARIANT_CLASSES: Record<CardVariant, string> = {
  default: "flux-cockpit-card",
  elevated: "flux-cockpit-card-elevated",
  interactive:
    "flux-cockpit-card transition-colors hover:bg-bg-card-hover hover:border-border-strong cursor-pointer",
};

const CARD_PADDING_CLASSES: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

export interface MissionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: React.ReactNode;
}

export const MissionCard = React.forwardRef<HTMLDivElement, MissionCardProps>(
  function MissionCard(
    { variant = "default", padding = "md", className, children, ...rest },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          CARD_VARIANT_CLASSES[variant],
          CARD_PADDING_CLASSES[padding],
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

// ────────────────────────────────────────────────────────────────────────────
// MetricPill
// ────────────────────────────────────────────────────────────────────────────

const TREND_CONFIG: Record<
  TrendDirection,
  { icon: React.ReactNode; className: string; label: string }
> = {
  up: {
    icon: <TrendingUp size={11} aria-hidden="true" />,
    className: "text-success",
    label: "Em alta",
  },
  down: {
    icon: <TrendingDown size={11} aria-hidden="true" />,
    className: "text-error",
    label: "Em queda",
  },
  neutral: {
    icon: <Minus size={11} aria-hidden="true" />,
    className: "text-text-muted",
    label: "Estável",
  },
};

export interface MetricPillProps {
  label: string;
  value: string | number;
  trend?: TrendDirection;
  className?: string;
  /** Acessível: rótulo opcional adicional para o valor. */
  valueLabel?: string;
}

export function MetricPill({
  label,
  value,
  trend,
  className,
  valueLabel,
}: MetricPillProps) {
  return (
    <div
      className={cn(
        "flux-kpi-card",
        className,
      )}
      role="group"
      aria-label={`${label}: ${value}`}
    >
      <span className="flux-kpi-value" aria-label={valueLabel}>
        {value}
      </span>
      <span className="flex items-center gap-1.5 mt-0.5">
        <span className="flux-kpi-label">{label}</span>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5",
              TREND_CONFIG[trend].className,
            )}
            aria-label={TREND_CONFIG[trend].label}
            title={TREND_CONFIG[trend].label}
          >
            {TREND_CONFIG[trend].icon}
          </span>
        )}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Re-exports
// ────────────────────────────────────────────────────────────────────────────

export { Clock };

// ────────────────────────────────────────────────────────────────────────────
// Modal — re-export
// ────────────────────────────────────────────────────────────────────────────

export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";

// ────────────────────────────────────────────────────────────────────────────
// MarkdownRenderer — re-export
// ────────────────────────────────────────────────────────────────────────────

export { MarkdownRenderer } from "./MarkdownRenderer";
export type { MarkdownRendererProps } from "./MarkdownRenderer";
