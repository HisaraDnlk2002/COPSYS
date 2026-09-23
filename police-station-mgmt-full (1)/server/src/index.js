require("dotenv").config();

// On some mobile-hotspot networks, the OS's default DNS resolver
// transparently hijacks/mis-resolves the MongoDB Atlas hostnames (returns
// NXDOMAIN) even when 8.8.8.8 is configured system-wide — but the same
// query succeeds when sent directly to 8.8.8.8. Forcing Node's own
// resolver here bypasses whatever the OS/network is doing to the default
// path, for local dev on flaky networks.
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const { connectDB } = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const leaveBalanceRoutes = require("./routes/leaveBalanceRoutes");
const complaintRoutes = require("./routes/complaintRoutes");
const dutyScheduleRoutes = require("./routes/dutyScheduleRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const inspectionRoutes = require("./routes/inspectionRoutes");
const alertRoutes = require("./routes/alertRoutes");
const reportsRoutes = require("./routes/reportsRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const officerRoutes = require("./routes/officerRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const passwordResetRequestRoutes = require("./routes/passwordResetRequestRoutes");
const notificationStreamRoutes = require("./routes/notificationStreamRoutes");
const searchRoutes = require("./routes/searchRoutes");
const branchRoutes = require("./routes/branchRoutes");
const shiftRoutes = require("./routes/shiftRoutes");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");
// Vite moves to 5174, 5175… when 5173 is already taken, so any local
// dev port is accepted alongside the configured origins.
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, !origin || allowedOrigins.includes(origin) || LOCAL_DEV_ORIGIN.test(origin));
    },
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leave-requests", leaveRoutes);
app.use("/api/leave-balances", leaveBalanceRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/duty-schedule", dutyScheduleRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/inspections", inspectionRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/officers", officerRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/password-reset-requests", passwordResetRequestRoutes);
app.use("/api/notifications", notificationStreamRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/shifts", shiftRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  // Spec §23 — Branch/Shift moved from hardcoded config to real,
  // admin-editable collections. Seeding is idempotent (a no-op once
  // anything exists — see seedDefaultBranches/seedDefaultShifts), and
  // priming the in-memory cache here is what makes every existing
  // isGeneralPoolBranch()/SHIFTS call site correct from the very first
  // request rather than only after the first Branches/Shifts API call.
  const { seedDefaultBranches } = require("./controllers/branchController");
  const { seedDefaultShifts } = require("./controllers/shiftController");
  const { refreshBranchCache } = require("./config/branches");
  const { refreshShiftCache } = require("./config/shifts");
  await seedDefaultBranches();
  await seedDefaultShifts();
  await refreshBranchCache();
  await refreshShiftCache();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
