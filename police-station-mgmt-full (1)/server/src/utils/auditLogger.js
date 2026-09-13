const AuditLog = require("../models/AuditLog");
const User = require("../models/User");

// Fire-and-forget: callers don't await this, and a logging failure must
// never block or break the action being logged (e.g. a real login).
function logAudit({ userId = null, userName, action, module, status, stationId = "default-station" }) {
  AuditLog.create({ userId, userName, action, module, status, stationId }).catch((err) => {
    console.error("audit log write failed:", err);
  });
}

// Convenience for the common case: the actor is the logged-in caller
// (req.user has their uid/stationId from the JWT, but never a display
// name — see verifyToken.js), so every call site would otherwise have
// to fetch the User doc itself just to log an entry. Still
// fire-and-forget: never awaited by the caller, and a lookup or write
// failure here only reaches the console, never the action being audited.
function logAuditForActor(req, { action, module, status = "success" }) {
  User.findById(req.user.uid)
    .select("fullName")
    .then((user) => {
      logAudit({
        userId: req.user.uid,
        userName: user?.fullName || "Unknown",
        action,
        module,
        status,
        stationId: req.user.stationId,
      });
    })
    .catch((err) => console.error("audit log actor lookup failed:", err));
}

module.exports = { logAudit, logAuditForActor };
