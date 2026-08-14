import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";
import { ChartErrorBoundary } from "./TimelineChart";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface BansBucket {
  bucket: string;
  n: number;
}

export function BansBarChart({ bansTimeline }: { bansTimeline: BansBucket[] }) {
  const data = {
    labels: bansTimeline.map((b) => b.bucket),
    datasets: [
      {
        label: "Bans",
        data: bansTimeline.map((b) => b.n),
        backgroundColor: "#dc2626",
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: "#e5e7eb" }, ticks: { precision: 0 } },
    },
  };
  return (
    <ChartErrorBoundary>
      <Bar data={data} options={options} />
    </ChartErrorBoundary>
  );
}
