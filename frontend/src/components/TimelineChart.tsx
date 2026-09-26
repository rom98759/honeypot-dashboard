import { Component, forwardRef, useMemo, useRef, type ForwardedRef, type ReactNode } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import zoomPlugin from "chartjs-plugin-zoom";
import { useTheme } from "../theme/ThemeContext";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, zoomPlugin);

export interface TimelinePoint {
  bucket: string;
  n: number;
}

export class ChartErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <>Graphique indisponible.</>;
    }
    return this.props.children;
  }
}

interface TimelineChartProps {
  timeline: TimelinePoint[];
  onRangeChange?: (range: { start: string; end: string } | null) => void;
}

export const TimelineChart = forwardRef(function TimelineChart(
  { timeline, onRangeChange }: TimelineChartProps,
  ref: ForwardedRef<ChartJS<"line"> | undefined>
) {
  const [theme] = useTheme();
  // Re-read the theme's CSS custom properties on every theme toggle so the chart
  // stays in sync with dark/light mode instead of hardcoding light-mode colors.
  const styles = getComputedStyle(document.documentElement);
  const borderColor = styles.getPropertyValue("--border").trim();
  const textSecondary = styles.getPropertyValue("--text-secondary").trim();
  void theme;

  // Keep the latest onRangeChange in a ref so the memoized `options` object's
  // identity doesn't change just because the parent passed a new function
  // reference on every render (OverviewPage re-renders every 10s).
  const onRangeChangeRef = useRef(onRangeChange);
  onRangeChangeRef.current = onRangeChange;

  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  function reportRange(chart: ChartJS) {
    const cb = onRangeChangeRef.current;
    if (!cb) return;
    const currentTimeline = timelineRef.current;
    const min = chart.scales.x.min as number;
    const max = chart.scales.x.max as number;
    const isFullRange = min <= 0 && max >= currentTimeline.length - 1;
    if (isFullRange) {
      cb(null);
      return;
    }
    const start = currentTimeline[Math.max(0, Math.round(min))]?.bucket;
    const end = currentTimeline[Math.min(currentTimeline.length - 1, Math.round(max))]?.bucket;
    if (start && end) cb({ start, end });
  }

  const data = useMemo(
    () => ({
      labels: timeline.map((t) => t.bucket),
      datasets: [
        {
          label: "Connexions",
          data: timeline.map((t) => t.n),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    }),
    [timeline]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        zoom: {
          pan: {
            enabled: true,
            mode: "x" as const,
            modifierKey: "ctrl" as const,
            onPanComplete: ({ chart }: { chart: ChartJS }) => reportRange(chart),
          },
          zoom: {
            drag: { enabled: true },
            mode: "x" as const,
            onZoomComplete: ({ chart }: { chart: ChartJS }) => reportRange(chart),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textSecondary } },
        y: { beginAtZero: true, grid: { color: borderColor }, ticks: { color: textSecondary } },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [borderColor, textSecondary]
  );

  return (
    <ChartErrorBoundary>
      <Line ref={ref} data={data} options={options} />
    </ChartErrorBoundary>
  );
});
