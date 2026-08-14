import { NavLink } from "react-router-dom";
import { Shield, BarChart2, List, Link2, Globe } from "lucide-react";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", Icon: BarChart2 },
  { to: "/sessions", label: "Sessions", Icon: List },
  { to: "/correlation", label: "Corrélation", Icon: Link2 },
  { to: "/map", label: "Carte", Icon: Globe },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="brand">
        <Shield />
        <span>Honeypot</span>
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
