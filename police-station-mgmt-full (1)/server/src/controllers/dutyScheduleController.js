const DutySchedule = require("../models/DutySchedule");
const DutyRosterWeek = require("../models/DutyRosterWeek");
const DailyDutyChange = require("../models/DailyDutyChange");
const User = require("../models/User");
const LeaveRequest = require("../models/LeaveRequest");
const { generateWeeklyRoster, suggestReplacements } = require("../services/dutyAllocationEngine");
const { isGeneralPoolBranch } = require("../config/branches");

// GET /api/duty-schedule/mine — any officer, their own shifts. Only from
// weeks that have actually been published (spec §16) — an officer
// shouldn't see a draft or an approved-but-unpublished plan.
async function listMine(req, res) {
  try {
    const publishedWeeks = await DutyRosterWeek.find({
      stationId: req.user.stationId,
      status: "published",
    }).select("_id");
    const publishedWeekIds = publishedWeeks.map((w) => w._id);

    const shifts = await DutySchedule.find({
      officerId: req.user.uid,
      weekId: { $in: publishedWeekIds },
      status: { $ne: "removed" },
    }).sort({ date: 1 });
    return res.json(shifts.map((s) => s.toJSON()));
  } catch (err) {
    console.error("listMine duty error:", err);
    return res.status(500).json({ error: "Could not load your schedule" });
  }
}

// GET /api/duty-schedule/weeks — oic, duty_officer
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

// POST /api/duty-schedule/weeks — duty_officer: Step 1 of the wizard.
// Just picks the week — branch requirements are set separately via
// updateRequirements once the week exists.
async function createWeek(req, res) {
  const { weekStarting } = req.body;

  if (!weekStarting) {
    return res.status(400).json({ error: "Week starting date is required" });
  }

  try {
    const week = await DutyRosterWeek.create({
      weekStarting,
      requirements: [],
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

// PATCH /api/duty-schedule/weeks/:weekId/requirements — duty_officer:
// Step 2 of the wizard, "Branch Strength Planning" table. Replaces the
// whole requirements list each save (the client always sends the full
// set of branches being planned).
async function updateRequirements(req, res) {
  const { requirements } = req.body;
  if (!Array.isArray(requirements)) {
    return res.status(400).json({ error: "requirements must be an array" });
  }

  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });
    if (!["draft", "sent_back"].includes(week.status)) {
      return res.status(403).json({ error: `This week is ${week.status} and locked for editing.` });
    }

    week.requirements = requirements.map((r) => ({
      branch: r.branch,
      dayRequired: Number(r.dayRequired) || 0,
      nightRequired: Number(r.nightRequired) || 0,
    }));
    await week.save();
    return res.json(week.toJSON());
  } catch (err) {
    console.error("updateRequirements error:", err);
    return res.status(500).json({ error: "Could not update branch requirements" });
  }
}

// GET /api/duty-schedule/weeks/:weekId/staffing-overview — duty_officer, oic
// Powers the wizard's "Initial Staffing & Shortages" preview table
// (spec §9) — pure headcount math, no generation/writes happen here.
async function getStaffingOverview(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });

    const officers = await User.find({ stationId: req.user.stationId, status: "active" });
    const permanentCountByBranch = new Map();
    for (const o of officers) {
      permanentCountByBranch.set(o.department, (permanentCountByBranch.get(o.department) || 0) + 1);
    }
    const generalPoolAvailable = officers.filter((o) => isGeneralPoolBranch(o.department)).length;

    const overview = week.requirements.map((r) => {
      const permAvailable = permanentCountByBranch.get(r.branch) || 0;
      return {
        branch: r.branch,
        day: {
          required: r.dayRequired,
          permAvailable,
          shortage: Math.max(0, r.dayRequired - permAvailable),
        },
        night: {
          required: r.nightRequired,
          permAvailable,
          shortage: Math.max(0, r.nightRequired - permAvailable),
        },
      };
    });

    return res.json({ overview, generalPoolAvailable });
  } catch (err) {
    console.error("getStaffingOverview error:", err);
    return res.status(500).json({ error: "Could not compute staffing overview" });
  }
}

