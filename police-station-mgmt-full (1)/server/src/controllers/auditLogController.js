const AuditLog = require("../models/AuditLog");

// GET /api/audit-logs — admin only. Search/status/module filtering is done
// client-side (same pattern as Complaints/Personnel), so this just returns
// the station's recent log entries, newest first.
async function list(req, res) {
  try {
    const logs = await AuditLog.find({ stationId: req.user.stationId })
      .sort({ createdAt: -1 })
      .limit(300);
    return res.json(logs.map((l) => l.toJSON()));
  } catch (err) {
    console.error("list audit logs error:", err);
    return res.status(500).json({ error: "Could not load audit logs" });
  }
}

module.exports = { list };
