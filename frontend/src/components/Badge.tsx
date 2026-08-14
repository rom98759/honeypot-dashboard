export type BadgeTone = "danger" | "warning" | "neutral" | "success";

export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
