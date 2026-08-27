import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Banner, Brand } from "../components/ui";
import type { BootstrapStatus, Role } from "../types";

interface Props {
  role: Role;
  status: BootstrapStatus | null;
}

const COPY: Record<Role, { heading: string; blurb: string; home: string }> = {
  admin: {
    heading: "Administrator login",
    blurb: "Manage portal users and publish files to their dashboards.",
    home: "/admin",
  },
  user: {
    heading: "User login",
    blurb: "Sign in with the credentials your administrator issued to you.",
    home: "/dashboard",
  },
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

  return (
    <div className="page page--centered">
      <div className={`card card--narrow ${role === "admin" ? "card--admin" : "card--user"}`}>
        <Brand subtitle={role === "admin" ? "Administrator" : "User"} />
        <h1>{copy.heading}</h1>
        <p className="muted">{copy.blurb}</p>

        <Banner kind="error">{error}</Banner>

        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="footnote">
          {role === "admin" ? (
            <>
              Not an administrator? <Link to="/login">Use the user login</Link>
            </>
          ) : (
            <>
              Administrator? <Link to="/admin/login">Use the admin login</Link>
            </>
          )}
          {" · "}
          <Link to="/">Portal home</Link>
        </p>
      </div>
    </div>
  );
}
