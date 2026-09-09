const LeaveRequest = require("../models/LeaveRequest");
const LeaveBalance = require("../models/LeaveBalance");
const User = require("../models/User");
const DutySchedule = require("../models/DutySchedule");
const DutyRosterWeek = require("../models/DutyRosterWeek");
const DailyDutyChange = require("../models/DailyDutyChange");
const { suggestReplacements } = require("../services/dutyAllocationEngine");

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

// PATCH /api/leave-requests/:id/reject — admin/oic. Requires a remark
// explaining the rejection, which is then shown wherever this request
// appears (the officer's own history, the OIC's registry view, etc).
async function reject(req, res) {
  const remarks = (req.body.remarks || "").trim();
  if (!remarks) {
    return res.status(400).json({ error: "A remark is required when rejecting a leave request" });
  }
  return setStatus(req, res, "rejected", remarks);
}

async function setStatus(req, res, status, remarks) {
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
    if (remarks) {
      leaveRequest.remarks = remarks;
    }
    await leaveRequest.save();

    // Deduct from balance only on approval
    if (status === "approved") {
      await LeaveBalance.findOneAndUpdate(
        { officerId: leaveRequest.officerId },
        { $inc: { [leaveRequest.leaveType]: -leaveRequest.days } }
      );
      // Fix any shifts already sitting on a locked (non-draft) roster
      // during the leave period — this is what actually makes the
      // nominated Acting Officer mean something (spec §12/§19).
      await autoSubstituteForApprovedLeave(leaveRequest);
    }

    return res.json(leaveRequest.toJSON());
  } catch (err) {
    console.error("setStatus error:", err);
    return res.status(500).json({ error: "Could not update leave request" });
  }
}

// Finds this officer's shifts overlapping the leave period, on weeks that
// are already submitted/approved/published (drafts are left alone — the
// allocation engine already excludes leave-takers when generating those,
// and the Duty Officer can still freely edit a draft anyway). For each
// affected shift: marks it absent, tries the nominated Acting Officer
// first (if they're actually eligible that day), falls back to the same
// tiered suggestion logic used elsewhere otherwise, and logs everything
// as a DailyDutyChange for the audit trail. Never lets a failure here
// block the leave approval itself — this is a best-effort side effect.
async function autoSubstituteForApprovedLeave(leaveRequest) {
  try {
    const candidateShifts = await DutySchedule.find({
      officerId: leaveRequest.officerId,
      date: { $gte: leaveRequest.startDate, $lte: leaveRequest.endDate },
      status: { $nin: ["removed", "absent"] },
    });
    if (candidateShifts.length === 0) return;

    const weekIds = [...new Set(candidateShifts.map((s) => s.weekId.toString()))];
    const weeks = await DutyRosterWeek.find({ _id: { $in: weekIds } });
    const lockedWeekIds = new Set(
      weeks.filter((w) => !["draft", "sent_back"].includes(w.status)).map((w) => w._id.toString())
    );
    const affectedShifts = candidateShifts.filter((s) => lockedWeekIds.has(s.weekId.toString()));
    if (affectedShifts.length === 0) return;

    const officer = await User.findById(leaveRequest.officerId);

    for (const shift of affectedShifts) {
      shift.status = "absent";
      await shift.save();

      let replacementOfficerId = null;

      // Tier 0: the officer's own nominated Acting Officer, if eligible
      // that specific day (active, not themselves on leave, not already
      // working elsewhere that day).
      if (leaveRequest.actingOfficerId) {
        const actingOfficer = await User.findById(leaveRequest.actingOfficerId);
        if (actingOfficer && actingOfficer.status === "active") {
          const [onLeaveThatDay, alreadyWorking] = await Promise.all([
            LeaveRequest.exists({
              officerId: leaveRequest.actingOfficerId,
              status: "approved",
              startDate: { $lte: shift.date },
              endDate: { $gte: shift.date },
            }),
            DutySchedule.exists({
              officerId: leaveRequest.actingOfficerId,
              date: shift.date,
              status: { $ne: "removed" },
            }),
          ]);
          if (!onLeaveThatDay && !alreadyWorking) {
            replacementOfficerId = leaveRequest.actingOfficerId;
          }
        }
      }

      // Fallback: same rank → same branch → General Pool → anyone,
      // exactly like the Daily tab's manual replacement flow.
      if (!replacementOfficerId) {
        const [allOfficers, todaysAssignments, approvedLeaveRequests] = await Promise.all([
          User.find({ stationId: shift.stationId, status: "active" }),
          DutySchedule.find({ stationId: shift.stationId, date: shift.date }),
          LeaveRequest.find({ stationId: shift.stationId, status: "approved" }),
        ]);

        const suggestions = suggestReplacements({
          unavailableOfficer: {
            id: officer._id.toString(),
            rankAndNumber: officer.rankAndNumber,
            department: shift.department,
          },
          date: shift.date,
          allOfficers: allOfficers.map((o) => ({
            id: o._id.toString(),
            fullName: o.fullName,
            rankAndNumber: o.rankAndNumber,
            department: o.department,
          })),
          todaysAssignments: todaysAssignments.map((a) => ({ officerId: a.officerId.toString() })),
          approvedLeaveRequests: approvedLeaveRequests.map((l) => ({
            officerId: l.officerId.toString(),
            startDate: l.startDate,
            endDate: l.endDate,
          })),
          maxSuggestions: 1,
        });

        if (suggestions[0]) replacementOfficerId = suggestions[0].officer.id;
      }

      let replacementEntry = null;
      if (replacementOfficerId) {
        const replacementOfficer = await User.findById(replacementOfficerId);
        replacementEntry = await DutySchedule.create({
          weekId: shift.weekId,
          officerId: replacementOfficerId,
          date: shift.date,
          shiftType: shift.shiftType,
          shiftStart: shift.shiftStart,
          shiftEnd: shift.shiftEnd,
          department: shift.department,
          assignmentType: replacementOfficer.department === shift.department ? "PERMANENT" : "GENERAL_POOL",
          status: "pending",
          stationId: shift.stationId,
          createdBy: leaveRequest.reviewedBy,
        });
      }

      await DailyDutyChange.create({
        weekId: shift.weekId,
        scheduleEntryId: shift._id,
        officerId: shift.officerId,
        date: shift.date,
        department: shift.department,
        reason: `Approved ${leaveRequest.leaveType} leave (${leaveRequest.refId})`,
        replacementOfficerId: replacementOfficerId || null,
        replacementScheduleEntryId: replacementEntry?._id || null,
        notifiedOfficer: false,
        changedBy: leaveRequest.reviewedBy,
        stationId: shift.stationId,
      });
    }
  } catch (err) {
    // Deliberately swallowed — a failure here should never undo an
    // already-approved leave request. It just means the affected shifts
    // need manual attention in the Daily tab.
    console.error("autoSubstituteForApprovedLeave error:", err);
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

// GET /api/leave-balances/:officerId — admin/oic, powers the "View" detail
// modal on the leave registry so the reviewer can see how many days that
// specific officer has left, not just their own.
async function getBalanceForOfficer(req, res) {
  try {
    const balance = await LeaveBalance.findOne({ officerId: req.params.officerId });
    if (!balance) {
      return res.status(404).json({ error: "No leave balance found" });
    }
    return res.json(balance.toJSON());
  } catch (err) {
    console.error("getBalanceForOfficer error:", err);
    return res.status(500).json({ error: "Could not load leave balance" });
  }
}

module.exports = { listMine, listAll, create, approve, reject, getMyBalance, getBalanceForOfficer };