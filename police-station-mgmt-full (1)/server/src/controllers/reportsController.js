const LeaveRequest = require("../models/LeaveRequest");
const DutySchedule = require("../models/DutySchedule");
const InventoryTransaction = require("../models/InventoryTransaction");
const Complaint = require("../models/Complaint");
const User = require("../models/User");

// GET /api/reports/summary — oic only
// Matches the 3 top stat cards on page 16: Duty Summary %, Leave
// Statistics (days), Inventory Movements (item count).
async function getSummary(req, res) {
  try {
    const stationId = req.user.stationId;

    const totalShifts = await DutySchedule.countDocuments({ stationId });
    const confirmedShifts = await DutySchedule.countDocuments({ stationId, status: "confirmed" });
    const dutyCompliance = totalShifts > 0 ? (confirmedShifts / totalShifts) * 100 : 0;

    const approvedLeaves = await LeaveRequest.find({ stationId, status: "approved" });
    const totalLeaveDays = approvedLeaves.reduce((sum, l) => sum + l.days, 0);

    const inventoryMovements = await InventoryTransaction.countDocuments({ stationId });

    return res.json({
      dutyCompliancePercent: Math.round(dutyCompliance * 10) / 10,
      leaveStatisticsDays: totalLeaveDays,
      inventoryMovements,
    });
  } catch (err) {
    console.error("getSummary error:", err);
    return res.status(500).json({ error: "Could not load report summary" });
  }
}

// GET /api/reports/crime-distribution — oic only
// Bar chart: complaint count grouped by category, matches "Crime
// Incidence Distribution" on page 16.
async function getCrimeDistribution(req, res) {
  try {
    const results = await Complaint.aggregate([
      { $match: { stationId: req.user.stationId } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    return res.json(results.map((r) => ({ category: r._id, count: r.count })));
  } catch (err) {
    console.error("getCrimeDistribution error:", err);
    return res.status(500).json({ error: "Could not load crime distribution" });
  }
}

// GET /api/reports/force-strength — oic only
// Line chart: active duty vs on-leave personnel over recent days,
// matches "Weekly Force Strength" on page 16.
async function getForceStrength(req, res) {
  try {
    const stationId = req.user.stationId;
    const totalOfficers = await User.countDocuments({ stationId, status: "active" });

    // Last 7 days, counting how many were on approved leave that day vs active
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);

      const onLeave = await LeaveRequest.countDocuments({
        stationId,
        status: "approved",
        startDate: { $lte: nextDay },
        endDate: { $gte: date },
      });

      days.push({
        date: date.toISOString().slice(0, 10),
        activeDuty: totalOfficers - onLeave,
        onLeave,
      });
    }

    return res.json(days);
  } catch (err) {
    console.error("getForceStrength error:", err);
    return res.status(500).json({ error: "Could not load force strength data" });
  }
}

// GET /api/reports/activity-log — oic only
// "Recent Activity Logs" table on page 16: generated reports ready for
// download. This is a placeholder list for now — actual PDF/CSV
// generation is flagged as a TODO (see ARCHITECTURE.md open items).
async function getActivityLog(req, res) {
  try {
    // TODO: replace with a real ReportExport collection once file
    // generation is implemented. Returning an empty list rather than
    // fake data so the frontend's empty state is exercised honestly.
    return res.json([]);
  } catch (err) {
    console.error("getActivityLog error:", err);
    return res.status(500).json({ error: "Could not load activity log" });
  }
}

module.exports = { getSummary, getCrimeDistribution, getForceStrength, getActivityLog };
