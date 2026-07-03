const LeaveRequest = require("../models/LeaveRequest");
const LeaveBalance = require("../models/LeaveBalance");
const User = require("../models/User");

function daysBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1; // inclusive of both ends
}

async function generateRefId() {
  const count = await LeaveRequest.countDocuments();
  return `LV-${String(100 + count + 1)}`;
}

// GET /api/leave-requests/mine — any authenticated user, their own history
async function listMine(req, res) {
  try {
    const requests = await LeaveRequest.find({ officerId: req.user.uid }).sort({ createdAt: -1 });
    return res.json(requests.map((r) => r.toJSON()));
  } catch (err) {
    console.error("listMine error:", err);
    return res.status(500).json({ error: "Could not load leave history" });
  }
}

// GET /api/leave-requests — admin/oic, full approval queue for the station
async function listAll(req, res) {
  try {
    const requests = await LeaveRequest.find({ stationId: req.user.stationId }).sort({ createdAt: -1 });
    return res.json(requests.map((r) => r.toJSON()));
  } catch (err) {
    console.error("listAll error:", err);
    return res.status(500).json({ error: "Could not load leave requests" });
  }
}

// POST /api/leave-requests — any authenticated user, applies for leave
// Enforces the rules from the "Submission Rules" panel in the mockup:
//   - Annual leave over 5 days needs >= 30 words of justification
//   - (Medical cert + 48hr advance notice are noted but not hard-enforced
//     here yet — flagged as TODO since they need file upload / clock checks)
async function create(req, res) {
  const { leaveType, startDate, endDate, justification, actingOfficerId, emergencyContact } = req.body;

  if (!leaveType || !startDate || !endDate) {
    return res.status(400).json({ error: "Leave type, start date and end date are required" });
  }

  const days = daysBetween(startDate, endDate);
  if (days <= 0) {
    return res.status(400).json({ error: "End date must be on or after start date" });
  }

  if (leaveType === "annual" && days > 5) {
    const wordCount = (justification || "").trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 30) {
      return res.status(400).json({
        error: "Annual leave over 5 days requires at least 30 words in the justification",
      });
    }
  }

  try {
    const balance = await LeaveBalance.findOne({ officerId: req.user.uid });
    if (balance && balance[leaveType] < days) {
      return res.status(400).json({
        error: `Insufficient ${leaveType} leave balance (have ${balance[leaveType]}, need ${days})`,
      });
    }

    const officer = await User.findById(req.user.uid);

    const leaveRequest = await LeaveRequest.create({
      refId: await generateRefId(),
      officerId: req.user.uid,
      officerName: officer.fullName,
      leaveType,
      startDate,
      endDate,
      days,
      justification,
      actingOfficerId: actingOfficerId || null,
      emergencyContact,
      stationId: req.user.stationId,
    });

    return res.status(201).json(leaveRequest.toJSON());
  } catch (err) {
    console.error("create leave request error:", err);
    return res.status(500).json({ error: "Could not submit leave request" });
  }
}

// PATCH /api/leave-requests/:id/approve — admin/oic
async function approve(req, res) {
  return setStatus(req, res, "approved");
}

// PATCH /api/leave-requests/:id/reject — admin/oic
async function reject(req, res) {
  return setStatus(req, res, "rejected");
}

async function setStatus(req, res, status) {
  const { id } = req.params;

  try {
    const leaveRequest = await LeaveRequest.findById(id);
    if (!leaveRequest) {
      return res.status(404).json({ error: "Leave request not found" });
    }
    if (leaveRequest.status !== "pending") {
      return res.status(400).json({ error: "This request has already been reviewed" });
    }

    leaveRequest.status = status;
    leaveRequest.reviewedBy = req.user.uid;
    leaveRequest.reviewedAt = new Date();
    await leaveRequest.save();

    // Deduct from balance only on approval
    if (status === "approved") {
      await LeaveBalance.findOneAndUpdate(
        { officerId: leaveRequest.officerId },
        { $inc: { [leaveRequest.leaveType]: -leaveRequest.days } }
      );
    }

    return res.json(leaveRequest.toJSON());
  } catch (err) {
    console.error("setStatus error:", err);
    return res.status(500).json({ error: "Could not update leave request" });
  }
}

// GET /api/leave-balances/me
async function getMyBalance(req, res) {
  try {
    const balance = await LeaveBalance.findOne({ officerId: req.user.uid });
    if (!balance) {
      return res.status(404).json({ error: "No leave balance found" });
    }
    return res.json(balance.toJSON());
  } catch (err) {
    console.error("getMyBalance error:", err);
    return res.status(500).json({ error: "Could not load leave balance" });
  }
}

module.exports = { listMine, listAll, create, approve, reject, getMyBalance };
