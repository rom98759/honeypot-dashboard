import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { formatLongNumber, formatNumber } from "../utils/format";

export interface ListRow {
  key: string;
  label: ReactNode;
  value: number;
  onClick?: () => void;
  title?: string;
}

export function formatShare(value: number, total: number): string {
  if (!total) return "0%";
  const pct = (value / total) * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

// Umami's ListTable: "label | bold value | divider | muted share" rows. Pass `total` whenever the
// rows are a top N: a share of the visible rows alone overstates every one of them.
export function ListTable({
  title,
  metric,
  rows,
  total: realTotal,
}: {
  title: string;
  metric: string;
  rows: ListRow[];
  total?: number;
}) {
  const total = realTotal ?? rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <div className="list-table">
      <div className="list-head">
        <span>{title}</span>
        <span>{metric}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState message="Aucune donnée" />
      ) : (
        rows.map((row) => (
          <div
            key={row.key}
            className={`list-row${row.onClick ? " clickable" : ""}`}
            onClick={row.onClick}
            onKeyDown={(e) => {
              if (row.onClick && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                row.onClick();
              }
            }}
            role={row.onClick ? "button" : undefined}
            tabIndex={row.onClick ? 0 : undefined}
            title={row.title}
          >
            <div className="list-label">{row.label}</div>
            <div className="list-value" title={formatNumber(row.value)}>
              {formatLongNumber(row.value)}
            </div>
            <div className="list-pct">{formatShare(row.value, total)}</div>
          </div>
        ))
      )}
    </div>
  );
}
