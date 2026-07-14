const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { logAudit } = require("../utils/auditLogger");

// POST /api/auth/login
// Officers log in with rankAndNumber + password directly — no email
// needed, since we're not using Firebase anymore. MongoDB stores
// rankAndNumber as the username field.
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const user = await User.findOne({ rankAndNumber: username.trim() });

    if (!user) {
      logAudit({ userName: username.trim(), action: "User Login", module: "Authentication", status: "failed" });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (user.status === "disabled") {
      logAudit({
        userId: user._id,
        userName: user.fullName,
        action: "User Login",
        module: "Authentication",
        status: "failed",
        stationId: user.stationId,
      });
      return res.status(403).json({ error: "This account has been disabled" });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      logAudit({
        userId: user._id,
        userName: user.fullName,
        action: "User Login",
        module: "Authentication",
        status: "failed",
        stationId: user.stationId,
      });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign(
      { uid: user._id.toString(), role: user.role, stationId: user.stationId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    logAudit({
      userId: user._id,
      userName: user.fullName,
      action: "User Login",
      module: "Authentication",
      status: "success",
      stationId: user.stationId,
    });

    return res.json({ token, user: user.toJSON() });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed, please try again" });
  }
}

module.exports = { login };
