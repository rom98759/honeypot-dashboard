import { NavLink } from "react-router-dom";
import { Shield, BarChart2, List, Terminal, Link2, Globe, Sun, Moon } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", Icon: BarChart2 },
  { to: "/sessions", label: "Sessions", Icon: List },
  { to: "/commands", label: "Commandes", Icon: Terminal },
  { to: "/correlation", label: "Corrélation", Icon: Link2 },
  { to: "/map", label: "Carte", Icon: Globe },
];

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
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Icon />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
