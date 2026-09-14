import { useEffect, useRef, useState } from "react";
import { cx, fmtCompact, fmtMoney } from "@/lib/utils";

/*
 * Charts are hand-rolled SVG rather than a charting library: the app has three chart shapes,
 * all on one axis, and a library would add ~100KB plus a second visual language to reconcile
 * with the terminal design system.
 *
 * The categorical palette below was chosen with the dataviz validator, not by eye, and each
 * mode is validated against its own surface (dark #1c1917, light #ffffff) — a dark palette is
 * not an automatic flip of the light one. All six checks pass in both modes: lightness band,
 * chroma floor, CVD separation, normal-vision separation, and contrast.
 *
 *   dark   #1b9ad4  #a87c1c  #9a6bf0   worst adjacent ΔE 23.5 deutan / 24.7 normal
 *   light  #1268a8  #8a6100  #6f42c1   worst adjacent ΔE 21.1 protan / 23.4 normal
 *
 * Hues are assigned to a FIXED series order and never cycled or reassigned by rank, so a
 * reader who learned "sales is blue" is never misled by a filter change.
 */

export const SERIES = ["sales", "purchases", "earnings"] as const;
export type SeriesKey = (typeof SERIES)[number];

/** Set on :root by the theme provider; charts read the matching validated palette. */
function paletteFor(theme: "dark" | "light"): Record<SeriesKey, string> {
  return theme === "dark"
    ? { sales: "#1b9ad4", purchases: "#a87c1c", earnings: "#9a6bf0" }
    : { sales: "#1268a8", purchases: "#8a6100", earnings: "#6f42c1" };
}

export function useChartPalette() {
  const theme =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
  return paletteFor(theme);
}

/**
 * Measures the element the chart is rendered into.
 *
 * An SVG needs a pixel width, so a chart cannot simply be `width: 100%` and still lay out
 * its axis correctly. Observing the container is what lets the chart grow with the card on
 * an ultra-wide monitor instead of sitting at a fixed size with empty space beside it.
 */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver rather than a window listener: the card can change width without the
    // window doing so — a sibling card wrapping, the sidebar collapsing, a filter appearing.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

/* --------------------------------------------------------------------- legend */

