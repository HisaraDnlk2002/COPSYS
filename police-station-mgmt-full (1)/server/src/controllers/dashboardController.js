const DutySchedule = require("../models/DutySchedule");
const DutyRosterWeek = require("../models/DutyRosterWeek");
const LeaveRequest = require("../models/LeaveRequest");
const User = require("../models/User");
const Complaint = require("../models/Complaint");

// "Tomorrow" for a shift exactly one calendar day out, otherwise the
// plain date — matches the dummy-data shape this replaces ({ nextShift:
// "Tomorrow", nextShiftTime: "06.00 -18.00" }).
function relativeDayLabel(date, today) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((date.getTime() - today.getTime()) / oneDayMs);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString("en-GB");
}

// GET /api/dashboard/summary — any authenticated user. Powers the 4 stat
// cards on the Officer/Admin Dashboard: today's duty, leave status
// (computed client-side from a separate leave-balance call), assigned
// complaints, and next shift.
async function getSummary(req, res) {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setHours(23, 59, 59, 999);

    // Only ever the officer's own shifts from a PUBLISHED week — a
    // draft or approved-but-unpublished roster shouldn't leak into this
    // stat card while the "Weekly Duty Schedule" card right below it on
    // the same page (MyDutyCard, via listMine) only ever shows published
    // weeks too. Without this, the two cards could show contradicting
    // duty for the same day.
    const publishedWeekIds = await DutyRosterWeek.find({
      stationId: req.user.stationId,
      status: "published",
    }).distinct("_id");

    const [todaysShift, nextShift, activeComplaints, todaysLeave] = await Promise.all([
      DutySchedule.findOne({
        officerId: req.user.uid,
        weekId: { $in: publishedWeekIds },
        date: { $gte: startOfToday, $lte: endOfToday },
        status: { $ne: "removed" },
      }),
      DutySchedule.findOne({
        officerId: req.user.uid,
        weekId: { $in: publishedWeekIds },
        date: { $gt: endOfToday },
        status: { $ne: "removed" },
      }).sort({ date: 1 }),
      Complaint.countDocuments({ assignedOfficerId: req.user.uid, status: { $ne: "closed" } }),
      LeaveRequest.findOne({
        officerId: req.user.uid,
        status: "approved",
        startDate: { $lte: endOfToday },
        endDate: { $gte: startOfToday },
      }),
    ]);

    // No specific shift today isn't "nothing to show" — same General
    // Duty / On Leave default the Weekly Duty Schedule card and
    // RosterSummary use, so this stat card doesn't visibly disagree with
    // the table right below it. todaysDutyStatus lets the client pick
    // the right localized label (see status.general_duty/on_leave).
    const todaysDutyStatus = todaysShift ? "assigned" : todaysLeave ? "on_leave" : "general_duty";

    return res.json({
      todaysDuty: todaysShift ? todaysShift.department : null,
      todaysDutyStatus,
      todaysDutyShift: todaysShift ? `${todaysShift.shiftStart} - ${todaysShift.shiftEnd}` : null,
      nextShift: nextShift ? relativeDayLabel(nextShift.date, startOfToday) : null,
      nextShiftTime: nextShift ? `${nextShift.shiftStart} - ${nextShift.shiftEnd}` : null,
      activeComplaints,
    });
  } catch (err) {
    console.error("getSummary error:", err);
    return res.status(500).json({ error: "Could not load dashboard summary" });
  }
}

// GET /api/dashboard/oic-summary — oic, admin. Powers the 4 stat cards
// on the OIC Command Dashboard: total officers, pending leaves, active
// complaints, and today's duties — all scoped to this station only.
async function getOicSummary(req, res) {
  try {
    const stationId = req.user.stationId;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const publishedWeeks = await DutyRosterWeek.find({ stationId, status: "published" });
    const coveringWeeks = publishedWeeks.filter((w) => {
      const start = new Date(w.weekStarting);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return startOfToday >= start && startOfToday < end;
    });
    const coveringWeekIds = coveringWeeks.map((w) => w._id);

    const [totalOfficers, pendingLeaves, activeComplaints, unassignedComplaints, todaysShifts] = await Promise.all([
      User.countDocuments({ stationId, status: "active" }),
      // Only requests whose leave dates haven't fully passed yet — same
      // "still actionable" filter as the Personnel Leave Requests card
      // below it on this page, so the two don't disagree on the count.
      LeaveRequest.countDocuments({ stationId, status: "pending", endDate: { $gte: startOfToday } }),
      Complaint.countDocuments({ stationId, status: { $ne: "closed" } }),
      Complaint.countDocuments({ stationId, status: { $ne: "closed" }, assignedOfficerId: null }),
      DutySchedule.find({
        stationId,
        weekId: { $in: coveringWeekIds },
        date: { $gte: startOfToday, $lt: endOfToday },
        status: { $ne: "removed" },
      }),
    ]);

    const presentOfficerIds = new Set();
    let absentCount = 0;
    for (const s of todaysShifts) {
      if (s.status === "absent") absentCount += 1;
      else presentOfficerIds.add(s.officerId.toString());
    }

    // Branch capacity today, from whichever published week(s) cover it —
    // same shape as the Duty Officer Briefing's branchOverview, just
    // reduced to a single shortfall count for this card's caption.
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
    let staffingShortfalls = 0;
    for (const [branch, required] of requiredByBranch.entries()) {
      if ((assignedByBranch.get(branch) || 0) < required) staffingShortfalls += 1;
    }

    return res.json({
      totalOfficers,
      currentStationStrength: presentOfficerIds.size,
      pendingLeaves,
      activeComplaints,
      unassignedComplaints,
      todaysDuties: todaysShifts.length - absentCount,
      staffingShortfalls,
    });
  } catch (err) {
    console.error("getOicSummary error:", err);
    return res.status(500).json({ error: "Could not load OIC dashboard summary" });
  }
}

module.exports = { getSummary, getOicSummary };
