const DutySchedule = require("../models/DutySchedule");
const DutyRosterWeek = require("../models/DutyRosterWeek");
const DailyDutyChange = require("../models/DailyDutyChange");
const User = require("../models/User");
const LeaveRequest = require("../models/LeaveRequest");
const { generateWeeklyRoster, suggestReplacements } = require("../services/dutyAllocationEngine");

// GET /api/duty-schedule/mine — any officer, their own shifts (any week)
async function listMine(req, res) {
  try {
    const shifts = await DutySchedule.find({ officerId: req.user.uid }).sort({ date: 1 });
    return res.json(shifts.map((s) => s.toJSON()));
  } catch (err) {
    console.error("listMine duty error:", err);
    return res.status(500).json({ error: "Could not load your schedule" });
  }
}

// GET /api/duty-schedule/weeks — oic, duty_officer: list roster weeks
// (so the UI can show "Active Duty Roster" plus past weeks)
async function listWeeks(req, res) {
  try {
    const weeks = await DutyRosterWeek.find({ stationId: req.user.stationId }).sort({ weekStarting: -1 });
    return res.json(weeks.map((w) => w.toJSON()));
  } catch (err) {
    console.error("listWeeks error:", err);
    return res.status(500).json({ error: "Could not load roster weeks" });
  }
}

// GET /api/duty-schedule/weeks/:weekId — full grid for one week
// (officer x day matrix on page 14 — frontend reshapes this flat list
// into a grid; keeping the API shape flat/simple rather than nesting)
async function getWeek(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });

    const shifts = await DutySchedule.find({ weekId: week._id })
      .populate("officerId", "fullName rankAndNumber department")
      .sort({ date: 1 });

    return res.json({ week: week.toJSON(), shifts: shifts.map((s) => s.toJSON()) });
  } catch (err) {
    console.error("getWeek error:", err);
    return res.status(500).json({ error: "Could not load roster week" });
  }
}

// POST /api/duty-schedule/weeks — duty_officer: the "Roster Generation
// Tool" on page 12 / "Active week" selector on page 14. Creates the
// parent week record; individual day-shifts get added separately via
// POST /api/duty-schedule or a manual-entry bulk endpoint.
async function createWeek(req, res) {
  const { weekStarting, department, shiftPattern, requiredStaffing, specialEvents } = req.body;

  if (!weekStarting || !department) {
    return res.status(400).json({ error: "Week starting date and department are required" });
  }

  try {
    const week = await DutyRosterWeek.create({
      weekStarting,
      department,
      shiftPattern,
      requiredStaffing: requiredStaffing || 0,
      specialEvents: specialEvents || "",
      status: "draft",
      stationId: req.user.stationId,
      createdBy: req.user.uid,
    });
    return res.status(201).json(week.toJSON());
  } catch (err) {
    console.error("createWeek error:", err);
    return res.status(500).json({ error: "Could not create roster week" });
  }
}

// POST /api/duty-schedule — duty_officer: add one shift cell to a week
async function create(req, res) {
  const { weekId, officerId, date, shiftStart, shiftEnd, department, status } = req.body;

  if (!weekId || !officerId || !date || !shiftStart || !shiftEnd || !department) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const shift = await DutySchedule.create({
      weekId,
      officerId,
      date,
      shiftStart,
      shiftEnd,
      department,
      status: status || "pending",
      stationId: req.user.stationId,
      createdBy: req.user.uid,
    });
    return res.status(201).json(shift.toJSON());
  } catch (err) {
    console.error("create duty shift error:", err);
    return res.status(500).json({ error: "Could not create roster entry" });
  }
}

// PATCH /api/duty-schedule/:id — duty_officer, admin, oic (oversight override)
async function update(req, res) {
  const { shiftStart, shiftEnd, department, status } = req.body;

  try {
    const shift = await DutySchedule.findByIdAndUpdate(
      req.params.id,
      {
        ...(shiftStart && { shiftStart }),
        ...(shiftEnd && { shiftEnd }),
        ...(department && { department }),
        ...(status && { status }),
        lastModifiedBy: req.user.uid,
      },
      { new: true }
    );
    if (!shift) return res.status(404).json({ error: "Roster entry not found" });
    return res.json(shift.toJSON());
  } catch (err) {
    console.error("update duty shift error:", err);
    return res.status(500).json({ error: "Could not update roster entry" });
  }
}

// POST /api/duty-schedule/weeks/:weekId/generate — duty_officer
// Runs the rule-based allocation engine (server/src/services/dutyAllocationEngine.js)
// against this station's current officers and approved leave, then saves
// the generated assignments as DutySchedule entries under this week.
// Matches the "Generate Roster" button in the roster generation tool.
async function generateRoster(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });

    if (week.status !== "draft") {
      return res.status(400).json({ error: "Only a draft week can be auto-generated. Create a new week to regenerate." });
    }

    const officers = await User.find({ stationId: req.user.stationId, status: "active" });

    const weekEnd = new Date(week.weekStarting);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const approvedLeaveRequests = await LeaveRequest.find({
      stationId: req.user.stationId,
      status: "approved",
      startDate: { $lte: weekEnd },
      endDate: { $gte: week.weekStarting },
    });

    const { assignments, unfilledDays, excludedOfficerIds } = generateWeeklyRoster({
      weekStarting: week.weekStarting,
      department: week.department,
      requiredStaffing: week.requiredStaffing,
      officers: officers.map((o) => ({
        id: o._id.toString(),
        fullName: o.fullName,
        rankAndNumber: o.rankAndNumber,
        department: o.department,
      })),
      approvedLeaveRequests: approvedLeaveRequests.map((l) => ({
        officerId: l.officerId.toString(),
        startDate: l.startDate,
        endDate: l.endDate,
      })),
    });

    // Clear out any previously generated entries for this week before
    // writing the new batch, so re-running generation doesn't duplicate.
    await DutySchedule.deleteMany({ weekId: week._id });

    const created = await DutySchedule.insertMany(
      assignments.map((a) => ({
        weekId: week._id,
        officerId: a.officerId,
        date: a.date,
        shiftStart: a.shiftStart,
        shiftEnd: a.shiftEnd,
        department: a.department,
        status: a.status,
        stationId: req.user.stationId,
        createdBy: req.user.uid,
      }))
    );

    return res.status(201).json({
      shifts: created.map((s) => s.toJSON()),
      unfilledDays,
      excludedOfficerIds,
    });
  } catch (err) {
    console.error("generateRoster error:", err);
    return res.status(500).json({ error: "Could not generate roster" });
  }
}

