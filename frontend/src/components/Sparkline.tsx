const WIDTH = 90;
const HEIGHT = 20;

export function Sparkline({ values, muted = false }: { values: number[]; muted?: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const step = WIDTH / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(HEIGHT - 2 - (v / max) * (HEIGHT - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className={`sparkline${muted ? " muted" : ""}`} width={WIDTH} height={HEIGHT} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}
