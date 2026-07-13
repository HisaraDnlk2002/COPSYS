const bcrypt = require("bcryptjs");
const User = require("../models/User");
const LeaveBalance = require("../models/LeaveBalance");

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

// GET /api/users — admin only, lists all personnel at this station
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
// department, role, phone number, address, plus a password to set their login.
async function createUser(req, res) {
  const { fullName, rankAndNumber, department, role, phoneNumber, address, password } = req.body;

  if (!fullName || !rankAndNumber || !department || !role || !phoneNumber || !address || !password) {
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

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      fullName,
      rankAndNumber,
      department,
      role,
      phoneNumber,
      address,
      passwordHash,
      stationId: req.user.stationId,
      status: "active",
    });

    // Starting leave balance — defaults from architecture doc, adjust later if needed
    await LeaveBalance.create({ officerId: user._id });

    return res.status(201).json(user.toJSON());
  } catch (err) {
    console.error("createUser error:", err);
    return res.status(500).json({ error: "Could not create personnel account" });
  }
}

// PATCH /api/users/:id — admin only, edits an existing officer's profile
// details (name, department, role, phone, address). Deliberately does NOT
// touch rankAndNumber (that's the login username — changing it is a
// bigger operation than a profile edit) or the password (use the
// dedicated "Reset Password" flow for that). Matches the "Edit User"
// action next to "View More" on the Personnel & User Management page.
async function updateUser(req, res) {
  const { id } = req.params;
  const { fullName, department, role, phoneNumber, address } = req.body;

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const updates = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (department !== undefined) updates.department = department;
  if (role !== undefined) updates.role = role;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
  if (address !== undefined) updates.address = address;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  try {
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

// PATCH /api/users/:id/password — admin only, sets/resets an officer's
// password. Admin issues the password at creation time (see createUser)
// and can reissue it later if an officer forgets theirs — there's no
// self-service "forgot password" flow, by design: Admin is the one who
// hands out credentials per the station's process.
async function resetPassword(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(id, { passwordHash }, { new: true });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ id: user._id, message: "Password updated" });
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