// POST /api/duty-schedule — duty_officer: add one shift cell to a week.
// Locked once the week has left draft/sent_back.
async function create(req, res) {
  const { weekId, officerId, date, shiftStart, shiftEnd, shiftType, department, status } = req.body;

  if (!weekId || !officerId || !date || !shiftStart || !shiftEnd || !department) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    if (req.user.role === "duty_officer") {
      const week = await DutyRosterWeek.findById(weekId);
      if (week && !["draft", "sent_back"].includes(week.status)) {
        return res.status(403).json({
          error: `This week is ${week.status} and locked for editing. It must be sent back for revision first.`,
        });
      }
    }

    const shift = await DutySchedule.create({
      weekId,
      officerId,
      date,
      shiftStart,
      shiftEnd,
      shiftType: shiftType || "day",
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
    const existing = await DutySchedule.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Roster entry not found" });

    if (req.user.role === "duty_officer") {
      const week = await DutyRosterWeek.findById(existing.weekId);
      if (week && !["draft", "sent_back"].includes(week.status)) {
        return res.status(403).json({
          error: `This week is ${week.status} and locked for editing. It must be sent back for revision first.`,
        });
      }
    }

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
    return res.json(shift.toJSON());
  } catch (err) {
    console.error("update duty shift error:", err);
    return res.status(500).json({ error: "Could not update roster entry" });
  }
}

// POST /api/duty-schedule/weeks/:weekId/generate — duty_officer.
// Body may specify { branch, shiftType } to run "Smart Allocation" on
// just one row of the wizard table, or omit both to generate every
// branch x shift combination in one pass (the "Next Step" bulk action).
// Shifts NOT being (re)generated in this call are treated as already
// committed, so an officer used there can't be double-booked elsewhere
// in the same pass (spec §14).
async function generateRoster(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });

    if (week.status !== "draft") {
      return res.status(400).json({ error: "Only a draft week can be auto-generated. Send it back to revise first." });
    }
    if (!week.requirements || week.requirements.length === 0) {
      return res.status(400).json({ error: "Set branch requirements before generating." });
    }

    const { branch, shiftType } = req.body || {};
    let targets;
    if (branch && shiftType) {
      const requirement = week.requirements.find((r) => r.branch === branch);
      if (!requirement) {
        return res.status(400).json({ error: `${branch} is not part of this week's requirements.` });
      }
      const required = shiftType === "night" ? requirement.nightRequired : requirement.dayRequired;
      targets = [{ branch, shiftType, required }];
    } else {
      targets = week.requirements.flatMap((r) => [
        { branch: r.branch, shiftType: "day", required: r.dayRequired },
        { branch: r.branch, shiftType: "night", required: r.nightRequired },
      ]);
    }
    targets = targets.filter((t) => t.required > 0);

    if (targets.length === 0) {
      return res.status(400).json({ error: "Nothing to generate — set a required headcount above 0 first." });
    }

    const officers = await User.find({ stationId: req.user.stationId, status: "active" });
    const officerPayload = officers.map((o) => ({
      id: o._id.toString(),
      fullName: o.fullName,
      rankAndNumber: o.rankAndNumber,
      department: o.department,
    }));

    const weekEnd = new Date(week.weekStarting);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const approvedLeaveRequests = await LeaveRequest.find({
      stationId: req.user.stationId,
      status: "approved",
      startDate: { $lte: weekEnd },
      endDate: { $gte: week.weekStarting },
    });
    const leavePayload = approvedLeaveRequests.map((l) => ({
      officerId: l.officerId.toString(),
      startDate: l.startDate,
      endDate: l.endDate,
    }));

    // Anything already saved for a branch/shift NOT in this pass's
    // targets stays put and blocks its officers from being reused.
    const targetKey = (b, s) => `${b}::${s}`;
    const targetSet = new Set(targets.map((t) => targetKey(t.branch, t.shiftType)));
    const existingShifts = await DutySchedule.find({ weekId: week._id });
    const excludeByDate = new Map();
    for (const s of existingShifts) {
      if (targetSet.has(targetKey(s.department, s.shiftType))) continue; // about to be replaced
      const key = new Date(s.date).toISOString().slice(0, 10);
      if (!excludeByDate.has(key)) excludeByDate.set(key, new Set());
      excludeByDate.get(key).add(s.officerId.toString());
    }

    for (const t of targets) {
      await DutySchedule.deleteMany({ weekId: week._id, department: t.branch, shiftType: t.shiftType });
    }

    let allAssignments = [];
    let allUnfilled = [];
    const allExcluded = new Set();

    for (const t of targets) {
      const { assignments, unfilledDays, excludedOfficerIds } = generateWeeklyRoster({
        weekStarting: week.weekStarting,
        department: t.branch,
        shiftType: t.shiftType,
        requiredStaffing: t.required,
        officers: officerPayload,
        approvedLeaveRequests: leavePayload,
        excludeByDate,
      });
      allAssignments = allAssignments.concat(assignments);
      allUnfilled = allUnfilled.concat(unfilledDays);
      excludedOfficerIds.forEach((id) => allExcluded.add(id));
    }

    const created = await DutySchedule.insertMany(
      allAssignments.map((a) => ({
        weekId: week._id,
        officerId: a.officerId,
        date: a.date,
        shiftType: a.shiftType,
        shiftStart: a.shiftStart,
        shiftEnd: a.shiftEnd,
        department: a.department,
        assignmentType: a.assignmentType,
        status: a.status,
        stationId: req.user.stationId,
        createdBy: req.user.uid,
      }))
    );

    return res.status(201).json({
      shifts: created.map((s) => s.toJSON()),
      unfilledDays: allUnfilled,
      excludedOfficerIds: Array.from(allExcluded),
    });
  } catch (err) {
    console.error("generateRoster error:", err);
    return res.status(500).json({ error: "Could not generate roster" });
  }
}

