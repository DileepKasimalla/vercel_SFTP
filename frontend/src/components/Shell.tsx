import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Brand } from "./ui";

export default function Shell({
  subtitle,
  actions,
  children,
}: {
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="shell">
      <header className="shell__header">
        <Brand subtitle={subtitle} />
        <div className="shell__actions">
          {actions}
          <span className="who">
            <strong>{user?.full_name || user?.username}</strong>
            <span className="pill">{user?.role}</span>
          </span>
          <button className="btn btn--ghost" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="shell__body">{children}</main>
    </div>
  );
}
