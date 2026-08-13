export interface ProportionItem {
  label: string;
  n: number;
}

export function ProportionList({ items }: { items: ProportionItem[] }) {
  const max = Math.max(...items.map((i) => i.n), 1);
  return (
    <>
      {items.map((item) => (
        <div className="proportion-row" key={item.label}>
          <span className="proportion-label">{item.label}</span>
          <div className="proportion-bar">
            <div className="proportion-fill" style={{ width: `${Math.round((item.n / max) * 100)}%` }} />
          </div>
          <span className="proportion-value">{item.n}</span>
        </div>
      ))}
    </>
  );
}
