import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import { Banner, CopyField, EmptyState, Spinner, formatDate } from "./ui";
import type { PasswordIssued, User } from "../types";

interface Props {
  users: User[];
  loading: boolean;
  reload: () => Promise<void>;
}

export default function UsersPanel({ users, loading, reload }: Props) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [autoPassword, setAutoPassword] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Passwords are shown exactly once, right after they are issued.
  const [issued, setIssued] = useState<(PasswordIssued & { action: string }) | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIssued(null);
    setBusy(true);
    try {
      const result = await api.admin.createUser({
        username: username.trim(),
        email: email.trim() || null,
        full_name: fullName.trim() || null,
        password: autoPassword ? null : password,
      });
      setIssued({ ...result, action: "created" });
      setUsername("");
      setFullName("");
      setEmail("");
      setPassword("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(user: User) {
    const custom = window.prompt(
      `Reset the password for "${user.username}".\n\n` +
        "Leave this blank to generate a strong password, or type the password you want to set " +
        "(minimum 8 characters).",
      "",
    );
    if (custom === null) return;
    if (custom && custom.length < 8) {
      setError("A password you type yourself must be at least 8 characters.");
      return;
    }

    setError(null);
    setIssued(null);
    setRowBusy(user.id);
    try {
      const result = await api.admin.resetPassword(user.id, custom || null);
      setIssued({ ...result, action: "reset" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  async function handleToggleActive(user: User) {
    setError(null);
    setRowBusy(user.id);
    try {
      await api.admin.setActive(user.id, !user.is_active);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(user: User) {
    if (
      !window.confirm(
        `Delete "${user.username}"? They will lose access immediately. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setRowBusy(user.id);
    try {
      await api.admin.deleteUser(user.id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>Create a user</h2>
            <p className="muted">
              New accounts sign in on the user login page and see the files you publish to them.
            </p>
          </div>
        </div>

        <Banner kind="error">{error}</Banner>

        {issued ? (
          <div className="banner banner--success">
            <p>
              Password {issued.action} for <strong>{issued.user.username}</strong>. Copy it now —
              it is not shown again.
            </p>
            <CopyField value={issued.password} />
          </div>
        ) : null}

        <form className="form" onSubmit={handleCreate}>
          <div className="field-row">
            <label className="field">
              <span>Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                required
              />
            </label>
            <label className="field">
              <span>
                Full name <em>(optional)</em>
              </span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="field">
              <span>
                Email <em>(optional)</em>
              </span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoPassword}
              onChange={(e) => setAutoPassword(e.target.checked)}
            />
            <span>Generate a strong password for me</span>
          </label>

          {!autoPassword ? (
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
          ) : null}

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create user"}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>Users</h2>
            <p className="muted">
              {users.length} account{users.length === 1 ? "" : "s"}
            </p>
          </div>
          <button className="btn btn--ghost" type="button" onClick={() => void reload()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading users" />
        ) : users.length === 0 ? (
          <EmptyState title="No users yet" hint="Create one with the form above." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last login</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.is_active ? "" : "row--muted"}>
                    <td>
                      <span className="file-name">{user.username}</span>
                      {user.full_name ? <span className="file-note">{user.full_name}</span> : null}
                    </td>
                    <td>{user.email ?? "—"}</td>
                    <td>
                      <span className={`pill ${user.is_active ? "pill--ok" : "pill--off"}`}>
                        {user.is_active ? "Active" : "Disabled"}
                      </span>
                      {user.must_change_password ? (
                        <span className="pill pill--warn">Temp password</span>
                      ) : null}
                    </td>
                    <td>{formatDate(user.created_at)}</td>
                    <td>{user.last_login_at ? formatDate(user.last_login_at) : "Never"}</td>
                    <td className="cell--actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={rowBusy === user.id}
                        onClick={() => void handleReset(user)}
                      >
                        Reset password
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={rowBusy === user.id}
                        onClick={() => void handleToggleActive(user)}
                      >
                        {user.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        type="button"
                        disabled={rowBusy === user.id}
                        onClick={() => void handleDelete(user)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