// GET /api/duty-schedule/replacement-suggestions — duty_officer
// Query params: officerId, date
// Matches the "Suggested replacements" feature when an officer reports
// unavailable for a day they were scheduled.
async function getReplacementSuggestions(req, res) {
  const { officerId, date } = req.query;

  if (!officerId || !date) {
    return res.status(400).json({ error: "officerId and date are required" });
  }

  try {
    const unavailableOfficer = await User.findById(officerId);
    if (!unavailableOfficer) return res.status(404).json({ error: "Officer not found" });

    const allOfficers = await User.find({ stationId: req.user.stationId, status: "active" });
    const todaysAssignments = await DutySchedule.find({
      stationId: req.user.stationId,
      date: new Date(date),
    });
    const approvedLeaveRequests = await LeaveRequest.find({
      stationId: req.user.stationId,
      status: "approved",
    });

    const suggestions = suggestReplacements({
      unavailableOfficer: {
        id: unavailableOfficer._id.toString(),
        rankAndNumber: unavailableOfficer.rankAndNumber,
        department: unavailableOfficer.department,
      },
      date,
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
    });

    return res.json(suggestions);
  } catch (err) {
    console.error("getReplacementSuggestions error:", err);
    return res.status(500).json({ error: "Could not generate replacement suggestions" });
  }
}

// POST /api/duty-schedule/daily-changes — duty_officer
// Matches "Roster Management" post-publish: Officer / Current Duty /
// New Duty / Reason, with Save Change + Notify Officer buttons.
async function createDailyChange(req, res) {
  const { weekId, scheduleEntryId, newDuty, reason, notifyOfficer } = req.body;

  if (!weekId || !scheduleEntryId || !newDuty || !reason) {
    return res.status(400).json({ error: "Week, schedule entry, new duty, and reason are required" });
  }

  try {
    const entry = await DutySchedule.findById(scheduleEntryId);
    if (!entry) return res.status(404).json({ error: "Schedule entry not found" });

    const change = await DailyDutyChange.create({
      weekId,
      scheduleEntryId,
      officerId: entry.officerId,
      date: entry.date,
      previousDuty: entry.department,
      newDuty,
      reason,
      notifiedOfficer: Boolean(notifyOfficer),
      changedBy: req.user.uid,
      stationId: req.user.stationId,
    });

    entry.department = newDuty;
    entry.lastModifiedBy = req.user.uid;
    await entry.save();

    return res.status(201).json(change.toJSON());
  } catch (err) {
    console.error("createDailyChange error:", err);
    return res.status(500).json({ error: "Could not save duty change" });
  }
}

// GET /api/duty-schedule/daily-changes — duty_officer, oic
async function listDailyChanges(req, res) {
  try {
    const changes = await DailyDutyChange.find({ stationId: req.user.stationId })
      .populate("officerId", "fullName rankAndNumber")
      .sort({ createdAt: -1 });
    return res.json(changes.map((c) => c.toJSON()));
  } catch (err) {
    console.error("listDailyChanges error:", err);
    return res.status(500).json({ error: "Could not load daily duty changes" });
  }
}

// PATCH /api/duty-schedule/weeks/:weekId/submit — duty_officer sends the
// week to OIC for review (the "Submit" button on page 12's roster table)
async function submitWeek(req, res) {
  return setWeekStatus(req, res, "submitted");
}

// PATCH /api/duty-schedule/weeks/:weekId/approve — oic
async function approveWeek(req, res) {
  return setWeekStatus(req, res, "approved");
}

// PATCH /api/duty-schedule/weeks/:weekId/send-back — oic, with an optional
// reason (page 14's "Send Back to Revise" button)
async function sendBackWeek(req, res) {
  const { reason } = req.body;
  return setWeekStatus(req, res, "sent_back", reason);
}

async function setWeekStatus(req, res, status, reason) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });

    week.status = status;
    if (status === "approved" || status === "sent_back") {
      week.reviewedBy = req.user.uid;
      week.reviewedAt = new Date();
    }
    if (status === "sent_back") {
      week.sendBackReason = reason || "";
    }
    await week.save();

    return res.json(week.toJSON());
  } catch (err) {
    console.error("setWeekStatus error:", err);
    return res.status(500).json({ error: "Could not update roster week status" });
  }
}

module.exports = {
  listMine,
  listWeeks,
  getWeek,
  createWeek,
  generateRoster,
  getReplacementSuggestions,
  createDailyChange,
  listDailyChanges,
  create,
  update,
  submitWeek,
  approveWeek,
  sendBackWeek,
};
