require("dotenv").config();
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
const reportsRoutes = require("./routes/reportsRoutes");
const settingsRoutes = require("./routes/settingsRoutes");

const app = express();

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "http://localhost:5173").split(","),
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
app.use("/api/reports", reportsRoutes);
app.use("/api/settings", settingsRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
