const bcrypt = require("bcryptjs");
const User = require("../models/User");
const PasswordResetRequest = require("../models/PasswordResetRequest");
const { generatePassword } = require("../utils/passwordGenerator");
const { sendMail, isMailerConfigured } = require("../utils/mailer");
const { logAudit } = require("../utils/auditLogger");

// POST /api/password-reset-requests — PUBLIC, no token. This is exactly
// the flow an officer hits when they *can't* log in, so it can't require
// being logged in. Body: { rankAndNumber }.
//
// Always responds with the same generic message whether or not that
// account exists, and never reveals which — otherwise this endpoint
// would let anyone probe for valid rank & numbers one guess at a time.
async function submitRequest(req, res) {
  const { rankAndNumber } = req.body;
  if (!rankAndNumber || !rankAndNumber.trim()) {
    return res.status(400).json({ error: "Rank & Number is required" });
  }

  const GENERIC_RESPONSE = { message: "If that account exists, your request has been sent to the administrator." };

  try {
    const user = await User.findOne({ rankAndNumber: rankAndNumber.trim() });
    if (!user) {
      return res.json(GENERIC_RESPONSE);
    }

    // Don't pile up duplicate pending requests if someone clicks it
    // more than once before Admin gets to it.
    const existingPending = await PasswordResetRequest.findOne({ officerId: user._id, status: "pending" });
    if (!existingPending) {
      await PasswordResetRequest.create({
        officerId: user._id,
        officerName: user.fullName,
        rankAndNumber: user.rankAndNumber,
        stationId: user.stationId,
      });
      logAudit({
        userId: user._id,
        userName: user.fullName,
        action: "Password Reset Requested",
        module: "Authentication",
        status: "success",
        stationId: user.stationId,
      });
    }

    return res.json(GENERIC_RESPONSE);
  } catch (err) {
    console.error("submitRequest (password reset) error:", err);
    // Still don't leak anything — same generic message even on a server error.
    return res.json(GENERIC_RESPONSE);
  }
}

// GET /api/password-reset-requests — admin only
async function listRequests(req, res) {
  try {
    const requests = await PasswordResetRequest.find({ stationId: req.user.stationId }).sort({ createdAt: -1 });
    return res.json(requests.map((r) => r.toJSON()));
  } catch (err) {
    console.error("listRequests error:", err);
    return res.status(500).json({ error: "Could not load password reset requests" });
  }
}

// PATCH /api/password-reset-requests/:id/approve — admin only
// Generates a brand new password and emails it to the officer — Admin
// never sees the password itself (unlike account creation, where it's
// shown on-screen for Admin to relay). The officer's password is only
// actually changed once the email has been sent successfully, so a
// broken mail server never leaves an account silently locked out with
// nobody knowing the new credential.
async function approveRequest(req, res) {
  try {
    const request = await PasswordResetRequest.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ error: "This request has already been resolved" });
    }

    const officer = await User.findById(request.officerId);
    if (!officer) return res.status(404).json({ error: "That officer's account no longer exists" });
    if (!officer.email) {
      return res.status(400).json({
        error: `${officer.fullName} has no email address on file. Add one via "Edit User" first, then approve this request again.`,
      });
    }
    if (!isMailerConfigured()) {
      return res.status(503).json({
        error: "Email is not configured on this server yet. Set GMAIL_USER and GMAIL_APP_PASSWORD in server/.env.",
      });
    }

    const newPassword = generatePassword();

    try {
      await sendMail({
        to: officer.email,
        subject: "Your COPSYS password has been reset",
        text:
          `Hello ${officer.fullName},\n\n` +
          `An administrator has approved your password reset request.\n\n` +
          `Rank & Number: ${officer.rankAndNumber}\n` +
          `New temporary password: ${newPassword}\n\n` +
          `Please log in and change it if you'd like a different one. If you did not request this, contact your administrator immediately.\n\n` +
          `— COPSYS, Police Station Management System`,
      });
    } catch (mailErr) {
      console.error("password reset email send failed:", mailErr);
      return res.status(502).json({ error: "Could not send the email. The officer's password was not changed — please try again." });
    }

    officer.passwordHash = await bcrypt.hash(newPassword, 10);
    await officer.save();

    const admin = await User.findById(req.user.uid);
    request.status = "fulfilled";
    request.resolvedBy = req.user.uid;
    request.resolvedByName = admin?.fullName || "Unknown";
    request.resolvedAt = new Date();
    await request.save();

    logAudit({
      userId: req.user.uid,
      userName: admin?.fullName || "Unknown",
      action: `Password Reset Approved for ${officer.fullName} (${officer.rankAndNumber})`,
      module: "Authentication",
      status: "success",
      stationId: req.user.stationId,
    });

    return res.json(request.toJSON());
  } catch (err) {
    console.error("approveRequest error:", err);
    return res.status(500).json({ error: "Could not approve this request" });
  }
}

// PATCH /api/password-reset-requests/:id/reject — admin only
async function rejectRequest(req, res) {
  try {
    const request = await PasswordResetRequest.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ error: "This request has already been resolved" });
    }

    const admin = await User.findById(req.user.uid);
    request.status = "rejected";
    request.resolvedBy = req.user.uid;
    request.resolvedByName = admin?.fullName || "Unknown";
    request.resolvedAt = new Date();
    await request.save();

    logAudit({
      userId: req.user.uid,
      userName: admin?.fullName || "Unknown",
      action: `Password Reset Rejected for ${request.officerName} (${request.rankAndNumber})`,
      module: "Authentication",
      status: "success",
      stationId: req.user.stationId,
    });

    return res.json(request.toJSON());
  } catch (err) {
    console.error("rejectRequest error:", err);
    return res.status(500).json({ error: "Could not reject this request" });
  }
}

module.exports = { submitRequest, listRequests, approveRequest, rejectRequest };
