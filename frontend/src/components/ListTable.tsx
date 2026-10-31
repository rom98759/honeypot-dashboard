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

// Umami's ListTable: "label | bold value | divider | muted share" rows; the share is relative
// to the rows shown, as in Umami's percentFilter.
export function ListTable({ title, metric, rows }: { title: string; metric: string; rows: ListRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);

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
            <div className="list-pct">{total ? Math.round((row.value / total) * 100) : 0}%</div>
          </div>
        ))
      )}
    </div>
  );
}
