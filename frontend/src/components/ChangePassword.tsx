import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Banner } from "./ui";

export default function ChangePassword({ onDone }: { onDone?: () => void }) {
  const { refresh } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);

    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      await refresh();
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone("Password updated.");
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <Banner kind="error">{error}</Banner>
      <Banner kind="success">{done}</Banner>
      <div className="field-row">
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className="field">
          <span>Confirm new password</span>
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
      <button className="btn btn--primary" type="submit" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
