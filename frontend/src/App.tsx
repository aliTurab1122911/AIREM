import { Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute, ProtectedRoute } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { Auth } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";
import { ResetPassword, VerifyEmail } from "./pages/TokenAuth";
import { RewriteStudio } from "./pages/RewriteStudio";
import { Documents, Reports, Settings, Usage } from "./pages/WorkspacePages";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/login"
        element={
          <GuestRoute>
            <Auth />
          </GuestRoute>
        }
      />
      <Route
        path="/register"
        element={
          <GuestRoute>
            <Auth />
          </GuestRoute>
        }
      />
      <Route path="/forgot-password" element={<Auth />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="rewrite" element={<RewriteStudio />} />
        <Route path="documents" element={<Documents />} />
        <Route path="reports" element={<Reports />} />
        <Route path="billing" element={<Usage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
