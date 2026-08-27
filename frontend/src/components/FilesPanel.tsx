import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api, downloadFile } from "../api";
import {
  Banner,
  EmptyState,
  Spinner,
  expiryTone,
  formatBytes,
  formatDate,
  formatRemaining,
} from "./ui";
import type { PortalFile, User } from "../types";

interface Props {
  files: PortalFile[];
  users: User[];
  loading: boolean;
  reload: () => Promise<void>;
}

export default function FilesPanel({ files, users, loading, reload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [shareWithAll, setShareWithAll] = useState(true);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  function addFiles(incoming: FileList | null) {
    if (!incoming?.length) return;
    const next = Array.from(incoming);
    setSelected((current) => {
      // De-duplicate by name+size so re-picking the same file does not queue it twice.
      const seen = new Set(current.map((f) => `${f.name}:${f.size}`));
      return [...current, ...next.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files);
    event.target.value = "";
  }

  function removeAt(index: number) {
    setSelected((current) => current.filter((_, i) => i !== index));
  }

  function toggleAssignee(userId: string) {
    setAssignedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (selected.length === 0) {
      setError("Choose at least one file to upload.");
      return;
    }
    if (!shareWithAll && assignedIds.length === 0) {
      setError("Pick at least one user, or share the upload with everyone.");
      return;
    }

    setBusy(true);
    try {
      const response = await api.admin.upload(selected, notes, shareWithAll ? [] : assignedIds);
      const parts = [`Uploaded ${response.uploaded.length} file(s).`];
      if (response.failed.length) {
        parts.push(
          "Skipped: " + response.failed.map((f) => `${f.name} (${f.error})`).join(", ") + ".",
        );
      }
      setResult(parts.join(" "));
      setSelected([]);
      setNotes("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(file: PortalFile) {
    setRowBusy(file.id);
    setError(null);
    try {
      await downloadFile(file.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(file: PortalFile) {
    if (!window.confirm(`Delete "${file.original_name}" from the portal?`)) return;
    setRowBusy(file.id);
    setError(null);
    try {
      await api.admin.deleteFile(file.id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  const totalBytes = selected.reduce((sum, f) => sum + f.size, 0);
  const usersById = new Map(users.map((u) => [u.id, u]));

  return (
    <>
      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>Upload files</h2>
            <p className="muted">
              Drop one or many files. They appear on the dashboards of the users you choose.
            </p>
          </div>
        </div>

        <Banner kind="info">
          Everything uploaded here is deleted automatically <strong>5 days later</strong>, whether
          or not it was collected. A <strong>PDF</strong> also drops off a user's dashboard as soon
          as that user downloads it — other recipients keep seeing it until the 5 days are up.
        </Banner>

        <Banner kind="error">{error}</Banner>
        <Banner kind="success">{result}</Banner>

        <form className="form" onSubmit={handleUpload}>
          <div
            className={`dropzone ${dragging ? "dropzone--active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
          >
            <strong>Drop files here</strong>
            <span className="muted">or click to browse — multiple files are supported</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={handlePick}
              aria-label="Choose files to upload"
            />
          </div>

          {selected.length > 0 ? (
            <ul className="chip-list">
              {selected.map((file, index) => (
                <li className="chip" key={`${file.name}-${file.size}-${index}`}>
                  <span>{file.name}</span>
                  <span className="chip__meta">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    className="chip__remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeAt(index)}
                  >
                    &times;
                  </button>
                </li>
              ))}
              <li className="chip chip--total">
                {selected.length} file(s) · {formatBytes(totalBytes)}
              </li>
            </ul>
          ) : null}

          <label className="field">
            <span>
              Note shown with these files <em>(optional)</em>
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Weekly manifest — week 34"
            />
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={shareWithAll}
              onChange={(e) => setShareWithAll(e.target.checked)}
            />
            <span>Share with every user</span>
          </label>

          {!shareWithAll ? (
            users.length === 0 ? (
              <p className="muted">No users exist yet — create one on the Users tab first.</p>
            ) : (
              <div className="assignees">
                {users.map((user) => (
                  <label className="checkbox" key={user.id}>
                    <input
                      type="checkbox"
                      checked={assignedIds.includes(user.id)}
                      onChange={() => toggleAssignee(user.id)}
                    />
                    <span>
                      {user.username}
                      {user.full_name ? ` · ${user.full_name}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )
          ) : null}

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? "Uploading…" : `Upload ${selected.length || ""} file(s)`.trim()}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2>Published files</h2>
            <p className="muted">
              {files.length} file{files.length === 1 ? "" : "s"} in the portal
            </p>
          </div>
          <button className="btn btn--ghost" type="button" onClick={() => void reload()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading files" />
        ) : files.length === 0 ? (
          <EmptyState title="No files published" hint="Upload files with the form above." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Visible to</th>
                  <th>Collected</th>
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
                    </td>
                    <td>{formatBytes(file.size_bytes)}</td>
                    <td>
                      {file.shared_with_everyone ? (
                        <span className="pill pill--ok">Everyone</span>
                      ) : (
                        <span className="assigned-list">
                          {file.assigned_user_ids
                            .map((id) => usersById.get(id)?.username ?? "deleted user")
                            .join(", ")}
                        </span>
                      )}
                    </td>
                    <td>
                      {file.download_count === 0 ? (
                        <span className="muted">Not yet</span>
                      ) : (
                        <span className="pill pill--ok">
                          {file.download_count} user{file.download_count === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`pill pill--${expiryTone(file.seconds_remaining)}`}>
                        {formatRemaining(file.seconds_remaining)}
                      </span>
                      <span className="file-note">{formatDate(file.created_at)}</span>
                    </td>
                    <td className="cell--actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={rowBusy === file.id}
                        onClick={() => void handleDownload(file)}
                      >
                        Download
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        type="button"
                        disabled={rowBusy === file.id}
                        onClick={() => void handleDelete(file)}
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