// GET /api/duty-schedule/replacement-suggestions — duty_officer
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

// POST /api/duty-schedule/daily-changes — duty_officer.
// Marks scheduleEntryId's officer absent for that date, and — if a
// replacementOfficerId is given — creates a fresh DutySchedule entry
// for them covering the exact same date/shift/branch, so the original
// weekly plan stays intact as a record while today's actual coverage
// is accurate. Both sides are logged in one DailyDutyChange for the
// audit trail (spec §19/§20).
async function createDailyChange(req, res) {
  const { scheduleEntryId, reason, replacementOfficerId, notifyOfficer } = req.body;

  if (!scheduleEntryId || !reason) {
    return res.status(400).json({ error: "Schedule entry and reason are required" });
  }

  try {
    const entry = await DutySchedule.findById(scheduleEntryId);
    if (!entry) return res.status(404).json({ error: "Schedule entry not found" });

    entry.status = "absent";
    entry.lastModifiedBy = req.user.uid;
    await entry.save();

    let replacementEntry = null;
    if (replacementOfficerId) {
      const replacementOfficer = await User.findById(replacementOfficerId);
      if (!replacementOfficer) return res.status(404).json({ error: "Replacement officer not found" });

      replacementEntry = await DutySchedule.create({
        weekId: entry.weekId,
        officerId: replacementOfficerId,
        date: entry.date,
        shiftType: entry.shiftType,
        shiftStart: entry.shiftStart,
        shiftEnd: entry.shiftEnd,
        department: entry.department,
        assignmentType: replacementOfficer.department === entry.department ? "PERMANENT" : "GENERAL_POOL",
        status: "pending",
        stationId: req.user.stationId,
        createdBy: req.user.uid,
      });
    }

    const change = await DailyDutyChange.create({
      weekId: entry.weekId,
      scheduleEntryId,
      officerId: entry.officerId,
      date: entry.date,
      department: entry.department,
      reason,
      replacementOfficerId: replacementOfficerId || null,
      replacementScheduleEntryId: replacementEntry?._id || null,
      notifiedOfficer: Boolean(notifyOfficer),
      changedBy: req.user.uid,
      stationId: req.user.stationId,
    });

    return res.status(201).json(change.toJSON());
  } catch (err) {
    console.error("createDailyChange error:", err);
    return res.status(500).json({ error: "Could not save duty change" });
  }
}

