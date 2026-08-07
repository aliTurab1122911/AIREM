import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}><Sidebar collapsed={collapsed} open={mobileOpen} onCollapse={() => setCollapsed(v => !v)} onClose={() => setMobileOpen(false)}/><div className="app-column"><Topbar onMenu={() => setMobileOpen(true)}/><main className="app-main"><Outlet/></main></div></div>
}
