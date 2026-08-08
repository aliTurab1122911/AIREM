import { FormEvent, useState } from "react";
import { ArrowLeft, LoaderCircle, LockKeyhole, Mail, User } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

export function Auth() {
  const location = useLocation(),
    path = location.pathname,
    navigate = useNavigate(),
    isLogin = path === "/login",
    isRegister = path === "/register",
    { refreshSession } = useAuth();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const values = new FormData(e.currentTarget);
    try {
      if (isLogin)
        await api.login(
          String(values.get("email")),
          String(values.get("password")),
        );
      else if (isRegister)
        await api.register(
          String(values.get("name")),
          String(values.get("email")),
          String(values.get("password")),
        );
      else {
        await api.forgotPassword(String(values.get("email")));
        setSent(true);
        return;
      }
      const user = await refreshSession();
      if (!user) throw new Error("Session was not established");
      const requested = (
        location.state as {
          from?: { pathname?: string; search?: string; hash?: string };
        } | null
      )?.from;
      navigate(
        requested?.pathname?.startsWith("/app")
          ? `${requested.pathname}${requested.search ?? ""}${requested.hash ?? ""}`
          : "/app",
        { replace: true },
      );
    } catch {
      setError(
        "We couldn’t complete that request. Please check your details and try again.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <Logo tone="light" />
        <div>
          <span className="pill">Write with confidence</span>
          <h1>
            Better writing,
            <br />
            still unmistakably you.
          </h1>
          <p>
            A focused workspace that helps you refine ideas and make every
            sentence count.
          </p>
        </div>
        <small>© 2026 Airem. Thoughtful tools for better writing.</small>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> Back to home
          </Link>
          <p className="eyebrow">
            {isLogin
              ? "Welcome back"
              : isRegister
                ? "Join Airem"
                : "Account recovery"}
          </p>
          <h2>
            {isLogin
              ? "Sign in to your account"
              : isRegister
                ? "Create your account"
                : "Reset your password"}
          </h2>
          <p>
            {isLogin
              ? "Continue to your writing workspace."
              : isRegister
                ? "Start improving your writing in minutes."
                : "We’ll send a reset link to your inbox."}
          </p>
          {sent ? (
            <div className="success-state" role="status">
              <Mail />
              <h3>Check your inbox</h3>
              <p>
                If an account exists for that email, a reset link is on its way.
              </p>
              <Link to="/login">Return to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              {isRegister && (
                <label>
                  Full name
                  <div className="input-wrap">
                    <User />
                    <input
                      name="name"
                      autoComplete="name"
                      minLength={DISPLAY_NAME_MIN_LENGTH}
                      maxLength={DISPLAY_NAME_MAX_LENGTH}
                      required
                      placeholder="Alex Morgan"
                    />
                  </div>
                </label>
              )}
              <label>
                Email address
                <div className="input-wrap">
                  <Mail />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </div>
              </label>
              {(isLogin || isRegister) && (
                <label>
                  <span>
                    Password{" "}
                    {isLogin && (
                      <Link to="/forgot-password">Forgot password?</Link>
                    )}
                  </span>
                  <div className="input-wrap">
                    <LockKeyhole />
                    <input
                      type="password"
                      name="password"
                      autoComplete={
                        isLogin ? "current-password" : "new-password"
                      }
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={PASSWORD_MAX_LENGTH}
                      required
                      placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                    />
                  </div>
                </label>
              )}
              <button className="button primary auth-submit" disabled={loading}>
                {loading ? (
                  <>
                    <LoaderCircle className="spin" />
                    Please wait…
                  </>
                ) : isLogin ? (
                  "Sign in"
                ) : isRegister ? (
                  "Create account"
                ) : (
                  "Send reset link"
                )}
              </button>
            </form>
          )}
          <div className="auth-switch">
            {isLogin ? (
              <>
                New to Airem? <Link to="/register">Create an account</Link>
              </>
            ) : isRegister ? (
              <>
                Already have an account? <Link to="/login">Sign in</Link>
              </>
            ) : (
              <Link to="/login">Remembered your password?</Link>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
