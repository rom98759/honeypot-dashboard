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
import { useTheme } from "../theme/ThemeContext";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

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

export function TimelineChart({ timeline }: { timeline: TimelinePoint[] }) {
  const [theme] = useTheme();
  // Re-read the theme's CSS custom properties on every theme toggle so the chart
  // stays in sync with dark/light mode instead of hardcoding light-mode colors.
  const styles = getComputedStyle(document.documentElement);
  const borderColor = styles.getPropertyValue("--border").trim();
  const textSecondary = styles.getPropertyValue("--text-secondary").trim();
  void theme;
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
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: textSecondary } },
      y: { beginAtZero: true, grid: { color: borderColor }, ticks: { color: textSecondary } },
    },
  };
  return (
    <ChartErrorBoundary>
      <Line data={data} options={options} />
    </ChartErrorBoundary>
  );
}
