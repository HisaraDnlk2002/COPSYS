const bcrypt = require("bcryptjs");
const User = require("../models/User");
const LeaveBalance = require("../models/LeaveBalance");
const { generatePassword } = require("../utils/passwordGenerator");

// GET /api/users/me — any authenticated user reads their own profile
async function getMe(req, res) {
  try {
    const user = await User.findById(req.user.uid);
    if (!user) {
      return res.status(404).json({ error: "Profile not found" });
    }
    return res.json(user.toJSON());
  } catch (err) {
    console.error("getMe error:", err);
    return res.status(500).json({ error: "Could not load profile" });
  }
}

// GET /api/users — admin and oic, lists all personnel at this station
async function listUsers(req, res) {
  try {
    const users = await User.find({ stationId: req.user.stationId });
    return res.json(users.map((u) => u.toJSON()));
  } catch (err) {
    console.error("listUsers error:", err);
    return res.status(500).json({ error: "Could not load personnel list" });
  }
}

const VALID_ROLES = ["admin", "oic", "duty_officer", "inventory_officer", "officer"];

// POST /api/users — admin only, registers a new officer
// Matches the "Register new Personnel" form: full name, rank & number,
// department, role, phone number, email, address. The password is no
// longer typed by Admin — it's generated here and returned once in the
// response for the "Account Created" screen to display (see
// generatePassword's comment for why it's never chosen by a person).
async function createUser(req, res) {
  const {
    fullName,
    rankAndNumber,
    department,
    role,
    phoneNumber,
    email,
    address,
    emergencyContactName,
    emergencyContactPhone,
  } = req.body;

  if (!fullName || !rankAndNumber || !department || !role || !phoneNumber || !email || !address) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    const existing = await User.findOne({ rankAndNumber });
    if (existing) {
      return res.status(409).json({ error: "That rank and number is already registered" });
    }

    if (role === "oic") {
      const existingOic = await User.findOne({ stationId: req.user.stationId, role: "oic" });
      if (existingOic) {
        return res.status(409).json({ error: "This station already has an OIC. Only one OIC account is allowed." });
      }
    }

    const generatedPassword = generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);

    const user = await User.create({
      fullName,
      rankAndNumber,
      department,
      role,
      phoneNumber,
      email,
      address,
      emergencyContactName,
      emergencyContactPhone,
      passwordHash,
      stationId: req.user.stationId,
      status: "active",
    });

    // Starting leave balance — defaults from architecture doc, adjust later if needed
    await LeaveBalance.create({ officerId: user._id });

    return res.status(201).json({ ...user.toJSON(), generatedPassword });
  } catch (err) {
    console.error("createUser error:", err);
    return res.status(500).json({ error: "Could not create personnel account" });
  }
}

// PATCH /api/users/:id — admin only, edits an existing officer's profile
// details (name, department, role, phone, address, emergency contact).
// Deliberately does NOT
// touch rankAndNumber (that's the login username — changing it is a
// bigger operation than a profile edit) or the password (use the
// dedicated "Reset Password" flow for that). Matches the "Edit User"
// action next to "View More" on the Personnel & User Management page.
async function updateUser(req, res) {
  const { id } = req.params;
  const { fullName, department, role, phoneNumber, email, address, emergencyContactName, emergencyContactPhone } = req.body;

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const updates = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (department !== undefined) updates.department = department;
  if (role !== undefined) updates.role = role;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
  if (email !== undefined) updates.email = email;
  if (address !== undefined) updates.address = address;
  if (emergencyContactName !== undefined) updates.emergencyContactName = emergencyContactName;
  if (emergencyContactPhone !== undefined) updates.emergencyContactPhone = emergencyContactPhone;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  try {
    if (role === "oic") {
      const existingOic = await User.findOne({ stationId: req.user.stationId, role: "oic", _id: { $ne: id } });
      if (existingOic) {
        return res.status(409).json({ error: "This station already has an OIC. Only one OIC account is allowed." });
      }
    }

    const user = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json(user.toJSON());
  } catch (err) {
    console.error("updateUser error:", err);
    return res.status(500).json({ error: "Could not update personnel details" });
  }
}

// PATCH /api/users/:id/status — admin only, enable/disable an account
async function updateUserStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!["active", "disabled"].includes(status)) {
    return res.status(400).json({ error: "Status must be 'active' or 'disabled'" });
  }

  try {
    const user = await User.findByIdAndUpdate(id, { status }, { new: true });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json(user.toJSON());
  } catch (err) {
    console.error("updateUserStatus error:", err);
    return res.status(500).json({ error: "Could not update account status" });
  }
}

// PATCH /api/users/:id/password — admin only, resets an officer's
// password on the spot (Admin clicks "Reset Password" in the Personnel
// list — e.g. an officer forgot theirs and asked in person/by phone
// rather than through the self-service request queue). Generates a new
// password the same way createUser and the approved forgot-password flow
// do, and returns it once for Admin to relay directly.
//
// This is distinct from the self-service flow in
// passwordResetRequestsController.js: that one is officer-initiated from
// the Login page and the new password is emailed, never shown to Admin.
async function resetPassword(req, res) {
  const { id } = req.params;

  try {
    const generatedPassword = generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const user = await User.findByIdAndUpdate(id, { passwordHash }, { new: true });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ id: user._id, generatedPassword, message: "Password updated" });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ error: "Could not reset password" });
  }
}

// GET /api/users/stats — admin only. Powers the four stat cards on the
// Personnel & User Management page (Total / Active / Pending / Disabled).
async function getStats(req, res) {
  try {
    const [totalPersonnel, activeSystemUsers, pendingApproves, disabledAccounts] = await Promise.all([
      User.countDocuments({ stationId: req.user.stationId }),
      User.countDocuments({ stationId: req.user.stationId, status: "active" }),
      User.countDocuments({ stationId: req.user.stationId, status: "pending" }),
      User.countDocuments({ stationId: req.user.stationId, status: "disabled" }),
    ]);
    return res.json({ totalPersonnel, activeSystemUsers, pendingApproves, disabledAccounts });
  } catch (err) {
    console.error("getStats error:", err);
    return res.status(500).json({ error: "Could not load personnel stats" });
  }
}

module.exports = {
  getMe,
  listUsers,
  getStats,
  createUser,
  updateUser,
  updateUserStatus,
  resetPassword,
};
