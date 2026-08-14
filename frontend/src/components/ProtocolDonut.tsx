import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { ChartErrorBoundary } from "./TimelineChart";

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

export function ProtocolDonut({ protocolSplit }: { protocolSplit: ProtocolCount[] }) {
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
    plugins: { legend: { position: "bottom" as const } },
  };
  return (
    <ChartErrorBoundary>
      <Doughnut data={data} options={options} />
    </ChartErrorBoundary>
  );
}
