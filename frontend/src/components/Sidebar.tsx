import { type FormEvent, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Shield, BarChart2, List, Terminal, Link2, Globe, Sun, Moon, Search } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", Icon: BarChart2 },
  { to: "/sessions", label: "Sessions", Icon: List },
  { to: "/commands", label: "Commandes", Icon: Terminal },
  { to: "/correlation", label: "Corrélation", Icon: Link2 },
  { to: "/map", label: "Carte", Icon: Globe },
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
      <Search size={16} />
      <input
        placeholder="IP ou session..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

export function Sidebar() {
  const [theme, toggleTheme] = useTheme();

  return (
    <nav className="sidebar">
      <div className="brand">
        <Shield />
        <span>Honeypot</span>
        <button
          className="btn-icon theme-toggle"
          onClick={toggleTheme}
          title={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
      </div>
      <GlobalSearch />
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Icon />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
