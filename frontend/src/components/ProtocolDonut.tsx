import { Chart as ChartJS, ArcElement, Tooltip, Legend, type ChartEvent, type ActiveElement } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { ChartErrorBoundary } from "./TimelineChart";
import { useTheme } from "../theme/ThemeContext";

ChartJS.register(ArcElement, Tooltip, Legend);

export interface ProtocolCount {
  protocol: string;
  n: number;
}

const PROTOCOL_LABELS: Record<string, string> = {
  ssh: "SSH",
  telnet: "Telnet",
};

const PROTOCOL_COLORS: Record<string, string> = {
  ssh: "#2563eb",
  telnet: "#d97706",
};

export function ProtocolDonut({
  protocolSplit,
  onSliceClick,
}: {
  protocolSplit: ProtocolCount[];
  onSliceClick?: (protocol: string) => void;
}) {
  const [theme] = useTheme();
  // Re-read the theme's CSS custom properties on every theme toggle so the chart
  // stays in sync with dark/light mode instead of using Chart.js's low-contrast defaults.
  const styles = getComputedStyle(document.documentElement);
  const textSecondary = styles.getPropertyValue("--text-secondary").trim();
  void theme;
  const data = {
    labels: protocolSplit.map((p) => PROTOCOL_LABELS[p.protocol] ?? p.protocol),
    datasets: [
      {
        data: protocolSplit.map((p) => p.n),
        backgroundColor: protocolSplit.map((p) => PROTOCOL_COLORS[p.protocol] ?? "#6b7280"),
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" as const, labels: { color: textSecondary } },
    },
    onClick: onSliceClick
      ? (event: ChartEvent, _elements: ActiveElement[], chart: ChartJS) => {
          const hits = chart.getElementsAtEventForMode(
            event.native as MouseEvent,
            "nearest",
            { intersect: true },
            true
          );
          if (hits.length) onSliceClick(protocolSplit[hits[0].index].protocol);
        }
      : undefined,
  };
  return (
    <ChartErrorBoundary>
      <Doughnut data={data} options={options} />
    </ChartErrorBoundary>
  );
}
