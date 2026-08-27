import { useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { useAuth } from "../auth";
import Shell from "../components/Shell";
import ChangePassword from "../components/ChangePassword";
import {
  Banner,
  EmptyState,
  Spinner,
  expiryTone,
  formatBytes,
  formatDate,
  formatRemaining,
} from "../components/ui";
import type { PortalFile } from "../types";

export default function UserDashboard() {
  const { user } = useAuth();
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collected, setCollected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFiles(await api.listFiles());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A PDF is only marked collected once the browser actually fetches the bytes,
  // which happens in another tab — so re-sync when the user comes back here.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // A password issued by an administrator is temporary; nudge until it changes.
  useEffect(() => {
    if (user?.must_change_password) setShowPasswordForm(true);
  }, [user?.must_change_password]);

  async function handleDownload(file: PortalFile) {
    setBusyId(file.id);
    setError(null);
    setCollected(null);
    try {
      await downloadFile(file.id);
      if (file.is_pdf) {
        setCollected(
          `"${file.original_name}" has been sent to your downloads and removed from this list. ` +
            "Save it somewhere safe — it will not appear here again.",
        );
      }
      // Give the browser a moment to start the transfer, then re-sync the list.
      window.setTimeout(() => void load(), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell
      subtitle="My files"
      actions={
        <button
          className="btn btn--ghost"
          type="button"
          onClick={() => setShowPasswordForm((v) => !v)}
        >
          {showPasswordForm ? "Hide password form" : "Change password"}
        </button>
      }
    >
      {user?.must_change_password ? (
        <Banner kind="info">
          You are still using the temporary password issued by your administrator. Please set your
          own password below.
        </Banner>
      ) : null}

      {showPasswordForm ? (
        <section className="panel">
          <h2>Change password</h2>
          <ChangePassword onDone={() => setShowPasswordForm(false)} />
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>Files shared with you</h2>
            <p className="muted">
              {files.length === 0
                ? "Nothing here yet."
                : `${files.length} file${files.length === 1 ? "" : "s"} available.`}
            </p>
          </div>
          <button className="btn btn--ghost" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        <Banner kind="info">
          Download a <strong>PDF once</strong> and it leaves this list for good — keep your own
          copy. Every file is deleted automatically <strong>5 days after it was uploaded</strong>,
          collected or not.
        </Banner>

        <Banner kind="error">{error}</Banner>
        <Banner kind="success">{collected}</Banner>

        {loading ? (
          <Spinner label="Loading your files" />
        ) : files.length === 0 ? (
          <EmptyState
            title="No files waiting"
            hint="Anything your administrator publishes to you will appear here."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Shared on</th>
                  <th>Deleted in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <span className="file-name">{file.original_name}</span>
                      {file.notes ? <span className="file-note">{file.notes}</span> : null}
                      {file.is_pdf ? (
                        <span className="file-note">Leaves this list once downloaded</span>
                      ) : null}
                    </td>
                    <td>{formatBytes(file.size_bytes)}</td>
                    <td>{formatDate(file.created_at)}</td>
                    <td>
                      <span className={`pill pill--${expiryTone(file.seconds_remaining)}`}>
                        {formatRemaining(file.seconds_remaining)}
                      </span>
                    </td>
                    <td className="cell--actions">
                      <button
                        className="btn btn--primary btn--sm"
                        type="button"
                        disabled={busyId === file.id}
                        onClick={() => void handleDownload(file)}
                      >
                        {busyId === file.id ? "Preparing…" : "Download"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
