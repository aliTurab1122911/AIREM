/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, AUTH_REQUIRED_EVENT, type AuthUser } from "../lib/api";

type SessionState = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: AuthUser | null;
  status: SessionState;
  refreshSession: () => Promise<AuthUser | null>;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<SessionState>("loading");

  const clearSession = useCallback(() => {
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const refreshSession = useCallback(async () => {
    setStatus("loading");
    try {
      const session = await api.session();
      setUser(session.user);
      setStatus("authenticated");
      return session.user;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    window.addEventListener(AUTH_REQUIRED_EVENT, clearSession);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, clearSession);
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, status, refreshSession, clearSession }),
    [user, status, refreshSession, clearSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function SessionLoadingScreen() {
  return (
    <main
      className="session-loading"
      aria-busy="true"
      aria-label="Loading session"
    >
      <span className="spinner" />
      <p>Loading your workspace…</p>
    </main>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <SessionLoadingScreen />;
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

export function GuestRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <SessionLoadingScreen />;
  if (status === "authenticated") {
    const requested = (
      location.state as { from?: { pathname?: string } } | null
    )?.from?.pathname;
    return (
      <Navigate
        to={requested?.startsWith("/app") ? requested : "/app"}
        replace
      />
    );
  }
  return children;
}
