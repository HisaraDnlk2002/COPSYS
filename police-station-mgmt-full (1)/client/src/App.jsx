import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { LoginPage } from "./pages/Login/Login";
import { DashboardRouter } from "./pages/Dashboard/DashboardRouter";
import { LeaveRequestsPage } from "./pages/LeaveRequests/LeaveRequests";
import { ComplaintsPage } from "./pages/Complaints/Complaints";
import { InventoryPage } from "./pages/Inventory/Inventory";
import { DutyRosterPage } from "./pages/DutyRoster/DutyRoster";
import { PersonnelPage } from "./pages/Personnel/Personnel";
import { ReportsPage } from "./pages/Reports/Reports";
import { SettingsPage } from "./pages/Settings/Settings";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardRouter />} />
            <Route path="/leave" element={<LeaveRequestsPage />} />
            <Route path="/complaints" element={<ComplaintsPage />} />
            <Route
              path="/inventory"
              element={
                <ProtectedRoute roles={["duty_officer", "inventory_officer"]}>
                  <InventoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/duty-roster"
              element={
                <ProtectedRoute roles={["duty_officer", "oic"]}>
                  <DutyRosterPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/personnel"
              element={
                <ProtectedRoute roles={["admin"]}>
                  <PersonnelPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute roles={["oic"]}>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute roles={["oic"]}>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;