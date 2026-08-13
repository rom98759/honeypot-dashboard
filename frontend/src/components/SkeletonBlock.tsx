export function SkeletonBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-block">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-line" key={i} />
      ))}
    </div>
  );
}
