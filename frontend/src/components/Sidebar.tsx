import {
  BarChart3,
  ChevronLeft,
  CreditCard,
  FilePlus2,
  Files,
  Home,
  LogOut,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { Logo } from "./brand/Logo";
import { useAuth } from "../auth/AuthContext";

const links = [
  { to: "/app", label: "Home", icon: Home, end: true },
  { to: "/app/rewrite", label: "New rewrite", icon: FilePlus2 },
  { to: "/app/documents", label: "Documents", icon: Files },
  { to: "/app/reports", label: "Reports", icon: BarChart3 },
  { to: "/app/billing", label: "Usage & plan", icon: CreditCard },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

interface Props {
  collapsed: boolean;
  open: boolean;
  onCollapse: () => void;
  onClose: () => void;
  onLogout: () => void;
}
export function Sidebar({
  collapsed,
  open,
  onCollapse,
  onClose,
  onLogout,
}: Props) {
  const { user } = useAuth();
  const name = user?.displayName || user?.email || "Account";
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <>
      {open && (
        <button
          className="sidebar-scrim"
          onClick={onClose}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={`sidebar ${collapsed ? "is-collapsed" : ""} ${open ? "is-open" : ""}`}
      >
        <div className="sidebar-head">
          <Logo variant={collapsed ? "mark" : "wordmark"} tone="light" />
          <button
            className="collapse-button"
            onClick={onCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft className={collapsed ? "rotated" : ""} size={18} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
              title={collapsed ? label : undefined}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-account">
          <div className="avatar">{initials}</div>
          {!collapsed && (
            <div>
              <strong>{name}</strong>
              <span>{user?.email}</span>
            </div>
          )}
          <button aria-label="Log out" onClick={onLogout}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
    </>
  );
}
