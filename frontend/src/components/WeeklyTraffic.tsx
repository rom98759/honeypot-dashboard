import type { HeatmapCell } from "../api/types";
import { formatNumber } from "../utils/format";

// Monday first, as in a French locale; values are SQLite %w (0 = Sunday).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Backend cells are in UTC; shift them to the viewer's local day and hour. */
export function toLocalGrid(cells: HeatmapCell[], offsetMinutes = -new Date().getTimezoneOffset()): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const offsetHours = Math.round(offsetMinutes / 60);
  for (const c of cells) {
    const absolute = c.day_of_week * 24 + c.hour + offsetHours;
    const wrapped = ((absolute % 168) + 168) % 168;
    grid[Math.floor(wrapped / 24)][wrapped % 24] += c.n;
  }
  return grid;
}

export function WeeklyTraffic({ cells }: { cells: HeatmapCell[] }) {
  const grid = toLocalGrid(cells);
  const max = Math.max(1, ...grid.flat());

  return (
    <div className="weekly" role="grid" aria-label="Sessions par jour et par heure">
      <span />
      {DAY_ORDER.map((d) => (
        <span key={d} className="weekly-day">
          {DAY_LABELS[d]}
        </span>
      ))}
      {Array.from({ length: 24 }, (_, hour) => (
        <Row key={hour} hour={hour} grid={grid} max={max} />
      ))}
    </div>
  );
}

function Row({ hour, grid, max }: { hour: number; grid: number[][]; max: number }) {
  return (
    <>
      <span className="weekly-hour">{`${hour}h`}</span>
      {DAY_ORDER.map((d) => {
        const count = grid[d][hour];
        const pct = count / max;
        return (
          <span
            key={d}
            className="weekly-cell"
            title={count ? `${DAY_LABELS[d]} ${hour}h : ${formatNumber(count)} sessions` : undefined}
            data-count={count}
          >
            <i style={{ opacity: pct, transform: `scale(${pct})` }} />
          </span>
        );
      })}
    </>
  );
}
