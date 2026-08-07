import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const logout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login", { replace: true });
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
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
