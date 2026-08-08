import { Bell, CircleHelp, Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const titles: Record<string, string> = {
  "/app": "Overview",
  "/app/rewrite": "New rewrite",
  "/app/documents": "Documents",
  "/app/reports": "Reports",
  "/app/billing": "Usage & plan",
  "/app/settings": "Settings",
};
export function Topbar({
  onMenu,
  allowance,
}: {
  onMenu: () => void;
  allowance?: { used: number; total: number };
}) {
  const location = useLocation();
  const { user } = useAuth();
  const remaining = allowance
    ? Math.max(allowance.total - allowance.used, 0).toLocaleString()
    : "—";
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button
          className="mobile-menu"
          onClick={onMenu}
          aria-label="Open navigation"
        >
          <Menu size={21} />
        </button>
        <div>
          <span>Workspace</span>
          <h1>{titles[location.pathname] ?? "Airem"}</h1>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="allowance">
          <span>Word allowance</span>
          <strong>{remaining} left</strong>
        </div>
        <button className="icon-button" aria-label="Help">
          <CircleHelp size={20} />
        </button>
        <button
          className="icon-button notification"
          aria-label={`Notifications for ${user?.displayName || user?.email}`}
        >
          <Bell size={20} />
          <span className="notification-dot" />
        </button>
      </div>
    </header>
  );
}
