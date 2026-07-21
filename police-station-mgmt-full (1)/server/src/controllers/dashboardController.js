const DutySchedule = require("../models/DutySchedule");
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

    const [todaysShift, nextShift, activeComplaints] = await Promise.all([
      DutySchedule.findOne({ officerId: req.user.uid, date: { $gte: startOfToday, $lte: endOfToday } }),
      DutySchedule.findOne({ officerId: req.user.uid, date: { $gt: endOfToday } }).sort({ date: 1 }),
      Complaint.countDocuments({ assignedOfficerId: req.user.uid, status: { $ne: "closed" } }),
    ]);

    return res.json({
      todaysDuty: todaysShift ? todaysShift.department : null,
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

module.exports = { getSummary };
