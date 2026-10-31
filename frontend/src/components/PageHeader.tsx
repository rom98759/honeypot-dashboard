import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function LiveIndicator({ count }: { count: number }) {
  return (
    <span className="live-indicator" title="Sessions ouvertes depuis moins d'une heure">
      <span className={`status-dot${count > 0 ? " on" : ""}`} />
      {count} en cours
    </span>
  );
}
