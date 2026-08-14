export function StatCard({
  label,
  value,
  danger = false,
  small = false,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`card${danger ? " card-danger" : ""}`}>
      <span>{label}</span>
      <b className={small ? "card-value-small" : undefined}>{value}</b>
    </div>
  );
}
