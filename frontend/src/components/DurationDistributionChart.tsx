import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";
import { ChartErrorBoundary } from "./TimelineChart";
import { useTheme } from "../theme/ThemeContext";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface DurationBucket {
  bucket: string;
  n: number;
}

export function DurationDistributionChart({ distribution }: { distribution: DurationBucket[] }) {
  const [theme] = useTheme();
  // Re-read the theme's CSS custom properties on every theme toggle so the chart
  // stays in sync with dark/light mode instead of hardcoding light-mode colors.
  const styles = getComputedStyle(document.documentElement);
  const borderColor = styles.getPropertyValue("--border").trim();
  const textSecondary = styles.getPropertyValue("--text-secondary").trim();
  const accent = styles.getPropertyValue("--accent").trim();
  void theme;
  const data = {
    labels: distribution.map((d) => d.bucket),
    datasets: [
      {
        label: "Sessions",
        data: distribution.map((d) => d.n),
        backgroundColor: accent,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: textSecondary } },
      y: {
        beginAtZero: true,
        grid: { color: borderColor },
        ticks: { precision: 0, color: textSecondary },
      },
    },
  };
  return (
    <ChartErrorBoundary>
      <Bar data={data} options={options} />
    </ChartErrorBoundary>
  );
}
