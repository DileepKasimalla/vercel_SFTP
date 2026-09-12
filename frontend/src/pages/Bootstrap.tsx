import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Shell from "../components/Shell";
import { Banner, Product } from "../components/ui";
import type { BootstrapStatus } from "../types";

interface Props {
  status: BootstrapStatus | null;
  onCompleted: (status: BootstrapStatus) => void;
}

export default function BootstrapPage({ status, onCompleted }: Props) {
  const { adopt } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bootstrap closes for good once the first administrator exists.
  if (status && !status.needs_bootstrap) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for the administrator password.");
      return;
    }

    setBusy(true);
    try {
      const session = await api.bootstrap({
        username: username.trim(),
        password,
        email: email.trim() || null,
        full_name: fullName.trim() || null,
        bootstrap_token: bootstrapToken.trim() || null,
      });
      adopt(session);
      onCompleted({
        needs_bootstrap: false,
        requires_token: status?.requires_token ?? false,
        storage_backend: status?.storage_backend ?? "local",
        max_upload_mb: status?.max_upload_mb ?? 50,
        direct_upload: status?.direct_upload ?? false,
      });
      navigate("/admin", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Product />
      <h1 className="screen-title">First-Run Setup</h1>
      <div className="section" style={{ maxWidth: 640 }}>
        <p>
          This portal has no administrator yet. The account you create here owns user management
          and document uploads. Once it exists, this page closes permanently.
        </p>

        <Banner kind="error">{error}</Banner>

        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Full name <em>(optional)</em></span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>

          <label className="field">
            <span>Email <em>(optional)</em></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          </div>

          {status?.requires_token ? (
            <label className="field">
              <span>Bootstrap token</span>
              <input
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                placeholder="Value of the BOOTSTRAP_TOKEN environment variable"
                required
              />
            </label>
          ) : null}

          <div className="actions actions--inline">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Creating administrator…" : "Create Administrator"}
            </button>
          </div>
        </form>

        <p className="footnote">
          Already set up? <Link to="/admin/login">Administrator Login</Link>
        </p>
      </div>
    </Shell>
  );
}
