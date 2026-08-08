import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { api } from "../lib/api";

export function VerifyEmail() {
  const token = new URLSearchParams(useLocation().search).get("token") ?? "";
  const [state, setState] = useState<"loading" | "success" | "error">(
    "loading",
  );
  useEffect(() => {
    api.verifyEmail(token).then(
      () => setState("success"),
      () => setState("error"),
    );
  }, [token]);
  return (
    <TokenPage title="Verify your email">
      <div
        className={state === "error" ? "form-error" : "success-state"}
        role="status"
      >
        {state === "loading"
          ? "Verifying…"
          : state === "success"
            ? "Your email is verified."
            : "This verification link is invalid or has expired."}
      </div>
      <Link to="/app">Continue to Airem</Link>
    </TokenPage>
  );
}

export function ResetPassword() {
  const token = new URLSearchParams(useLocation().search).get("token") ?? "";
  const [state, setState] = useState<"form" | "success" | "error">("form");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    try {
      await api.completePasswordReset(token, password);
      setState("success");
    } catch {
      setState("error");
    }
  }
  return (
    <TokenPage title="Choose a new password">
      {state === "success" ? (
        <div className="success-state" role="status">
          Password updated. Your existing sessions have been signed out.
          <br />
          <Link to="/login">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          {state === "error" && (
            <div className="form-error" role="alert">
              This reset link is invalid or has expired.
            </div>
          )}
          <label>
            New password
            <div className="input-wrap">
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </div>
          </label>
          <button className="button primary auth-submit">Reset password</button>
        </form>
      )}
    </TokenPage>
  );
}
function TokenPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <Logo tone="light" />
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <h2>{title}</h2>
          {children}
        </div>
      </section>
    </main>
  );
}
