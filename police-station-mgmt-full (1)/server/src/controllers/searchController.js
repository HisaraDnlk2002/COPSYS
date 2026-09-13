const User = require("../models/User");
const Complaint = require("../models/Complaint");
const Inventory = require("../models/Inventory");
const DutySchedule = require("../models/DutySchedule");
const DutyRosterWeek = require("../models/DutyRosterWeek");
const LeaveRequest = require("../models/LeaveRequest");

const RESULT_LIMIT = 6;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/search?q=<term> — every authenticated role, but each category
// below only runs (and so only ever appears) if the caller's role
// actually has access to that module's own page — a search hit that
// then bounces back to /dashboard or 403s when clicked would be worse
// than that category just not showing up. Each category's role check
// mirrors that module's own route/page access exactly:
//   personnel  -> /personnel is admin-only (App.jsx)
//   complaints -> matches complaintRoutes.js's list() access
//   inventory  -> matches inventoryRoutes.js's list() access / the
//                 /inventory page's own ProtectedRoute roles
//   duty       -> matches the /duty-roster page's own ProtectedRoute roles
async function search(req, res) {
  const q = (req.query.q || "").trim();
  if (q.length < 2) {
    return res.json({ personnel: [], complaints: [], inventory: [], duty: [] });
  }

  const stationId = req.user.stationId;
  const role = req.user.role;
  const re = new RegExp(escapeRegex(q), "i");

  try {
    const tasks = [];

    if (role === "admin") {
      tasks.push(
        User.find({
          stationId,
          $or: [{ fullName: re }, { rankAndNumber: re }, { rank: re }, { department: re }],
        })
          .select("fullName rankAndNumber rank department role")
          .limit(RESULT_LIMIT)
          .then((docs) => ({ personnel: docs.map((d) => d.toJSON()) }))
      );
    }

    if (["oic", "duty_officer", "officer", "admin"].includes(role)) {
      tasks.push(
        Complaint.find({
          stationId,
          $or: [
            { refId: re },
            { title: re },
            { category: re },
            { "complainant.fullName": re },
            { "complainant.nic": re },
            { "complainant.passportId": re },
          ],
        })
          .select("refId title status category complainant")
          .limit(RESULT_LIMIT)
          .then((docs) => ({ complaints: docs.map((d) => d.toJSON()) }))
      );
    }

    if (["duty_officer", "inventory_officer"].includes(role)) {
      tasks.push(
        Inventory.find({
          stationId,
          $or: [{ itemId: re }, { itemName: re }, { category: re }],
        })
          .select("itemId itemName category status")
          .limit(RESULT_LIMIT)
          .then((docs) => ({ inventory: docs.map((d) => d.toJSON()) }))
      );
    }

    if (["duty_officer", "oic"].includes(role)) {
      tasks.push(searchDuty(stationId, re));
    }

    const partials = await Promise.all(tasks);
    const results = Object.assign({ personnel: [], complaints: [], inventory: [], duty: [] }, ...partials);
    return res.json(results);
  } catch (err) {
    console.error("search error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
}

// Officer-name lookup with today's duty status — General Duty / On
// Leave / a specific branch shift — same convention as
// dutyScheduleController.js's getBriefing/listMine, just scoped to the
// (at most 3) matched officers instead of the whole station.
async function searchDuty(stationId, re) {
  const officers = await User.find({ stationId, status: "active", fullName: re })
    .select("fullName rankAndNumber department")
    .limit(3);
  if (officers.length === 0) return { duty: [] };

  const publishedWeeks = await DutyRosterWeek.find({ stationId, status: "published" }).select("_id weekStarting");
  const todayKey = new Date().toISOString().slice(0, 10);
  const currentWeek = publishedWeeks.find((w) => {
    const startKey = w.weekStarting.toISOString().slice(0, 10);
    const weekEnd = new Date(w.weekStarting);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const endKey = weekEnd.toISOString().slice(0, 10);
    return todayKey >= startKey && todayKey <= endKey;
  });

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const duty = [];
  for (const officer of officers) {
    let status = "general_duty";
    let department = null;

    if (currentWeek) {
      const shift = await DutySchedule.findOne({
        officerId: officer._id,
        weekId: currentWeek._id,
        date: { $gte: dayStart, $lte: dayEnd },
        status: { $ne: "removed" },
      });
      if (shift) {
        status = shift.status === "absent" ? "absent" : "assigned";
        department = shift.department;
      } else {
        const onLeave = await LeaveRequest.findOne({
          officerId: officer._id,
          status: "approved",
          startDate: { $lte: dayEnd },
          endDate: { $gte: dayStart },
        });
        if (onLeave) status = "on_leave";
      }
    }

    duty.push({
      id: officer._id.toString(),
      fullName: officer.fullName,
      rankAndNumber: officer.rankAndNumber,
      status,
      department,
    });
  }
  return { duty };
}

module.exports = { search };
