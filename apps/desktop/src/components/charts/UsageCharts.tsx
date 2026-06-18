import { useMemo } from "react";

const CHART_COLORS = [
  "#ff4d4d", "#38bdf8", "#22c55e", "#f5a524", "#7c5bf5",
  "#f472b6", "#06b6d4", "#a3e635", "#fb923c", "#c084fc",
];

export function getColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

// ── BarChart ────────────────────────────────────────────────────────────────
export interface BarChartData {
  label: string;
  value: number;
  color?: string;
  subLabel?: string;
}

interface BarChartProps {
  data: BarChartData[];
  maxValue?: number;
  height?: number;
  showValues?: boolean;
  formatValue?: (v: number) => string;
  className?: string;
}

export function BarChart({ data, maxValue: overrideMax, height = 200, formatValue, className }: BarChartProps) {
  const maxValue = useMemo(() => overrideMax ?? Math.max(1, ...data.map((d) => d.value)), [data, overrideMax]);
  if (data.length === 0) {
    return <div className={`flex items-center justify-center text-text-muted text-[12px] ${className ?? ""}`} style={{ height }}>Sem dados para exibir</div>;
  }
  const fmt = formatValue ?? ((v: number) => String(v));
  const barHeight = Math.max(16, Math.min(28, 200 / data.length));

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      {data.map((d, i) => {
        const pct = maxValue > 0 ? (d.value / maxValue) * 100 : 0;
        const color = d.color || getColor(i);
        return (
          <div key={i} className="flex items-center gap-3 group">
            <span className="text-[11px] text-text-secondary font-medium w-[120px] text-right truncate flex-shrink-0" title={d.label}>{d.label}</span>
            <div className="flex-1 relative" style={{ height: barHeight }}>
              <div className="absolute inset-0 rounded-md bg-bg-input overflow-hidden">
                <div className="h-full rounded-md transition-all duration-500 ease-out" style={{ width: `${Math.max(pct, 0)}%`, backgroundColor: color, opacity: 0.85 }} />
              </div>
            </div>
            <span className="text-[10.5px] text-text-muted font-mono w-[64px] text-right flex-shrink-0 tabular-nums">{fmt(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── AreaChart ───────────────────────────────────────────────────────────────
interface AreaChartProps {
  data: Array<{ date: string; values: number[] }>;
  seriesLabels: string[];
  seriesColors?: string[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}

export function AreaChart({ data, seriesLabels, seriesColors, height = 180, formatValue, className }: AreaChartProps) {
  const colors = seriesColors ?? seriesLabels.map((_, i) => getColor(i));
  const fmt = formatValue ?? ((v: number) => String(v));
  const maxValue = useMemo(() => {
    let max = 1;
    for (const d of data) for (const v of d.values) if (v > max) max = v;
    return max;
  }, [data]);

  if (data.length === 0) {
    return <div className={`flex items-center justify-center text-text-muted text-[12px] ${className ?? ""}`} style={{ height }}>Sem dados para exibir</div>;
  }

  const padding = { top: 10, right: 16, bottom: 30, left: 50 };
  const w = 700;
  const h = height;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const seriesPaths = seriesLabels.map((_, si) => {
    const points = data.map((d, i) => {
      const x = padding.left + (i / Math.max(data.length - 1, 1)) * plotW;
      const y = padding.top + plotH - (d.values[si] / maxValue) * plotH;
      return { x, y };
    });
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const area = `${line} L ${points[points.length - 1].x} ${padding.top + plotH} L ${points[0].x} ${padding.top + plotH} Z`;
    return { line, area, points };
  });

  const step = Math.max(1, Math.floor(data.length / 8));
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <div className={`overflow-x-auto ${className ?? ""}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padding.top + plotH - frac * plotH;
          return (
            <g key={frac}>
              <line x1={padding.left} y1={y} x2={padding.left + plotW} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fill="#6f6f76" fontSize={9} fontFamily="system-ui">{fmt(maxValue * frac)}</text>
            </g>
          );
        })}
        {seriesPaths.map((sp, si) => <path key={`area-${si}`} d={sp.area} fill={colors[si]} opacity={0.08} />)}
        {seriesPaths.map((sp, si) => <path key={`line-${si}`} d={sp.line} fill="none" stroke={colors[si]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
        {seriesPaths.map((sp, si) => { const last = sp.points[sp.points.length - 1]; return last ? <circle key={`dot-${si}`} cx={last.x} cy={last.y} r={3} fill={colors[si]} /> : null; })}
        {xLabels.map((d, i) => {
          const idx = data.indexOf(d);
          const x = padding.left + (idx / Math.max(data.length - 1, 1)) * plotW;
          return <text key={i} x={x} y={h - 6} textAnchor="middle" fill="#6f6f76" fontSize={9} fontFamily="system-ui">{d.date.length > 5 ? d.date.slice(5) : d.date}</text>;
        })}
      </svg>
    </div>
  );
}

// ── DonutChart ──────────────────────────────────────────────────────────────
interface DonutChartProps {
  data: Array<{ label: string; value: number; color?: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}

export function DonutChart({ data, size = 140, thickness = 16, centerLabel, centerValue, className }: DonutChartProps) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  if (total === 0) {
    return (
      <div className={`flex items-center justify-center ${className ?? ""}`} style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
          <text x={cx} y={cy - 4} textAnchor="middle" fill="#6f6f76" fontSize={11} fontFamily="system-ui">Sem dados</text>
        </svg>
      </div>
    );
  }

  let cumulativeOffset = 0;
  return (
    <div className={`relative inline-flex items-center justify-center ${className ?? ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {data.map((d, i) => {
          const pct = d.value / total;
          const dashLen = pct * circumference;
          const dashOffset = -cumulativeOffset * circumference;
          cumulativeOffset += pct;
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color || getColor(i)} strokeWidth={thickness} strokeDasharray={`${dashLen} ${circumference - dashLen}`} strokeDashoffset={dashOffset} strokeLinecap="butt" opacity={0.85}><title>{`${d.label}: ${d.value}`}</title></circle>;
        })}
      </svg>
      {(centerValue || centerLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && <span className="text-[16px] font-bold text-text-primary">{centerValue}</span>}
          {centerLabel && <span className="text-[9px] text-text-muted mt-0.5">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ── SparkLine ───────────────────────────────────────────────────────────────
interface SparkLineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

export function SparkLine({ data, color = "#ff4d4d", width = 80, height = 24, className }: SparkLineProps) {
  if (data.length < 2) return <div className={className} style={{ width, height }} />;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = max - min || 1;
  const points = data.map((v, i) => { const x = (i / (data.length - 1)) * width; const y = height - ((v - min) / range) * (height - 4) - 2; return `${x},${y}`; });
  const areaPoints = [...points, `${width},${height}`, `0,${height}`].join(" ");

  return (
    <svg width={width} height={height} className={className}>
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#spark-${color.replace("#", "")})`} />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
