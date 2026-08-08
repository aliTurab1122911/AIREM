import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const navigate = useNavigate();
  const logout = async () => {
    setLogoutError("");
    try {
      await api.logout();
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("Log out failed. Please try again.");
    }
  };
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        collapsed={collapsed}
        open={mobileOpen}
        onCollapse={() => setCollapsed((v) => !v)}
        onClose={() => setMobileOpen(false)}
        onLogout={() => void logout()}
      />
      <div className="app-column">
        <Topbar onMenu={() => setMobileOpen(true)} />
        {logoutError && (
          <div className="form-error" role="alert">
            {logoutError}
          </div>
        )}
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
