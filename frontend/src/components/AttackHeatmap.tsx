// frontend/src/components/AttackHeatmap.tsx
export interface HeatmapCell {
  day_of_week: number;
  hour: number;
  n: number;
}

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export function AttackHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const byKey = new Map(cells.map((c) => [`${c.day_of_week}-${c.hour}`, c.n]));
  const maxN = Math.max(...cells.map((c) => c.n), 0);

  return (
    <div className="heatmap">
      <div className="heatmap-hour-labels">
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour}>{hour % 6 === 0 ? `${hour}h` : ""}</span>
        ))}
      </div>
      {DAY_LABELS.map((dayLabel, dayOfWeek) => (
        <div className="heatmap-row" key={dayOfWeek}>
          <span className="heatmap-day-label">{dayLabel}</span>
          <div className="heatmap-row-cells">
            {Array.from({ length: 24 }, (_, hour) => {
              const n = byKey.get(`${dayOfWeek}-${hour}`) ?? 0;
              return (
                <div
                  key={hour}
                  data-testid="heatmap-cell"
                  className="heatmap-cell"
                  style={{ opacity: maxN ? n / maxN : 0 }}
                  title={`${dayLabel} ${hour}h : ${n} session${n === 1 ? "" : "s"}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
