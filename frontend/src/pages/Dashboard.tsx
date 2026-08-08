import { PenLine, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Notifications,
  PlanSummary,
  RecentDocuments,
  UsageHistory,
  UsageOverview,
  WorkflowSummary,
} from "../features/dashboard/components";
import { useDashboard } from "../features/dashboard/hooks";
import { useAuth } from "../auth/AuthContext";

export function Dashboard() {
  const { data, error, loading, refresh } = useDashboard();
  const { user } = useAuth();
  return (
    <div className="dashboard">
      <section className="welcome">
        <div>
          <p className="eyebrow">Workspace overview</p>
          <h2>
            {user?.displayName
              ? `Welcome, ${user.displayName}`
              : "Your dashboard"}
          </h2>
          <p>Usage, documents, and review activity for this account.</p>
        </div>
        <Link className="button primary desktop-cta" to="/app/rewrite">
          <PenLine size={17} />
          Start a rewrite
        </Link>
      </section>
      {error && (
        <div className="error-state" role="alert">
          <div>
            <strong>Something went wrong</strong>
            <p>We couldn't load your account dashboard.</p>
          </div>
          <button className="button secondary" onClick={() => void refresh()}>
            <RefreshCcw size={16} />
            Try again
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="metric-grid" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div className="card metric skeleton-card" key={i}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : (
        data && (
          <>
            <UsageOverview data={data} />
            <div className="dashboard-columns">
              <WorkflowSummary data={data} />
              <RecentDocuments data={data} />
            </div>
            <div className="dashboard-columns dashboard-lower">
              <UsageHistory data={data} />
              <Notifications data={data} />
            </div>
            <PlanSummary data={data} />
          </>
        )
      )}
    </div>
  );
}
