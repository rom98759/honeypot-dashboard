import { ArrowDown, ArrowUp } from "lucide-react";

export function ChangeLabel({ change, reverseColors = false }: { change: number; reverseColors?: boolean }) {
  const neutral = !Number.isFinite(change) || Math.round(change) === 0;
  const up = change > 0;
  const good = reverseColors ? !up : up;
  const tone = neutral ? "neutral" : good ? "positive" : "negative";
  return (
    <span className={`change-label ${tone}`} data-testid="change-label">
      {!neutral && (up ? <ArrowUp aria-label="hausse" /> : <ArrowDown aria-label="baisse" />)}
      {Math.abs(Math.round(neutral ? 0 : change))}%
    </span>
  );
}

export function MetricCard({
  label,
  value,
  change,
  reverseColors,
}: {
  label: string;
  value: string;
  change?: number | null;
  reverseColors?: boolean;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {change != null && <ChangeLabel change={change} reverseColors={reverseColors} />}
    </div>
  );
}