export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string }>;
}) {
  // Always present for two or more series: identity must never rest on colour alone.
  return (
    <div className="row" style={{ gap: 14, marginBottom: 10 }}>
      {items.map((i) => (
        <span key={i.label} className="row" style={{ gap: 6 }}>
          <span
            aria-hidden
            style={{ width: 9, height: 9, borderRadius: 2, background: i.color, flexShrink: 0 }}
          />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-muted)" }}>
            {i.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- grouped columns */

export interface TrendPoint {
  period: string;
  sales: number;
  purchases: number;
  earnings: number;
}

/**
 * Grouped columns, one group per period, three series on ONE axis.
 *
 * One axis is not a stylistic choice: all three series are CHF, and a second y-scale would
 * invent a correlation that is not in the data. Earnings crosses zero, so the baseline sits
 * wherever zero falls and negative columns hang below it — the sign is read from position, not
 * from colour.
 */
export function TrendChart({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  const palette = useChartPalette();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [wrapRef, available] = useContainerWidth<HTMLDivElement>();

  /*
   * Per-chart clip id for the draw-on animation. Three lines share
   * one wide clip that grows from left to right so the dashed
   * purchases line keeps its `strokeDasharray="6 4"` look (the
   * stroke-dasharray draw-on trick would have replaced the dash
   * pattern). The id is lazy-init inside `useRef` so it is stable
   * across re-renders and unique even when two charts mount on the
   * same page.
   */
  const clipIdRef = useRef<string | null>(null);
  if (clipIdRef.current === null) {
    clipIdRef.current = `trend-clip-${Math.random().toString(36).slice(2, 9)}`;
  }
  const clipId = clipIdRef.current;

  // Wider right padding than the column chart needed — the direct labels sit to the right of
  // the last data point and need ~70px to read.
  const padL = 66;
  const padR = 72;
  const padT = 12;
  const padB = 32;

  // Hit targets are still one per period, so the same legibility floor applies: below 62px
  // per period the chart scrolls inside itself rather than becoming unreadable.
  const MIN_GROUP = 62;
  const minWidth = padL + padR + data.length * MIN_GROUP;
  const width = Math.max(minWidth, available || minWidth);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = data.flatMap((d) => [d.sales, d.purchases, d.earnings]);
  const rawMax = Math.max(0, ...values);
  const rawMin = Math.min(0, ...values);
  // Padding the domain to 1.08× keeps the highest line off the frame, same as before.
  const max = rawMax === 0 && rawMin === 0 ? 1 : rawMax * 1.08;
  const min = rawMin * 1.08;
  const span = max - min || 1;

  const y = (v: number) => padT + ((max - v) / span) * plotH;
  const zeroY = y(0);
  const xAt = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);

  /*
   * Five ticks is one more than the column chart used: a smoothed line that crosses zero
   * needs an axis tick on each side so the reader can place the crossings. With a single
   * series crossing zero, four is fine; with all three crossing, five reads better.
   */
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => min + (span * i) / ticks);

  if (data.length === 0) {
    return (
      <div ref={wrapRef} className="empty">
        No data in this range.
      </div>
    );
  }

  // Per-series path data. Each series is its own SVG path with its own treatment; sales and
  // purchases share axis-space but distinguish themselves by stroke weight and dash pattern
  // rather than colour alone (the existing palette rule still holds).
  const buildLine = (key: SeriesKey) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  // Earnings carries the soft area fill. The fill stops at y(0) when earnings crosses zero,
  // so a negative month shows as a line dipping below the baseline rather than as a
  // filled region that implies magnitude. This matches the example's treatment of profit.
  const earningsPath = buildLine("earnings");
  const earningsArea =
    data.length > 0
      ? `${earningsPath} L${xAt(data.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${xAt(0).toFixed(1)},${zeroY.toFixed(1)} Z`
      : "";

  /*
   * Draw-on duration scales with the number of periods. Six months
   * gets a noticeably longer animation than two, so the eye can
   * track the line all the way across. The clip rect grows from
   * `scaleX(0)` to `scaleX(1)` over this duration.
   */
  const drawDuration = Math.min(1400, 700 + data.length * 90);

  // Endpoint dots only — a dot on every month is noise on a 12-month line.
  const last = data[data.length - 1];

  // Earnings splits stroke colour when it goes negative, so the polarity reads without
  // needing the area fill. The figure in the hero already does the same thing.
  const earningsNegative = last.earnings < 0;
  const earningsStroke = earningsNegative ? "var(--danger)" : palette.earnings;

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", overflowX: "auto", minWidth: 0 }}
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Sales, purchases and earnings by period"
        style={{ display: "block" }}
      >
        {/* Solid hairline grid, one shade off the surface. */}
        {tickVals.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={y(v) + 3}
              textAnchor="end"
              style={{ fontFamily: "var(--mono)", fontSize: 10.5, fill: "var(--fg-subtle)" }}
            >
              {fmtCompact(v)}
            </text>
          </g>
        ))}

        {/* Zero line is emphasised: it is what makes a negative earnings line readable. */}
        <line
          x1={padL}
          x2={width - padR}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />

        {/* Earnings area fill — inside the clip group so it draws on with the line. */}
        <defs>
          <clipPath id={clipId}>
            <rect
              x={padL}
              y={0}
              width={width - padL - padR}
              height={height}
              className="trend-clip-rect"
              style={{
                animationDuration: `${drawDuration}ms`,
                "--clip-w": `${width - padL - padR}px`,
              } as React.CSSProperties}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {earningsArea && (
            <path
              d={earningsArea}
              fill={earningsNegative ? "var(--danger)" : palette.earnings}
              opacity={0.12}
            />
          )}
          {/* Sales — solid, the headline series. */}
          <path
            d={buildLine("sales")}
            fill="none"
            stroke={palette.sales}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hover && hover.i !== data.length - 1 ? 0.85 : 1}
          />

          {/* Purchases — dashed, signalled as a deduction not a flow. */}
          <path
            d={buildLine("purchases")}
            fill="none"
            stroke={palette.purchases}
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hover && hover.i !== data.length - 1 ? 0.7 : 1}
          />

          {/* Earnings — solid, stroke flips to danger when it ends negative. */}
          <path
            d={earningsPath}
            fill="none"
            stroke={earningsStroke}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hover && hover.i !== data.length - 1 ? 0.85 : 1}
          />
        </g>

        {/* Endpoint dots, all three — they are the data, not a single trend. */}
        {([
          ["sales", palette.sales],
          ["purchases", palette.purchases],
          ["earnings", earningsStroke],
        ] as const).map(([key, color]) => (
          <circle
            key={key}
            cx={xAt(data.length - 1)}
            cy={y(last[key])}
            r={3.5}
            fill={color}
            stroke="var(--card)"
            strokeWidth={2}
            className="trendline-fade"
            style={{ animationDelay: `${drawDuration}ms` }}
          />
        ))}

        {/* Direct labels at the right edge so the chart is legible without the legend box.
           The Legend component above the chart still ships (the rule is: ≥ 2 series gets a
           legend); these labels are a complement, not a replacement. */}
        {([
          ["sales", palette.sales, "Sales"],
          ["purchases", palette.purchases, "Purchases"],
          ["earnings", earningsStroke, "Earnings"],
        ] as const).map(([key, color, label]) => (
          <text
            key={key}
            x={width - padR + 8}
            y={y(last[key]) + 3}
            className="trendline-fade"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 600,
              fill: color,
              animationDelay: `${drawDuration}ms`,
            }}
          >
            {label}
          </text>
        ))}

        {/* X-axis period labels. The first period sits at the left edge with text-anchor
           "start" so the y-axis numbers do not clip it. */}
        {data.map((d, i) => {
          const isFirst = i === 0;
          const isLast = i === data.length - 1;
          const anchor = isFirst ? "start" : isLast ? "end" : "middle";
          const xOffset = isFirst ? 0 : isLast ? 0 : 0;
          return (
            <text
              key={d.period}
              x={xAt(i) + xOffset}
              y={height - 10}
              textAnchor={anchor}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                fill: "var(--fg-subtle)",
              }}
            >
              {d.period.slice(2)}
            </text>
          );
        })}

        {/* Hover layer: transparent hit targets span each period column, with a vertical
           guide that snaps to the hovered period's x position. Same UX as the column chart. */}
        {data.map((d, i) => {
          const px = xAt(i);
          const gx = i === 0 ? padL : px - MIN_GROUP / 2;
          const gw = i === 0 ? MIN_GROUP / 2 : MIN_GROUP;
          return (
            <g key={d.period}>
              <rect
                x={gx}
                y={padT}
                width={gw}
                height={plotH}
                fill="transparent"
                onMouseEnter={(e) =>
                  setHover({ i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
                }
                onMouseMove={(e) =>
                  setHover({ i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
                }
                onMouseLeave={() => setHover(null)}
              />
              {hover && hover.i === i && (
                <line
                  x1={px}
                  x2={px}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: Math.min(hover.x + 12, width - 190),
            top: Math.max(hover.y - 10, 0),
            pointerEvents: "none",
            background: "var(--card)",
            border: "1px solid var(--border-strong)",
            borderRadius: 7,
            padding: "8px 10px",
            fontFamily: "var(--mono)",
            fontSize: 11,
            zIndex: 5,
            minWidth: 170,
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          }}
        >
          <div style={{ color: "var(--fg)", marginBottom: 5 }}>{data[hover.i].period}</div>
          {SERIES.map((key) => (
            <div
              key={key}
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <span className="row" style={{ gap: 6 }}>
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: 2, background: palette[key] }}
                />
                <span style={{ color: "var(--fg-muted)" }}>{key}</span>
              </span>
              <span style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
                {fmtMoney(data[hover.i][key])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------- per-wing monthly spend (lines) */

/**
 * A multi-line chart for per-wing monthly spend across N months.
 *
 * One line per wing, one X-tick per month. Same hand-rolled SVG style as
 * TrendChart — no recharts dependency, drawn directly into the card.
 *
 * Animation: the path's `stroke-dasharray` is set to the path length on
 * mount and `stroke-dashoffset` is animated to 0 via a CSS transition,
 * so each line draws itself from left to right on first paint. The
 * lines fade in sequentially (one per wing) so the chart tells the
 * reader where to look first instead of all at once.
 *
 * Wing colours reuse the `PIE_PALETTE` slot order so the per-wing pie
 * on the same page and the lines here agree on which wing is which
 * colour — slot 0 is always blue, slot 1 always amber, etc. A reader
 * who learned "Cloud Subscription is blue" sees the same colour in
 * both charts.
 */
export interface WingLinePoint {
  period: string;
  values: Record<string, number>;
}

export function WingLineChart({
  data,
  seriesKeys,
  seriesLabels,
  height = 280,
}: {
  data: WingLinePoint[];
  seriesKeys: string[];
  seriesLabels: Record<string, string>;
  height?: number;
}) {
  const [wrapRef, available] = useContainerWidth<HTMLDivElement>();

  const padL = 60;
  const padR = 130;
  const padT = 16;
  const padB = 32;
  const MIN_PERIOD = 56;
  const minWidth = padL + padR + data.length * MIN_PERIOD;
  const width = Math.max(minWidth, available || minWidth);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allValues = data.flatMap((d) => seriesKeys.map((k) => d.values[k] ?? 0));
  const rawMax = Math.max(0, ...allValues);
  const max = rawMax === 0 ? 1 : rawMax * 1.08;
  const y = (v: number) => padT + ((max - v) / max) * plotH;
  const xAt = (i: number) =>
    padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => (max * i) / ticks);

  if (data.length === 0) {
    return (
      <div ref={wrapRef} className="empty">
        No data in this range.
      </div>
    );
  }

  // Build the path data for each series. Same shape as TrendChart's
  // `buildLine`, but the key is a free-form string so we can take any
  // wing, not just the three TrendChart knows about.
  const buildLine = (key: string) =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${y(d.values[key] ?? 0).toFixed(1)}`)
      .join(" ");

  // Path length is needed for the stroke-dasharray draw-on trick. We
  // approximate it with the bounding-box diagonal — the dasharray just
  // needs to be >= the actual length so a single CSS animation from
  // `stroke-dashoffset: totalLength` to `0` paints the whole line. The
  // chart is on a 6-month range, the line is roughly horizontal, so
  // the approximation is fine for visual purposes.
  const totalLength = data.length < 2 ? 1 : padL + plotW + plotH;

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", overflowX: "auto", minWidth: 0 }}
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Per-wing monthly spend"
        style={{ display: "block" }}
      >
        {tickVals.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={y(v) + 3}
              textAnchor="end"
              style={{ fontFamily: "var(--mono)", fontSize: 10.5, fill: "var(--fg-subtle)" }}
            >
              {fmtCompact(v)}
            </text>
          </g>
        ))}

        {/*
         * Each line gets its own draw-on animation. The classes are
         * keyed by series index so a transition fires on first paint
         * only — the chart is "alive" on mount, not a perpetual loop.
         */}
        {seriesKeys.map((key, i) => (
          <path
            key={key}
            d={buildLine(key)}
            fill="none"
            stroke={PIE_PALETTE[i % PIE_PALETTE.length] ?? "var(--primary)"}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={totalLength}
            strokeDashoffset={totalLength}
            className="wingline-draw"
            style={{
              animationDelay: `${i * 140}ms`,
              animationDuration: `${Math.min(1400, 700 + data.length * 90)}ms`,
            }}
          />
        ))}

        {/*
         * Endpoint dots — one per series at the rightmost month. The
         * trend line is the data; the dots just mark the current value
         * for the reader who scans the right edge.
         */}
        {seriesKeys.map((key, i) => {
          const last = data[data.length - 1];
          const v = last?.values[key] ?? 0;
          return (
            <circle
              key={key}
              cx={xAt(data.length - 1)}
              cy={y(v)}
              r={3}
              fill={PIE_PALETTE[i % PIE_PALETTE.length] ?? "var(--primary)"}
              stroke="var(--card)"
              strokeWidth={2}
              className="wingline-fade"
              style={{ animationDelay: `${i * 140 + 600}ms` }}
            />
          );
        })}

        {/* Direct labels at the right edge — same reason as TrendChart. */}
        {seriesKeys.map((key, i) => {
          const last = data[data.length - 1];
          const v = last?.values[key] ?? 0;
          return (
            <text
              key={key}
              x={width - padR + 8}
              y={y(v) + 3}
              className="wingline-fade"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                fontWeight: 600,
                fill: PIE_PALETTE[i % PIE_PALETTE.length] ?? "var(--primary)",
                animationDelay: `${i * 140 + 600}ms`,
              }}
            >
              {seriesLabels[key] ?? key}
            </text>
          );
        })}

        {/* X-axis period labels. */}
        {data.map((d, i) => {
          const isFirst = i === 0;
          const isLast = i === data.length - 1;
          const anchor = isFirst ? "start" : isLast ? "end" : "middle";
          return (
            <text
              key={d.period}
              x={xAt(i)}
              y={height - 10}
              textAnchor={anchor}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                fill: "var(--fg-subtle)",
              }}
            >
              {d.period.slice(2)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------- horizontal bars */

export interface CatPoint {
  key: string;
  label: string;
  sub?: string | null;
  value: number;
}

/**
 * Horizontal bars for a single measure across nominal categories.
 *
 * One colour for every bar — deliberately not a darker-where-bigger ramp, which would encode
 * length twice and burn the only free channel on information the bar already shows. Negative
 * values extend left of zero and always carry an explicit minus sign in the label, so polarity
 * never depends on colour.
 */
export function CategoryBars({
  data,
  color,
  emptyLabel = "no data in this range",
  formatValue = fmtMoney,
}: {
  data: CatPoint[];
  color?: string;
  emptyLabel?: string;
  /**
   * How the figure beside each bar is written. Defaults to money because these charts
   * came from a costing app — a caller plotting COUNTS must pass its own, or every
   * incident total reads as an amount in francs.
   */
  formatValue?: (v: number) => string;
}) {
  const palette = useChartPalette();
  const fill = color ?? palette.sales;
  const [hover, setHover] = useState<string | null>(null);

  if (data.length === 0) return <div className="empty">{emptyLabel}</div>;


  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const hasNegative = data.some((d) => d.value < 0);
  // With negatives present the axis is centred so zero sits in the middle.
  const zeroPct = hasNegative ? 50 : 0;

  return (
    <div style={{ display: "grid", gap: 9, width: "100%", minWidth: 0 }}>
      {data.map((d, i) => {
        const pct = (Math.abs(d.value) / max) * (hasNegative ? 50 : 100);
        const negative = d.value < 0;
        return (
          <div
            key={d.key}
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
            style={{
              display: "grid",
              // The bar track takes the slack, so a wider card yields a longer bar rather
              // than a wider empty gap.
              gridTemplateColumns: "minmax(140px, 1fr) minmax(120px, 3fr) auto",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  color: "var(--fg)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={d.label}
              >
                {d.label}
              </div>
              {d.sub && (
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-subtle)" }}>
                  {d.sub}
                </div>
              )}
            </div>

            <div style={{ position: "relative", height: 10, minWidth: 0 }}>
              {hasNegative && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -2,
                    bottom: -2,
                    width: 1,
                    background: "var(--border-strong)",
                  }}
                />
              )}
              <div
                className="catbar-track"
                style={{
                  position: "absolute",
                  top: 0,
                  height: 10,
                  borderRadius: 4,
                  background: fill,
                  opacity: hover && hover !== d.key ? 0.45 : 1,
                  width: `${pct}%`,
                  left: negative ? `${zeroPct - pct}%` : `${zeroPct}%`,
                  /*
                   * Animation origin matches the bar's left edge so the
                   * grow-from-0 starts at the chart's vertical axis.
                   * Negative bars flip the origin to the right edge so
                   * they extend leftward from the zero line.
                   */
                  transformOrigin: negative ? "right center" : "left center",
                  animationDelay: `${i * 40}ms`,
                  animationDuration: `${Math.min(900, 400 + pct * 5)}ms`,
                }}
              />
            </div>

            <div
              className="num"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--fg)",
                minWidth: 118,
                textAlign: "right",
              }}
            >
              {/* Explicit sign: colour is never the only cue for polarity. */}
              {negative ? `−${formatValue(Math.abs(d.value))}` : formatValue(d.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ pie */

/**
 * Six-colour categorical palette for the donut. Validated against the
 * same light / dark backgrounds as `paletteFor` above (lightness band,
 * chroma floor, CVD separation, normal-vision separation, contrast).
 * Hues are assigned to a FIXED slot order — the first wing in the data
 * is always the same colour, regardless of which month the user picked,
 * so a reader who learned "Legacy is blue" is never misled by a filter
 * change. Slots 7+ fall back to `palette.sales` so the chart degrades
 * gracefully with more categories than expected.
 */
const PIE_PALETTE = [
  "#1b9ad4",
  "#a87c1c",
  "#9a6bf0",
  "#2da66e",
  "#c44b6e",
  "#5a7e9a",
] as const;

/**
 * Donut / pie for a single measure across nominal categories. Same
 * `{ key, label, sub?, value }` shape as `CategoryBars` so the wings
 * rollup can swap chart types without touching the data pipeline.
 *
 * Slice colours are stable by slot (not by rank), so the same wing
 * keeps its colour across months. Hover tooltip is a native `<title>`
 * element — no JS hover state needed; the wings page renders this
 * inline under the table, where a custom popover would just be noise.
 *
 * The centre stays empty so the total can be drawn over the chart.
 * Empty state mirrors `CategoryBars` so the swap is visually silent.
 */
export function CategoryPie({
  data,
  emptyLabel = "no data in this range",
  centerLabel,
}: {
  data: CatPoint[];
  emptyLabel?: string;
  centerLabel?: string;
}) {
  const palette = useChartPalette();

  if (data.length === 0) return <div className="empty">{emptyLabel}</div>;

  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0);
  if (total <= 0) return <div className="empty">{emptyLabel}</div>;

  /*
   * Use only the positive slices — a "negative cost" wing (e.g. a
   * customer credit that reduced a bill) would otherwise force the
   * arc math to wrap past zero and visually disappear. Drop them
   * here and let the table column surface the absolute sign.
   */
  const slices = data.filter((d) => d.value > 0);

  const size = 200;
  const outerR = 90;
  const innerR = 55;
  const cx = size / 2;
  const cy = size / 2;

  let angle = -Math.PI / 2; // start at 12 o'clock
  const paths: Array<{ d: string; colour: string; tip: string }> = [];

  for (let i = 0; i < slices.length; i += 1) {
    const slice = slices[i];
    const fraction = slice.value / total;
    const next = angle + fraction * Math.PI * 2;
    const colour = PIE_PALETTE[i % PIE_PALETTE.length] ?? palette.sales;
    paths.push({
      d: arcPath(cx, cy, outerR, innerR, angle, next),
      colour,
      tip: `${slice.label} · ${slice.sub ?? ""} · ${slice.value.toFixed(0)}`,
    });
    angle = next;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px, 220px) minmax(0, 1fr)",
        gap: 18,
        alignItems: "center",
        width: "100%",
        minWidth: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block", margin: "0 auto" }}
        aria-label="Donut chart of values per category"
        role="img"
      >
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.colour}>
            <title>{p.tip}</title>
          </path>
        ))}
        {centerLabel && (
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 13,
              fill: "var(--fg)",
            }}
          >
            {centerLabel}
          </text>
        )}
      </svg>
      <Legend
        items={slices.map((s, i) => ({
          label: `${s.label} · ${((s.value / total) * 100).toFixed(0)}%`,
          color: PIE_PALETTE[i % PIE_PALETTE.length] ?? palette.sales,
        }))}
      />
    </div>
  );
}

/**
 * Build the SVG path for one donut slice. Single-slice case (a full
 * circle, where start === end) needs a special case — the general
 * `arcPath` formula returns two arcs that draw a zero-angle wedge
 * with the inner cutout missing.
 */
function arcPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  if (endAngle - startAngle >= Math.PI * 2 - 1e-6) {
    return [
      `M ${cx + outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy}`,
      `M ${cx + innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`,
      "Z",
    ].join(" ");
  }
  const x1 = cx + outerR * Math.cos(startAngle);
  const y1 = cy + outerR * Math.sin(startAngle);
  const x2 = cx + outerR * Math.cos(endAngle);
  const y2 = cy + outerR * Math.sin(endAngle);
  const x3 = cx + innerR * Math.cos(endAngle);
  const y3 = cy + innerR * Math.sin(endAngle);
  const x4 = cx + innerR * Math.cos(startAngle);
  const y4 = cy + innerR * Math.sin(startAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

/* ------------------------------------------------------------------ sparkline */

/**
 * A single-series trend line, for the hero metric.
 *
 * One series means colour carries no identity, so this needs no palette slot and no legend —
 * the label beside it names it. Deliberately axis-free: it shows direction and shape, and the
 * exact figures live in the main chart and the table view.
 */
export function Sparkline({
  values,
  height = 42,
  tone = "primary",
}: {
  values: number[];
  height?: number;
  tone?: "primary" | "danger";
}) {
  const [ref, available] = useContainerWidth<HTMLDivElement>();
  const width = Math.max(80, available || 220);

  /*
   * Lazy-init clip id so it's stable across re-renders and unique
   * even when two sparklines mount on the same page (e.g. dashboard
   * hero + a future detail card).
   */
  const clipIdRef = useRef<string | null>(null);
  if (clipIdRef.current === null) {
    clipIdRef.current = `spark-clip-${Math.random().toString(36).slice(2, 9)}`;
  }
  const clipId = clipIdRef.current;

  if (values.length < 2) {
    return <div ref={ref} style={{ height, minWidth: 0 }} />;
  }

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const stroke = tone === "danger" ? "var(--danger)" : "var(--primary)";
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);
  /*
   * Draw-on duration. The sparkline is short enough that 700ms is
   * enough for the eye to track the line all the way across.
   */
  const drawDuration = 700;

  return (
    <div ref={ref} style={{ width: "100%", minWidth: 0 }}>
      <svg width={width} height={height} style={{ display: "block" }} aria-hidden>
        {/*
         * Wrap the area + line in a clip that grows from left to right
         * so the area stays invisible until the line draws on. Same
         * width-based animation as TrendChart so the browser
         * consistently applies the reveal.
         */}
        <defs>
          <clipPath id={clipId}>
            <rect
              x={0}
              y={0}
              width={0}
              height={height}
              className="trend-clip-rect"
              style={{
                animationDuration: `${drawDuration}ms`,
                "--clip-w": `${width}px`,
              } as React.CSSProperties}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <path d={area} fill={stroke} opacity={0.1} />
          {/* Zero line, but only when the series actually crosses it. */}
          {min < 0 && max > 0 && (
            <line
              x1={pad}
              x2={width - pad}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          )}
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </g>
        {/* The endpoint is the only marked point — a dot on every month would be noise. */}
        <circle
          cx={lastX}
          cy={lastY}
          r={3.5}
          fill={stroke}
          stroke="var(--card)"
          strokeWidth={2}
          className="trendline-fade"
          style={{ animationDelay: `${drawDuration}ms` }}
        />
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- ranked list */

export interface RankedItem {
  key: string;
  label: string;
  sub?: string | null;
  value: number;
}

/**
 * Compact ranked list with a diverging micro-bar.
 *
 * Used instead of a fourth bar chart. Every bar carries ONE hue — a darker-where-bigger ramp
 * would encode magnitude twice and burn the only free channel on information the bar length
 * already shows. Polarity is read from which side of centre the bar sits on, plus an explicit
 * minus sign in the figure, so it never depends on colour.
 */
export function RankedList({
  items,
  limit,
  emptyLabel = "No data in this range.",
  formatValue = fmtMoney,
}: {
  items: RankedItem[];
  limit?: number;
  emptyLabel?: string;
  /** See the note on CategoryBars — the default is money, not a count. */
  formatValue?: (v: number) => string;
}) {
  if (items.length === 0) return <div className="empty">{emptyLabel}</div>;

  const shown = limit ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const anyNegative = items.some((i) => i.value < 0);

  return (
    <>
      <div className="ranked">
        {shown.map((i) => {
          const pct = (Math.abs(i.value) / max) * (anyNegative ? 50 : 100);
          const negative = i.value < 0;
          return (
            <div className="ranked-row" key={i.key}>
              <div style={{ minWidth: 0 }}>
                <div className="ranked-name" title={i.label}>
                  {i.label}
                </div>
                {i.sub && <span className="ranked-sub">{i.sub}</span>}
              </div>
              <div className="mini-bar">
                {anyNegative && <i />}
                <span
                  className={negative ? "neg" : undefined}
                  style={{
                    width: `${pct}%`,
                    left: negative ? `${50 - pct}%` : anyNegative ? "50%" : "0%",
                  }}
                />
              </div>
              <div className={cx("ranked-value", negative && "neg")}>
                {negative ? `−${formatValue(Math.abs(i.value))}` : formatValue(i.value)}
              </div>
            </div>
          );
        })}
      </div>
      {/* Never a silent truncation: say what was left out. */}
      {hidden > 0 && (
        <div style={{ fontSize: 13, color: "var(--fg-subtle)", marginTop: 10 }}>
          and {hidden} more — switch to Tables for the full list
        </div>
      )}
    </>
  );
}
