import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Banner, Brand, Spinner } from "../components/ui";
import type { BootstrapStatus } from "../types";

interface Props {
  status: BootstrapStatus | null;
  statusError: string | null;
}

export default function Portal({ status, statusError }: Props) {
  const { user } = useAuth();

  if (user) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  }
  // A database with no administrator can only do one thing: bootstrap one.
  if (status?.needs_bootstrap) {
    return <Navigate to="/bootstrap" replace />;
  }

  return (
    <div className="page page--centered">
      <div className="card">
        <Brand subtitle="Secure file distribution" />

        {statusError ? (
          <Banner kind="error">
            Cannot reach the API: {statusError}. Check that the backend is running and that
            DATABASE_URL is set.
          </Banner>
        ) : null}

        {!status && !statusError ? <Spinner label="Checking portal status" /> : null}

        <h1>Choose how you want to sign in</h1>
        <p className="muted">
          Administrators manage accounts and publish files. Users sign in to collect the files
          shared with them.
        </p>

        <div className="choice-grid">
          <Link className="choice" to="/admin/login">
            <span className="choice__label">Administrator</span>
            <span className="choice__hint">Create users, reset passwords, upload files</span>
            <span className="choice__cta">Admin login &rarr;</span>
          </Link>
          <Link className="choice choice--alt" to="/login">
            <span className="choice__label">User</span>
            <span className="choice__hint">View and download the files shared with you</span>
            <span className="choice__cta">User login &rarr;</span>
          </Link>
        </div>

        {status ? (
          <p className="footnote">
            Storage backend: <strong>{status.storage_backend}</strong>
          </p>
        ) : null}
      </div>
    </div>
  );
}
