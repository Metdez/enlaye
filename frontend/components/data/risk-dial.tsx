// Circular risk dial — 0-100 arc with three-band color (success / warning / destructive).
// WHY: SVG-only (no recharts) keeps this cheap enough to drop into table rows.
// We render three stacked arc segments rather than a gradient because the band
// boundaries (34 / 64) are meaningful cut-points — a smooth gradient would hide
// them. The active fill is drawn on top of a muted track so the inactive region
// still traces the arc.

import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

type RiskDialProps = {
  score: number; // 0-100; clamped defensively
  size?: Size;
  showLabel?: boolean;
  label?: string;
  className?: string;
};

const SIZE_PX: Record<Size, number> = { sm: 36, md: 56, lg: 80 };
// WHY: font-size and stroke-width scale with the dial, not with the root font,
// so a dial in a dense table still reads at 36px and a hero dial breathes at 80px.
const NUMBER_CLASS: Record<Size, string> = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
};
const STROKE_W: Record<Size, number> = { sm: 4, md: 6, lg: 8 };

// ViewBox is the same across sizes; the container div sets the display size.
const VIEW = 100;
const CX = 50;
const CY = 50;

// WHY: 3/4 circle (270 degrees), rotated so the gap sits at the bottom — leaves
// room for a centered number and mirrors the common gauge convention.
const START_DEG = 135;
const END_DEG = 405; // 135 + 270
const SWEEP_DEG = END_DEG - START_DEG;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path between two angles on a circle centered at (cx, cy). */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  if (endDeg <= startDeg) return "";
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function scoreToDeg(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return START_DEG + (clamped / 100) * SWEEP_DEG;
}

function toneForScore(score: number): "success" | "warning" | "destructive" {
  if (score <= 34) return "success";
  if (score <= 64) return "warning";
  return "destructive";
}

const TONE_STROKE: Record<"success" | "warning" | "destructive", string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  destructive: "var(--color-destructive)",
};

const TONE_TEXT: Record<"success" | "warning" | "destructive", string> = {
  success: "fill-success",
  warning: "fill-warning",
  destructive: "fill-destructive",
};

export function RiskDial({
  score,
  size = "md",
  showLabel = false,
  label,
  className,
}: RiskDialProps) {
  const px = SIZE_PX[size];
  const sw = STROKE_W[size];
  const r = (VIEW - sw * 2) / 2;
  const displayScore = Number.isFinite(score)
    ? Math.round(Math.max(0, Math.min(100, score)))
    : 0;
  const tone = toneForScore(displayScore);

  // Band boundary angles (inactive bands sit under the value arc as a track).
  const deg34 = START_DEG + (34 / 100) * SWEEP_DEG;
  const deg64 = START_DEG + (64 / 100) * SWEEP_DEG;
  const activeDeg = scoreToDeg(displayScore);

  const a11yLabel =
    label ?? `Risk score ${displayScore} out of 100, ${tone} band`;

  return (
    <div
      role="img"
      aria-label={a11yLabel}
      className={cn("inline-flex flex-col items-center gap-0.5", className)}
      style={{ width: px }}
    >
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={px}
        height={px}
        aria-hidden
        className="block"
      >
        {/* Muted track: three segments that hint at the bands even when empty. */}
        <path
          d={arcPath(CX, CY, r, START_DEG, deg34)}
          stroke="var(--color-muted)"
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={arcPath(CX, CY, r, deg34, deg64)}
          stroke="var(--color-muted)"
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={arcPath(CX, CY, r, deg64, END_DEG)}
          stroke="var(--color-muted)"
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
        />

        {/* Active arc in a single color matching the band the score landed in.
            WHY: mixing band colors inside one arc reads as a gradient and hides
            which band the score belongs to. One color = one answer. */}
        {displayScore > 0 ? (
          <path
            d={arcPath(CX, CY, r, START_DEG, activeDeg)}
            stroke={TONE_STROKE[tone]}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}

        {/* Centered number. Geist Mono + tabular-nums keeps the digits from
            jumping when the score shifts. */}
        <text
          x={CX}
          y={CY + 1}
          textAnchor="middle"
          dominantBaseline="central"
          className={cn(
            "font-mono tabular-nums font-semibold",
            NUMBER_CLASS[size],
            TONE_TEXT[tone],
          )}
        >
          {displayScore}
        </text>
      </svg>
      {showLabel ? (
        <span className="text-meta text-muted-foreground">
          {label ?? "risk"}
        </span>
      ) : null}
    </div>
  );
}
