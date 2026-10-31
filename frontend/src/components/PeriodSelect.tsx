import type { OverviewPeriod } from "../api/types";

export const PERIOD_OPTIONS: { value: OverviewPeriod; label: string }[] = [
  { value: "24h", label: "Dernières 24 heures" },
  { value: "7d", label: "7 derniers jours" },
  { value: "30d", label: "30 derniers jours" },
  { value: "all", label: "Tout l'historique" },
];

export function PeriodSelect({ value, onChange }: { value: OverviewPeriod; onChange: (p: OverviewPeriod) => void }) {
  return (
    <select
      className="select"
      aria-label="Période"
      value={value}
      onChange={(e) => onChange(e.target.value as OverviewPeriod)}
    >
      {PERIOD_OPTIONS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
