import { type FormEvent, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Shield, LayoutDashboard, List, Terminal, Link2, Globe, Sun, Moon, Search } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

const NAV_SECTIONS = [
  {
    label: "Trafic",
    items: [
      { to: "/overview", label: "Vue d'ensemble", Icon: LayoutDashboard },
      { to: "/sessions", label: "Sessions", Icon: List },
      { to: "/commands", label: "Commandes", Icon: Terminal },
    ],
  },
  {
    label: "Analyse",
    items: [
      { to: "/map", label: "Carte", Icon: Globe },
      { to: "/correlation", label: "Corrélation", Icon: Link2 },
    ],
  },
];

// A plain shape check, not a validity check: any dotted-quad or colon-bearing input is treated as
// an IP and routed to the IP detail page (which renders gracefully even for an IP with no data);
// anything else is assumed to be a session id.
const IP_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|.*:.*)$/;

function GlobalSearch() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    navigate(
      IP_PATTERN.test(trimmed) ? `/ip/${encodeURIComponent(trimmed)}` : `/sessions?session=${encodeURIComponent(trimmed)}`
    );
    setValue("");
  }

  return (
    <form className="sidebar-search" onSubmit={handleSubmit}>
      <Search />
      <input
        placeholder="IP ou session..."
        aria-label="Rechercher une IP ou une session"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

export function Sidebar() {
  const [theme, toggleTheme] = useTheme();
  const themeLabel = theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre";

  return (
    <nav className="sidebar">
      <div className="brand">
        <Shield />
        <span>Honeypot</span>
      </div>
      <GlobalSearch />
      <div className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="nav-section">{section.label}</div>
            {section.items.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
                <Icon />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="btn-icon theme-toggle" onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
      </div>
    </nav>
  );
}
