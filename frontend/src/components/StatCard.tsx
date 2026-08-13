export function StatCard({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className={`card${danger ? " card-danger" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
