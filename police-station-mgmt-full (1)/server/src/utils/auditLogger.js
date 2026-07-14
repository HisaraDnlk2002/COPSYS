const AuditLog = require("../models/AuditLog");

// Fire-and-forget: callers don't await this, and a logging failure must
// never block or break the action being logged (e.g. a real login).
function logAudit({ userId = null, userName, action, module, status, stationId = "default-station" }) {
  AuditLog.create({ userId, userName, action, module, status, stationId }).catch((err) => {
    console.error("audit log write failed:", err);
  });
}

module.exports = { logAudit };
