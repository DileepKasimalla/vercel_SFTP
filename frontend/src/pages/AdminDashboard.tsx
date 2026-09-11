import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, previousLoginStore } from "../api";
import { useAuth } from "../auth";
import Shell from "../components/Shell";
import type { NavItem } from "../components/Shell";
import UsersPanel from "../components/UsersPanel";
import FilesPanel from "../components/FilesPanel";
import { Banner, Product, formatStamp } from "../components/ui";
import type { PortalFile, User } from "../types";

type View = "home" | "users" | "files" | "help";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<View>("home");
  const [adminOpen, setAdminOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const previousLogin = previousLoginStore.get();

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

  function handleLogout() {
    logout();
    navigate("/admin/login", { replace: true });
  }

  const nav: NavItem[] = [
    {
      label: "Administration",
      open: adminOpen,
      onSelect: () => setAdminOpen((open) => !open),
      children: [
        { label: "Manage Users", active: view === "users", onSelect: () => setView("users") },
        { label: "Manage Documents", active: view === "files", onSelect: () => setView("files") },
      ],
    },
    { label: "Logout", onSelect: handleLogout },
    { label: "Help", active: view === "help", onSelect: () => setView("help") },
  ];

  let content;
  switch (view) {
    case "home":
      content = (
        <>
          <div className="event">
            Event 2009-Administrator Login Successful.
            <br />
            {previousLogin
              ? `User last login time is ${formatStamp(previousLogin)}.`
              : "This is your first login."}
          </div>
          <Product hero />
        </>
      );
      break;

    case "users":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Manage Users</h1>
          <Banner kind="error">{error}</Banner>
          <UsersPanel users={portalUsers} loading={loading} reload={loadUsers} />
        </>
      );
      break;

    case "files":
      content = (
        <>
          <Product />
          <h1 className="screen-title">Manage Documents</h1>
          <Banner kind="error">{error}</Banner>
          <FilesPanel files={files} users={portalUsers} loading={loading} reload={loadFiles} />
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
              Signed in as administrator <strong>{user?.username}</strong>.
            </p>
            <p>
              <strong>Manage Users</strong> creates mailboxes (user accounts), resets passwords,
              and disables or deletes accounts. Issued passwords are shown exactly once.
            </p>
            <p>
              <strong>Manage Documents</strong> places documents in every mailbox, or only in the
              mailboxes you select. Users collect them through <strong>Receive Doc</strong>.
            </p>
            <p>
              A PDF document leaves a user's mailbox once that user extracts it. Every document is
              removed automatically 5 days after it was placed, whether or not it was extracted.
            </p>
          </div>
        </>
      );
      break;
  }

  return <Shell nav={nav}>{content}</Shell>;
}
