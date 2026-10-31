import { useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
  type TooltipModel,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useTheme } from "../theme/ThemeContext";
import { chartTheme, PRIMARY, primaryAlpha } from "../theme/chartTheme";
import { formatAxisNumber, formatNumber } from "../utils/format";
import type { SeriesPoint } from "../utils/timeSeries";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const SERIES = [
  { key: "logins" as const, label: "Logins tentés", fill: 0.6, border: 0.9, order: 3 },
  { key: "n" as const, label: "Connexions", fill: 0.4, border: 0.7, order: 4 },
];

interface TooltipState {
  x: number;
  y: number;
  title: string;
  label: string;
  value: number;
  color: string;
}

// Same visual grammar as Umami's PageviewsChart: two bar datasets drawn over each other
// (x stacked, y not), the subset in the darker shade, no vertical grid, dot legend below.
export function ActivityChart({
  series,
  onBucketClick,
}: {
  series: SeriesPoint[];
  onBucketClick?: (point: SeriesPoint) => void;
}) {
  const [theme] = useTheme();
  const colors = chartTheme(theme);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const clickRef = useRef(onBucketClick);
  clickRef.current = onBucketClick;

  const labelEvery = Math.max(1, Math.ceil(series.length / 14));

  const data = useMemo(
    () => ({
      labels: series.map((p) => p.label),
      datasets: SERIES.map((s) => ({
        label: s.label,
        data: series.map((p) => p[s.key]),
        hidden: hidden.has(s.label),
        backgroundColor: primaryAlpha(s.fill),
        hoverBackgroundColor: primaryAlpha(s.border),
        borderColor: primaryAlpha(s.border),
        hoverBorderColor: PRIMARY,
        borderWidth: 1,
        barPercentage: 0.9,
        categoryPercentage: 0.9,
        order: s.order,
      })),
    }),
    [series, hidden]
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300, resize: { duration: 0 }, active: { duration: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          intersect: true,
          external: ({ chart, tooltip: model }: { chart: ChartJS; tooltip: TooltipModel<"bar"> }) => {
            if (!model.opacity || !model.dataPoints?.length) {
              setTooltip(null);
              return;
            }
            const point = model.dataPoints[0];
            const rect = chart.canvas.getBoundingClientRect();
            setTooltip({
              x: rect.left + model.caretX,
              y: rect.top + model.caretY,
              title: seriesRef.current[point.dataIndex]?.title ?? "",
              label: point.dataset.label ?? "",
              value: Number(point.raw) || 0,
              color: String(point.dataset.borderColor ?? PRIMARY),
            });
          },
        },
      },
      onClick: (_event, elements) => {
        const point = elements.length ? seriesRef.current[elements[0].index] : undefined;
        if (point) clickRef.current?.(point);
      },
      onHover: (event, elements) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = elements.length && clickRef.current ? "pointer" : "default";
      },
      scales: {
        x: {
          stacked: true,
          offset: true,
          grid: { display: false },
          border: { color: colors.line },
          ticks: {
            color: colors.text,
            autoSkip: false,
            maxRotation: 0,
            callback: (_value, index) => (index % labelEvery === 0 ? seriesRef.current[index]?.label : ""),
          },
        },
        y: {
          min: 0,
          beginAtZero: true,
          stacked: false,
          grid: { color: colors.line },
          border: { color: colors.line },
          ticks: { color: colors.text, precision: 0, callback: (value) => formatAxisNumber(Number(value)) },
        },
      },
    }),
    [colors.line, colors.text, labelEvery]
  );

  function toggle(label: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="chart-panel">
      <div className="chart-container" onMouseLeave={() => setTooltip(null)}>
        <Bar data={data} options={options} />
      </div>
      <div className="legend">
        {SERIES.map((s) => (
          <button
            key={s.label}
            className={`legend-item${hidden.has(s.label) ? " hidden" : ""}`}
            onClick={() => toggle(s.label)}
          >
            <i style={{ background: primaryAlpha(Math.min(1, s.fill + 0.2)) }} />
            {s.label}
          </button>
        ))}
      </div>
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <b>{tooltip.title}</b>
          <span>
            <i style={{ background: tooltip.color }} />
            {formatNumber(tooltip.value)} {tooltip.label.toLowerCase()}
          </span>
        </div>
      )}
    </div>
  );
}
