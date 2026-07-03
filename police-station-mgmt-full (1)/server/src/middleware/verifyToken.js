// Runs on every protected route. Expects:
//   Authorization: Bearer <jwt>
//
// Verifies the JWT (signed with JWT_SECRET), then attaches the decoded
// payload (uid, role, stationId) to req.user for downstream handlers.

const jwt = require("jsonwebtoken");

function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      uid: decoded.uid,
      role: decoded.role,
      stationId: decoded.stationId,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { verifyToken };
