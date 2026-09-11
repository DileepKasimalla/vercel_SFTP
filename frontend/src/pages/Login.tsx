import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import Shell from "../components/Shell";
import { Banner, Product } from "../components/ui";
import type { BootstrapStatus, Role } from "../types";

interface Props {
  role: Role;
  status: BootstrapStatus | null;
}

const COPY: Record<Role, { heading: string; home: string }> = {
  admin: { heading: "Administrator Login", home: "/admin" },
  user: { heading: "User Login", home: "/dashboard" },
};

export default function LoginPage({ role, status }: Props) {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = COPY[role];

  if (user) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  }
  if (status?.needs_bootstrap) {
    return <Navigate to="/bootstrap" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const signedIn = await login(username.trim(), password, role);
      navigate(signedIn.role === "admin" ? "/admin" : "/dashboard", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function handleClear() {
    setUsername("");
    setPassword("");
    setError(null);
  }

  return (
    <Shell>
      <Product />
      <h1 className="screen-title">{copy.heading}</h1>

      <form onSubmit={handleSubmit} className="screen">
        <div className="centered-form">
          <div>
            <Banner kind="error">{error}</Banner>
            <table className="kv">
              <tbody>
                <tr>
                  <th scope="row">
                    <label htmlFor="login-user">User ID</label>
                  </th>
                  <td>
                    <input
                      id="login-user"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                      autoFocus
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    <label htmlFor="login-password">Password</label>
                  </th>
                  <td>
                    <input
                      id="login-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </td>
                </tr>
                <tr>
                  <th />
                  <td>
                    <div className="actions actions--inline">
                      <button className="btn" type="submit" disabled={busy}>
                        {busy ? "Signing in…" : "Login"}
                      </button>
                      <button className="btn" type="button" onClick={handleClear}>
                        Clear
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="footnote">
              {role === "admin" ? (
                <Link to="/login">User Login</Link>
              ) : (
                <Link to="/admin/login">Administrator Login</Link>
              )}
            </p>
          </div>
        </div>
      </form>
    </Shell>
  );
}
