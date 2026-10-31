import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, type ChartEvent, type ActiveElement } from "chart.js";
import { Bar } from "react-chartjs-2";
import { ChartErrorBoundary } from "./ChartErrorBoundary";
import { chartTheme } from "../theme/chartTheme";
import { useTheme } from "../theme/ThemeContext";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface BansBucket {
  bucket: string;
  n: number;
}

export function BansBarChart({
  bansTimeline,
  onBarClick,
}: {
  bansTimeline: BansBucket[];
  onBarClick?: (bucket: string) => void;
}) {
  const [theme] = useTheme();
  const { line: borderColor, text: textSecondary } = chartTheme(theme);
  const data = {
    labels: bansTimeline.map((b) => b.bucket),
    datasets: [
      {
        label: "Bans",
        data: bansTimeline.map((b) => b.n),
        backgroundColor: "rgba(229, 72, 77, 0.5)",
        hoverBackgroundColor: "rgba(229, 72, 77, 0.8)",
        borderColor: "rgba(229, 72, 77, 0.8)",
        borderWidth: 1,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, border: { color: borderColor }, ticks: { color: textSecondary, maxRotation: 0 } },
      y: {
        beginAtZero: true,
        grid: { color: borderColor },
        border: { color: borderColor },
        ticks: { precision: 0, color: textSecondary },
      },
    },
    onClick: onBarClick
      ? (event: ChartEvent, _elements: ActiveElement[], chart: ChartJS) => {
          const hits = chart.getElementsAtEventForMode(
            event.native as MouseEvent,
            "nearest",
            { intersect: true },
            true
          );
          if (hits.length) onBarClick(bansTimeline[hits[0].index].bucket);
        }
      : undefined,
  };
  return (
    <ChartErrorBoundary>
      <Bar data={data} options={options} />
    </ChartErrorBoundary>
  );
}
