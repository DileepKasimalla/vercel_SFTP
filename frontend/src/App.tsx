import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { Spinner } from "./components/ui";
import type { BootstrapStatus, Role } from "./types";
import AdminDashboard from "./pages/AdminDashboard";
import BootstrapPage from "./pages/Bootstrap";
import LoginPage from "./pages/Login";
import NotFound from "./pages/NotFound";
import Portal from "./pages/Portal";
import UserDashboard from "./pages/UserDashboard";

export default function App() {
  const { loading } = useAuth();
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const location = useLocation();

  // Re-check on navigation so the portal stops offering bootstrap the moment an
  // admin exists (and starts offering it again on a fresh database).
  useEffect(() => {
    let cancelled = false;
    api
      .bootstrapStatus()
      .then((value) => {
        if (!cancelled) {
          setStatus(value);
          setStatusError(null);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) setStatusError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="page page--centered">
        <Spinner label="Starting the portal" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Portal status={status} statusError={statusError} />} />
      <Route
        path="/bootstrap"
        element={<BootstrapPage status={status} onCompleted={setStatus} />}
      />
      <Route path="/admin/login" element={<LoginPage role="admin" status={status} />} />
      <Route path="/login" element={<LoginPage role="user" status={status} />} />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminDashboard />
          </RequireRole>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireRole role="user">
            <UserDashboard />
          </RequireRole>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to={role === "admin" ? "/admin/login" : "/login"} state={{ from: location }} replace />;
  }
  if (user.role !== role) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  }
  return <>{children}</>;
}
