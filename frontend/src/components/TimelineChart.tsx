import { forwardRef, type ForwardedRef } from "react";
import { Component, type ReactNode } from "react";
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

  function reportRange(chart: { scales: { x: { min: number; max: number } } }) {
    if (!onRangeChange) return;
    const { min, max } = chart.scales.x;
    const isFullRange = min <= 0 && max >= timeline.length - 1;
    if (isFullRange) {
      onRangeChange(null);
      return;
    }
    const start = timeline[Math.max(0, Math.round(min))]?.bucket;
    const end = timeline[Math.min(timeline.length - 1, Math.round(max))]?.bucket;
    if (start && end) onRangeChange({ start, end });
  }

  const data = {
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
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      zoom: {
        pan: { enabled: true, mode: "x" as const },
        zoom: { drag: { enabled: true }, mode: "x" as const },
        onZoomComplete: ({ chart }: { chart: { scales: { x: { min: number; max: number } } } }) =>
          reportRange(chart),
        onPanComplete: ({ chart }: { chart: { scales: { x: { min: number; max: number } } } }) =>
          reportRange(chart),
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: textSecondary } },
      y: { beginAtZero: true, grid: { color: borderColor }, ticks: { color: textSecondary } },
    },
  };
  return (
    <ChartErrorBoundary>
      <Line ref={ref} data={data} options={options} />
    </ChartErrorBoundary>
  );
});
