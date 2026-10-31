import { useState, type ReactNode } from "react";

export interface PanelTab {
  id: string;
  label: string;
  content: ReactNode;
}

export function TabsPanel({ title, tabs }: { title: string; tabs: PanelTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            className={`tab${t.id === current?.id ? " active" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.content}</div>
    </section>
  );
}
