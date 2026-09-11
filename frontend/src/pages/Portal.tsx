import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import Shell from "../components/Shell";
import { Banner, Product, Spinner } from "../components/ui";
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
    <Shell>
      <Product />
      <h1 className="screen-title">Welcome</h1>

      {statusError ? (
        <Banner kind="error">
          Cannot reach the API: {statusError}. Check that the backend is running and that
          DATABASE_URL is set.
        </Banner>
      ) : null}

      {!status && !statusError ? <Spinner label="Checking portal status" /> : null}

      <div className="section">
        <p>Please select a login:</p>
        <ul>
          <li>
            <Link to="/login">User Login</Link> — collect the documents placed in your mailbox
          </li>
          <li>
            <Link to="/admin/login">Administrator Login</Link> — manage users and documents
          </li>
        </ul>
      </div>

      {status ? (
        <p className="footnote muted">Storage backend: {status.storage_backend}</p>
      ) : null}
    </Shell>
  );
}
