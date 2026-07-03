import { Navigate } from "react-router-dom";
import { useAuth } from "./useAuth";

// Wrap any route element: <ProtectedRoute roles={["admin"]}><Page /></ProtectedRoute>
// Omit `roles` to just require "logged in", regardless of role.
export function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="page-loading">Loading…</div>;

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
