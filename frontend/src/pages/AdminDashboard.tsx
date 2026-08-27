import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Shell from "../components/Shell";
import UsersPanel from "../components/UsersPanel";
import FilesPanel from "../components/FilesPanel";
import { Banner } from "../components/ui";
import type { PortalFile, User } from "../types";

type Tab = "users" | "files";

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[]>([]);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Both panels need the user list (files are assigned to users), so it is
  // loaded once here and passed down.
  const loadUsers = useCallback(async () => {
    setUsers(await api.admin.listUsers());
  }, []);

  const loadFiles = useCallback(async () => {
    setFiles(await api.admin.listFiles());
  }, []);

  useEffect(() => {
    Promise.all([loadUsers(), loadFiles()])
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadUsers, loadFiles]);

  const portalUsers = users.filter((u) => u.role === "user");

  return (
    <Shell subtitle="Administration">
      <nav className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "users"}
          className={`tab ${tab === "users" ? "tab--active" : ""}`}
          onClick={() => setTab("users")}
          type="button"
        >
          Users <span className="tab__count">{portalUsers.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "files"}
          className={`tab ${tab === "files" ? "tab--active" : ""}`}
          onClick={() => setTab("files")}
          type="button"
        >
          Files <span className="tab__count">{files.length}</span>
        </button>
      </nav>

      <Banner kind="error">{error}</Banner>

      {tab === "users" ? (
        <UsersPanel users={portalUsers} loading={loading} reload={loadUsers} />
      ) : (
        <FilesPanel
          files={files}
          users={portalUsers}
          loading={loading}
          reload={loadFiles}
        />
      )}
    </Shell>
  );
}
