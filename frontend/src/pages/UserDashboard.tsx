import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, downloadFile, previousLoginStore } from "../api";
import { useAuth } from "../auth";
import ChangePassword from "../components/ChangePassword";
import Shell from "../components/Shell";
import type { NavItem } from "../components/Shell";
import { Banner, Product, Spinner, formatBytes, formatStamp } from "../components/ui";
import type { PortalFile } from "../types";

/* Screens reachable from the grey navigation column. */
type View = "home" | "send" | "receive" | "download" | "password" | "help";

type DocState = "unextracted" | "extracted" | "all";
type SortBy = "mailbox_time" | "name" | "size";

interface ReceiveQuery {
  state: DocState;
  sortBy: SortBy;
  rows: number;
}

const DEFAULT_QUERY: ReceiveQuery = { state: "unextracted", sortBy: "mailbox_time", rows: 10 };

/* Fixed columns the classic screen shows for every document in this mailbox. */
const APPLICATION = "EDOCS";
const TEST_INDICATOR = "P";

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<View>("home");
  const [transferOpen, setTransferOpen] = useState(false);
  const [query, setQuery] = useState<ReceiveQuery>(DEFAULT_QUERY);

  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nickname = (user?.username ?? "").toUpperCase();
  const previousLogin = previousLoginStore.get();

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

  // A password issued by an administrator is temporary; land on the change form.
  useEffect(() => {
    if (user?.must_change_password) setView("password");
  }, [user?.must_change_password]);

  function go(next: View) {
    setError(null);
    setNotice(null);
    setView(next);
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const nav: NavItem[] = [
    {
      label: "Transfer Doc",
      open: transferOpen,
      onSelect: () => setTransferOpen((open) => !open),
      children: [
        { label: "Send Doc", active: view === "send", onSelect: () => go("send") },
        {
          label: "Receive Doc",
          active: view === "receive" || view === "download",
          onSelect: () => go("receive"),
        },
      ],
    },
    { label: "Change Password", active: view === "password", onSelect: () => go("password") },
    { label: "Logout", onSelect: handleLogout },
    { label: "Help", active: view === "help", onSelect: () => go("help") },
  ];

  /* ------------------------------------------------------------ receive → download */

  function handleReceiveSubmit(event: FormEvent) {
    event.preventDefault();
    setPickedId(null);
    void load();
    go("download");
  }

  const documents = useMemo(() => {
    const filtered = files.filter((file) => {
      if (query.state === "unextracted") return !file.downloaded_by_me;
      if (query.state === "extracted") return file.downloaded_by_me;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (query.sortBy === "name") return a.original_name.localeCompare(b.original_name);
      if (query.sortBy === "size") return b.size_bytes - a.size_bytes;
      return b.created_at.localeCompare(a.created_at);
    });
    return sorted.slice(0, query.rows);
  }, [files, query]);

  async function handleDownload() {
    const file = files.find((f) => f.id === pickedId);
    if (!file) {
      setError("Select a document to download.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await downloadFile(file.id);
      setNotice(
        file.is_pdf
          ? `${file.original_name} has been extracted from your mailbox.`
          : `${file.original_name} has been downloaded.`,
      );
      // Give the browser a moment to start the transfer, then re-sync the list.
      window.setTimeout(() => void load(), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ screens */

  let content;
  switch (view) {
    case "home":
      content = (
        <>
          <div className="event">
            Event 2009-User Login Successful.
            <br />
            {previousLogin
              ? `User last login time is ${formatStamp(previousLogin)}.`
              : "This is your first login."}
          </div>
          <Product hero />
        </>
      );
      break;

    case "send":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Send Documents</h1>
          <p className="section">
            Sending is not enabled for mailbox <strong>{nickname}</strong>. Documents are placed
            in your mailbox by the administrator; use <strong>Receive Doc</strong> to collect
            them.
          </p>
        </>
      );
      break;

    case "receive":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Receive Documents</h1>
          <form onSubmit={handleReceiveSubmit} className="screen">
            <div className="centered-form">
              <table className="kv">
                <tbody>
                  <tr>
                    <th scope="row">Receiver Nicknames</th>
                    <td>{nickname}</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <label htmlFor="doc-state">Document State in Mailbox</label>
                    </th>
                    <td>
                      <select
                        id="doc-state"
                        value={query.state}
                        onChange={(e) => setQuery({ ...query, state: e.target.value as DocState })}
                      >
                        <option value="unextracted">Unextracted</option>
                        <option value="extracted">Extracted</option>
                        <option value="all">All</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <label htmlFor="sort-by">Sort By</label>
                    </th>
                    <td>
                      <select
                        id="sort-by"
                        value={query.sortBy}
                        onChange={(e) => setQuery({ ...query, sortBy: e.target.value as SortBy })}
                      >
                        <option value="mailbox_time">Mailbox Date/Time</option>
                        <option value="name">Document Name</option>
                        <option value="size">Size</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <label htmlFor="rows">Number of Rows for Display</label>
                    </th>
                    <td>
                      <select
                        id="rows"
                        value={query.rows}
                        onChange={(e) => setQuery({ ...query, rows: Number(e.target.value) })}
                      >
                        {[10, 25, 50, 100].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button className="btn" type="submit">
                Ok
              </button>
              <button className="btn" type="button" onClick={() => setQuery(DEFAULT_QUERY)}>
                Clear
              </button>
            </div>
          </form>
        </>
      );
      break;

    case "download":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Download Documents</h1>

          <Banner kind="error">{error}</Banner>
          <Banner kind="success">{notice}</Banner>

          {loading ? (
            <Spinner label="Reading mailbox" />
          ) : documents.length === 0 ? (
            <p className="section">No documents match the selected mailbox state.</p>
          ) : (
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th aria-label="Select" />
                    <th>Sender Nickname</th>
                    <th>Receiver Nickname</th>
                    <th>Application</th>
                    <th>
                      Test
                      <br />
                      Indicator
                    </th>
                    <th>Document Name</th>
                    <th>Size</th>
                    <th>Mailbox Date/Time</th>
                    <th>Doc State</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((file) => (
                    <tr
                      key={file.id}
                      className={pickedId === file.id ? "row--picked" : ""}
                      onClick={() => setPickedId(file.id)}
                    >
                      <td>
                        <input
                          type="radio"
                          name="document"
                          aria-label={`Select ${file.original_name}`}
                          checked={pickedId === file.id}
                          onChange={() => setPickedId(file.id)}
                        />
                      </td>
                      <td>
                        <span className="cellbox">
                          {(file.uploaded_by ?? "ADMIN").toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span className="cellbox">{nickname}</span>
                      </td>
                      <td>
                        <span className="cellbox cellbox--narrow">{APPLICATION}</span>
                      </td>
                      <td>
                        <span className="cellbox cellbox--narrow">{TEST_INDICATOR}</span>
                      </td>
                      <td>
                        <span className="cellbox cellbox--wide" title={file.notes ?? undefined}>
                          {file.original_name}
                        </span>
                      </td>
                      <td>
                        <span className="cellbox cellbox--narrow">{formatBytes(file.size_bytes)}</span>
                      </td>
                      <td>
                        <span className="cellbox">{formatStamp(file.created_at)}</span>
                      </td>
                      <td>
                        <span className="cellbox cellbox--narrow">
                          {file.downloaded_by_me ? "Extracted" : "Unextracted"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="actions">
            <button
              className="btn"
              type="button"
              disabled={busy || !pickedId}
              onClick={() => void handleDownload()}
            >
              {busy ? "Preparing…" : "Download"}
            </button>
            <button className="btn" type="button" onClick={() => go("receive")}>
              Back
            </button>
            <button className="btn" type="button" onClick={() => go("home")}>
              Cancel
            </button>
          </div>
        </>
      );
      break;

    case "password":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Change Password</h1>
          {user?.must_change_password ? (
            <Banner kind="info">
              You are still using the temporary password issued by your administrator. Please set
              your own password before continuing.
            </Banner>
          ) : null}
          <div className="section" style={{ maxWidth: 720 }}>
            <ChangePassword onDone={() => go("home")} />
          </div>
        </>
      );
      break;

    case "help":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Help</h1>
          <div className="section" style={{ maxWidth: 720 }}>
            <p>
              <strong>Receive Doc</strong> lists the documents placed in mailbox{" "}
              <strong>{nickname}</strong>. Choose a document state, click <strong>Ok</strong>,
              select a row and click <strong>Download</strong>.
            </p>
            <p>
              <strong>.TXT</strong> documents are index files. <strong>.ZIP</strong> documents
              contain the PDF documents for that day.
            </p>
            <p>
              A PDF document is removed from your mailbox once it is extracted (downloaded). Every
              document is removed automatically 5 days after it was placed in the mailbox, whether
              or not it was extracted.
            </p>
            <p>
              Use <strong>Change Password</strong> to replace the password issued by your
              administrator.
            </p>
          </div>
        </>
      );
      break;
  }

  return <Shell nav={nav}>{content}</Shell>;
}