// GET /api/duty-schedule/today?date=YYYY-MM-DD — duty_officer, oic.
// Pulls every DutySchedule entry for that date, from PUBLISHED weeks
// only (the actual live plan for the day, not a draft still being
// worked on). Powers the "Today's Duty Update" screen.
async function getTodaysDuty(req, res) {
  try {
    const dateParam = req.query.date ? new Date(req.query.date) : new Date();
    const dayStart = new Date(dateParam);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const publishedWeeks = await DutyRosterWeek.find({
      stationId: req.user.stationId,
      status: "published",
    }).select("_id");
    const publishedWeekIds = publishedWeeks.map((w) => w._id);

    const shifts = await DutySchedule.find({
      stationId: req.user.stationId,
      weekId: { $in: publishedWeekIds },
      date: { $gte: dayStart, $lt: dayEnd },
      status: { $ne: "removed" },
    })
      .populate("officerId", "fullName rankAndNumber department")
      .sort({ department: 1, shiftType: 1 });

    return res.json(shifts.map((s) => s.toJSON()));
  } catch (err) {
    console.error("getTodaysDuty error:", err);
    return res.status(500).json({ error: "Could not load today's duty" });
  }
}

// GET /api/duty-schedule/briefing?date=YYYY-MM-DD — duty_officer, oic.
// Powers the "Today's Briefing" home screen: station-wide headcounts,
// per-branch capacity, and a recent-activity feed. All read-only
// aggregation over data that already exists elsewhere — no new state.
async function getBriefing(req, res) {
  try {
    const dateParam = req.query.date ? new Date(req.query.date) : new Date();
    const dayStart = new Date(dateParam);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [totalOfficers, publishedWeeks] = await Promise.all([
      User.countDocuments({ stationId: req.user.stationId, status: "active" }),
      DutyRosterWeek.find({ stationId: req.user.stationId, status: "published" }),
    ]);

    // Only weeks whose 7-day span actually covers "today" matter here.
    const coveringWeeks = publishedWeeks.filter((w) => {
      const start = new Date(w.weekStarting);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return dayStart >= start && dayStart < end;
    });
    const coveringWeekIds = coveringWeeks.map((w) => w._id);

    const todaysShifts = await DutySchedule.find({
      stationId: req.user.stationId,
      weekId: { $in: coveringWeekIds },
      date: { $gte: dayStart, $lt: dayEnd },
      status: { $ne: "removed" },
    });

    const presentOfficerIds = new Set();
    const absentEntries = [];
    for (const s of todaysShifts) {
      if (s.status === "absent") absentEntries.push(s);
      else presentOfficerIds.add(s.officerId.toString());
    }

    // An absence only counts as an unresolved "shortage" if nobody's
    // been assigned to cover it yet.
    const absentEntryIds = absentEntries.map((s) => s._id);
    const changesForAbsences = await DailyDutyChange.find({
      scheduleEntryId: { $in: absentEntryIds },
    });
    const coveredScheduleEntryIds = new Set(
      changesForAbsences.filter((c) => c.replacementOfficerId).map((c) => c.scheduleEntryId.toString())
    );
    const shortageCount = absentEntries.filter((s) => !coveredScheduleEntryIds.has(s._id.toString())).length;

    // Branch capacity: required (from this week's plan) vs actually
    // covered today (non-absent).
    const requiredByBranch = new Map();
    for (const w of coveringWeeks) {
      for (const r of w.requirements) {
        const total = (r.dayRequired || 0) + (r.nightRequired || 0);
        requiredByBranch.set(r.branch, (requiredByBranch.get(r.branch) || 0) + total);
      }
    }
    const assignedByBranch = new Map();
    for (const s of todaysShifts) {
      if (s.status === "absent") continue;
      assignedByBranch.set(s.department, (assignedByBranch.get(s.department) || 0) + 1);
    }
    const branchOverview = Array.from(requiredByBranch.entries()).map(([branch, required]) => {
      const assigned = assignedByBranch.get(branch) || 0;
      return {
        branch,
        required,
        assigned,
        capacityPct: required > 0 ? Math.round((assigned / required) * 100) : 100,
      };
    });

    // Recent activity: latest daily changes station-wide, any date, so
    // the feed isn't empty on a quiet day.
    const recentAlerts = await DailyDutyChange.find({ stationId: req.user.stationId })
      .populate("officerId", "fullName")
      .populate("replacementOfficerId", "fullName")
      .sort({ createdAt: -1 })
      .limit(5);

    return res.json({
      totalOfficers,
      present: presentOfficerIds.size,
      absent: absentEntries.length,
      shortage: shortageCount,
      branchOverview,
      recentAlerts: recentAlerts.map((c) => c.toJSON()),
    });
  } catch (err) {
    console.error("getBriefing error:", err);
    return res.status(500).json({ error: "Could not load briefing" });
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

// PATCH /api/duty-schedule/weeks/:weekId/submit — duty_officer
async function submitWeek(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });
    if (!["draft", "sent_back"].includes(week.status)) {
      return res.status(400).json({ error: `Cannot submit a week that is already ${week.status}.` });
    }

    const shiftCount = await DutySchedule.countDocuments({ weekId: week._id });
    if (shiftCount === 0) {
      return res.status(400).json({ error: "Generate or add at least one roster entry before submitting." });
    }

    return setWeekStatus(req, res, "submitted");
  } catch (err) {
    console.error("submitWeek error:", err);
    return res.status(500).json({ error: "Could not submit roster week" });
  }
}

