import { MissionCard } from "../ui";

interface UsageSummaryProps {
  tokensUsed: number;
  tokensTotal: number;
  costUsed: number;
  costTotal: number;
  runsUsed: number;
  runsTotal: number;
  projectCount: number;
  activeProjects: number;
}

interface BarProps {
  value: number;
  max: number;
  accentClass: string;
  glowClass?: string;
}

function Bar({ value, max, accentClass, glowClass }: BarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const isHigh = pct >= 80;

  return (
    <div className="relative">
      <div className="h-[5px] w-full rounded-full bg-bg-input overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${accentClass} ${
            pct > 0 ? glowClass ?? "" : ""
          }`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {/* Indicador de percentual */}
      <span
        className={`absolute right-0 -top-4 text-[9.5px] font-semibold tabular-nums ${
          isHigh ? "text-warning" : "text-text-muted"
        }`}
      >
        {Math.round(pct)}%
      </span>
    </div>
  );
}

function formatTokens(v: number) {
  if (v >= 1) return `${v.toFixed(2)}M`;
  return `${Math.round(v * 1000)}K`;
}

function formatCost(v: number) {
  return `$${v.toFixed(2)}`;
}

interface UsageRowProps {
  label: string;
  used: string;
  total: string;
  value: number;
  max: number;
  accentClass: string;
  glowClass?: string;
}

function UsageRow({ label, used, total, value, max, accentClass, glowClass }: UsageRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-secondary font-medium">{label}</span>
        <span className="text-[11px] text-text-primary font-semibold tabular-nums">
          {used}
          <span className="text-text-muted font-normal"> / {total}</span>
        </span>
      </div>
      <Bar value={value} max={max} accentClass={accentClass} glowClass={glowClass} />
    </div>
  );
}

export function UsageSummary({
  tokensUsed,
  tokensTotal,
  costUsed,
  costTotal,
  runsUsed,
  runsTotal,
  projectCount,
  activeProjects,
}: UsageSummaryProps) {
  return (
    <MissionCard variant="default" padding="sm" className="!rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <span className="flux-section-title">Uso Atual</span>
        <span className="text-[10px] text-text-muted font-medium px-1.5 py-0.5 rounded bg-bg-input border border-border-subtle">
          {activeProjects}/{projectCount} ativos
        </span>
      </div>

      {/* Métricas */}
      <div className="space-y-4">
        <UsageRow
          label="Tokens (mês)"
          used={formatTokens(tokensUsed)}
          total={`${tokensTotal}M`}
          value={tokensUsed}
          max={tokensTotal}
          accentClass="bg-gradient-to-r from-accent to-accent-hover"
          glowClass="shadow-[0_0_8px_-2px_rgba(124,91,245,0.5)]"
        />

        <UsageRow
          label="Custo estimado"
          used={formatCost(costUsed)}
          total={formatCost(costTotal)}
          value={costUsed}
          max={costTotal}
          accentClass="bg-gradient-to-r from-accent/80 to-accent"
          glowClass="shadow-[0_0_8px_-2px_rgba(124,91,245,0.4)]"
        />

        <UsageRow
          label="Execuções"
          used={`${runsUsed}`}
          total={`${runsTotal}`}
          value={runsUsed}
          max={runsTotal}
          accentClass="bg-gradient-to-r from-success/70 to-success"
          glowClass="shadow-[0_0_8px_-2px_rgba(34,197,94,0.4)]"
        />
      </div>
    </MissionCard>
  );
}