// PATCH /api/duty-schedule/weeks/:weekId/approve — oic only
async function approveWeek(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });
    if (week.status !== "submitted") {
      return res.status(400).json({ error: `Cannot approve a week that is ${week.status}, not submitted.` });
    }

    return setWeekStatus(req, res, "approved");
  } catch (err) {
    console.error("approveWeek error:", err);
    return res.status(500).json({ error: "Could not approve roster week" });
  }
}

// PATCH /api/duty-schedule/weeks/:weekId/send-back — oic
async function sendBackWeek(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });
    if (week.status !== "submitted") {
      return res.status(400).json({ error: `Cannot send back a week that is ${week.status}, not submitted.` });
    }

    const { reason } = req.body;
    return setWeekStatus(req, res, "sent_back", reason);
  } catch (err) {
    console.error("sendBackWeek error:", err);
    return res.status(500).json({ error: "Could not send back roster week" });
  }
}

// PATCH /api/duty-schedule/weeks/:weekId/publish — duty_officer only
async function publishWeek(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });
    if (week.status !== "approved") {
      return res.status(400).json({ error: `Cannot publish a week that is ${week.status}, not approved.` });
    }

    week.status = "published";
    week.publishedBy = req.user.uid;
    week.publishedAt = new Date();
    await week.save();
    return res.json(week.toJSON());
  } catch (err) {
    console.error("publishWeek error:", err);
    return res.status(500).json({ error: "Could not publish roster week" });
  }
}

// DELETE /api/duty-schedule/weeks/:weekId — duty_officer. Only drafts
// can be deleted outright (a submitted/approved/published week is a
// real record, not scratch work) — clears its DutySchedule rows too.
async function deleteWeek(req, res) {
  try {
    const week = await DutyRosterWeek.findById(req.params.weekId);
    if (!week) return res.status(404).json({ error: "Roster week not found" });
    if (week.status !== "draft") {
      return res.status(400).json({ error: `Cannot delete a week that is ${week.status}, only drafts.` });
    }

    await DutySchedule.deleteMany({ weekId: week._id });
    await DutyRosterWeek.deleteOne({ _id: week._id });

    return res.status(204).send();
  } catch (err) {
    console.error("deleteWeek error:", err);
    return res.status(500).json({ error: "Could not delete roster week" });
  }
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
  updateRequirements,
  getStaffingOverview,
  generateRoster,
  getReplacementSuggestions,
  createDailyChange,
  listDailyChanges,
  create,
  update,
  submitWeek,
  approveWeek,
  sendBackWeek,
  publishWeek,
  deleteWeek,
  getTodaysDuty,
  getBriefing,
};