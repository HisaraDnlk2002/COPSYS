const mongoose = require("mongoose");
const LeaveRequest = require("../models/LeaveRequest");
const DutySchedule = require("../models/DutySchedule");
const DutyRosterWeek = require("../models/DutyRosterWeek");
const InventoryTransaction = require("../models/InventoryTransaction");
const Inventory = require("../models/Inventory");
const Maintenance = require("../models/Maintenance");
const Inspection = require("../models/Inspection");
const Alert = require("../models/Alert");
const { AMMUNITION_CATEGORY } = require("../config/weaponCatalog");
const Complaint = require("../models/Complaint");
const User = require("../models/User");
const ReportExport = require("../models/ReportExport");
const { buildCsv, buildPdf } = require("../utils/reportFileBuilder");

// GET /api/reports/summary and /crime-distribution both take optional
// ?dateFrom&dateTo (YYYY-MM-DD) — defaulting to the current calendar
// month rather than an all-time total, so these headline numbers answer
// "how's this month going" instead of growing forever and meaning less
// every year the station's been using this system.
function resolveDateRange(query) {
  const now = new Date();
  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
  const dateTo = query.dateTo ? new Date(query.dateTo) : now;
  dateFrom.setHours(0, 0, 0, 0);
  dateTo.setHours(23, 59, 59, 999);
  return { dateFrom, dateTo };
}

// The real, selectable report categories — "inventory" is deliberately
// excluded here: it's the pre-split name for what's now "weapons", kept
// alive in ReportExport.REPORT_TYPES only so old rows still validate.
const REPORT_CATEGORY_TYPES = [
  "duty",
  "officers",
  "leave",
  "crime",
  "weapons",
  "ammunition",
  "ammo_stock",
  "maintenance",
  "inspections",
  "exceptions",
  "station",
  "performance",
];

// Which roles can generate/preview/download/see each category. Mirrors
// the sidebar's own role filtering on the client (Reports.jsx) — that
// copy decides what's *shown*, this one is what's actually *enforced*.
// "weapons" also covers "inventory" (its legacy name) so old rows stay
// reachable by whoever could reach them today.
const CATEGORY_ROLES = {
  duty: ["admin", "oic", "duty_officer"],
  officers: ["admin", "oic"],
  leave: ["admin", "oic"],
  crime: ["admin", "oic"],
  weapons: ["admin", "oic", "inventory_officer"],
  inventory: ["admin", "oic", "inventory_officer"],
  ammunition: ["admin", "oic", "inventory_officer"],
  ammo_stock: ["admin", "oic", "inventory_officer"],
  maintenance: ["admin", "oic", "inventory_officer"],
  inspections: ["admin", "oic", "inventory_officer"],
  exceptions: ["admin", "oic", "inventory_officer"],
  station: ["admin", "oic"],
  performance: ["admin", "oic"],
};

function canAccessCategory(role, type) {
  const allowed = CATEGORY_ROLES[type];
  return Array.isArray(allowed) && allowed.includes(role);
}

// GET /api/reports/summary — admin/oic only
// Matches the 3 top stat cards on page 16: Duty Summary %, Leave
// Statistics (days), Inventory Movements (item count). Scoped to
// ?dateFrom/?dateTo (default: current month) — see resolveDateRange.
async function getSummary(req, res) {
  try {
    const stationId = req.user.stationId;
    const { dateFrom, dateTo } = resolveDateRange(req.query);
    const dutyFilter = { stationId, date: { $gte: dateFrom, $lte: dateTo } };

    const totalShifts = await DutySchedule.countDocuments(dutyFilter);
    // "present" — the only status a shift's daily-attendance update
    // actually sets (see dutyScheduleController.js's update()/
    // createDailyChange()). This previously checked for "confirmed",
    // a status nothing in the system ever sets, so this stat card
    // silently reported 0% unconditionally.
    const presentShifts = await DutySchedule.countDocuments({ ...dutyFilter, status: "present" });
    const dutyCompliance = totalShifts > 0 ? (presentShifts / totalShifts) * 100 : 0;

    const approvedLeaves = await LeaveRequest.find({
      stationId,
      status: "approved",
      startDate: { $lte: dateTo },
      endDate: { $gte: dateFrom },
    });
    const totalLeaveDays = approvedLeaves.reduce((sum, l) => sum + l.days, 0);
    // Broken out by type too — a single lump total hid exactly the
    // distinction the Personal/Medical/Casual leave system (with its
    // rank-based caps and unlimited Medical) is actually built around.
    const leaveDaysByType = { personal: 0, medical: 0, casual: 0 };
    for (const l of approvedLeaves) {
      if (leaveDaysByType[l.leaveType] !== undefined) leaveDaysByType[l.leaveType] += l.days;
    }

    const inventoryMovements = await InventoryTransaction.countDocuments({
      stationId,
      dateTime: { $gte: dateFrom, $lte: dateTo },
    });

    return res.json({
      dutyCompliancePercent: Math.round(dutyCompliance * 10) / 10,
      leaveStatisticsDays: totalLeaveDays,
      leaveDaysByType,
      inventoryMovements,
      dateFrom: dateFrom.toISOString().slice(0, 10),
      dateTo: dateTo.toISOString().slice(0, 10),
    });
  } catch (err) {
    console.error("getSummary error:", err);
    return res.status(500).json({ error: "Could not load report summary" });
  }
}

// GET /api/reports/crime-distribution — admin/oic only
// Bar chart: complaint count grouped by category, matches "Crime
// Incidence Distribution" on page 16. Scoped to ?dateFrom/?dateTo
// (default: current month), same range as getSummary above it on the
// hub — otherwise a date picker that only affected some of the page
// would be more confusing than not having one.
async function getCrimeDistribution(req, res) {
  try {
    const { dateFrom, dateTo } = resolveDateRange(req.query);
    const results = await Complaint.aggregate([
      { $match: { stationId: req.user.stationId, dateOfIncident: { $gte: dateFrom, $lte: dateTo } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    return res.json(results.map((r) => ({ category: r._id, count: r.count })));
  } catch (err) {
    console.error("getCrimeDistribution error:", err);
    return res.status(500).json({ error: "Could not load crime distribution" });
  }
}

// GET /api/reports/force-strength?endDate=YYYY-MM-DD — admin/oic only
// Line chart: active duty vs on-leave personnel over 7 days ending at
// ?endDate (default: today), matches "Weekly Force Strength" on page 16.
// Still always exactly 7 days (unlike summary/crime-distribution, this
// one stays a fixed-width window, not an arbitrary range) — but an
// endDate lets the hub's own Reporting Period picker scroll it to a past
// week (e.g. picking "Last Month") instead of it always being locked to
// the current rolling week.
async function getForceStrength(req, res) {
  try {
    const stationId = req.user.stationId;
    const totalOfficers = await User.countDocuments({ stationId, status: "active" });
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    // Only published weeks matter — same "an officer's own duty status
    // only ever comes from a published plan" rule used everywhere else
    // duty status is computed (listMine, getBriefing, RosterSummary).
    const publishedWeeks = await DutyRosterWeek.find({ stationId, status: "published" }).select("_id weekStarting");

    // 7 days ending at endDate. "Active Duty" isn't just "not on
    // approved leave" — that undercounted every officer with no leave
    // request as if they weren't part of the force at all, and made the
    // chart flat whenever leave happened to not overlap the window.
    // Same "everyone not explicitly out counts as on duty (a specific
    // shift, or General Duty by default)" rule as getBriefing's
    // presentCount — just computed once per day here instead of only
    // for today.
    const days = [];
    for (let i = 6; i >= 0; i--) {
      // UTC, not local (setDate/setHours) — DutySchedule.date and
      // DutyRosterWeek.weekStarting are both stored as UTC midnight for
      // a calendar day (built from plain "YYYY-MM-DD" strings, which
      // parse as UTC per spec). This server runs at UTC+5:30 — a local
      // "today" boundary would sit 5.5 hours after the actual stored
      // UTC-midnight value, so a day's own shifts could fall just
      // before the query window and never match at all.
      const date = new Date(endDate);
      date.setUTCDate(date.getUTCDate() - i);
      date.setUTCHours(0, 0, 0, 0);
      const nextDay = new Date(date);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      const coveringWeek = publishedWeeks.find((w) => {
        const start = new Date(w.weekStarting);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 7);
        return date >= start && date < end;
      });

      const absentOfficerIds = new Set();
      if (coveringWeek) {
        const shifts = await DutySchedule.find({
          stationId,
          weekId: coveringWeek._id,
          date: { $gte: date, $lt: nextDay },
          status: { $ne: "removed" },
        }).select("officerId status");
        for (const s of shifts) {
          if (s.status === "absent") absentOfficerIds.add(s.officerId.toString());
        }
      }

      const approvedLeave = await LeaveRequest.find({
        stationId,
        status: "approved",
        startDate: { $lte: date },
        endDate: { $gte: date },
      }).select("officerId");
      // Don't double-count someone who's both marked absent from a
      // shift and separately has approved leave that day.
      const onLeaveCount = approvedLeave.filter((l) => !absentOfficerIds.has(l.officerId.toString())).length;

      const notOnDuty = absentOfficerIds.size + onLeaveCount;
      days.push({
        date: date.toISOString().slice(0, 10),
        activeDuty: Math.max(0, totalOfficers - notOnDuty),
        onLeave: notOnDuty,
      });
    }

    return res.json(days);
  } catch (err) {
    console.error("getForceStrength error:", err);
    return res.status(500).json({ error: "Could not load force strength data" });
  }
}

// GET /api/reports/complaint-trend?endDate=YYYY-MM-DD — admin/oic only
// Line/area chart: complaint volume by severity plus open-vs-resolved
// counts, one point per calendar month, for the 6 months ending in the
// month containing ?endDate (default: today). Crime Incidence
// Distribution already answers "what kind of complaints came in this
// range" as a single-range snapshot; this answers the question that
// snapshot can't — whether Grave Crime volume or the resolved share is
// trending up or down month over month. Always a fixed 6-month window
// (same reasoning as getForceStrength's fixed 7 days) rather than
// following the hub's arbitrary dateFrom/dateTo range, since a trend
// needs several comparable buckets and a short custom range wouldn't
// have enough of them to show a trend at all.
async function getComplaintTrend(req, res) {
  try {
    const stationId = req.user.stationId;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    // Anchor to the *first* day of endDate's month, in UTC — same
    // UTC-vs-local reasoning as getForceStrength: dateOfIncident is
    // stored as UTC midnight (parsed from a plain "YYYY-MM-DD" string),
    // so a local month boundary would sit 5.5 hours off and could clip
    // the first/last day's complaints out of their real bucket.
    const anchor = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
    const rangeStart = new Date(anchor);
    rangeStart.setUTCMonth(rangeStart.getUTCMonth() - 5);
    const rangeEnd = new Date(anchor);
    rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1); // exclusive — start of the month after the anchor

    const complaints = await Complaint.find({
      stationId,
      dateOfIncident: { $gte: rangeStart, $lt: rangeEnd },
    }).select("dateOfIncident severity status");

    const months = [];
    for (let i = 0; i < 6; i++) {
      const monthStart = new Date(rangeStart);
      monthStart.setUTCMonth(monthStart.getUTCMonth() + i);
      months.push({
        month: monthStart.toISOString().slice(0, 7), // "YYYY-MM"
        general: 0,
        serious: 0,
        graveCrime: 0,
        resolved: 0,
        open: 0,
        total: 0,
      });
    }

    for (const c of complaints) {
      const key = c.dateOfIncident.toISOString().slice(0, 7);
      const bucket = months.find((m) => m.month === key);
      if (!bucket) continue; // shouldn't happen given the query range, but don't let one bad row 500 the whole chart
      bucket.total += 1;
      if (c.severity === "Grave Crime") bucket.graveCrime += 1;
      else if (c.severity === "Serious") bucket.serious += 1;
      else bucket.general += 1;
      if (c.status === "closed") bucket.resolved += 1;
      else bucket.open += 1;
    }

    return res.json(months);
  } catch (err) {
    console.error("getComplaintTrend error:", err);
    return res.status(500).json({ error: "Could not load complaint trend data" });
  }
}

// GET /api/reports/activity-log?page=1&limit=10&type=duty
// "Recent Activity Logs" table: generated reports ready for download,
// backed by the ReportExport collection (see generateReport). `type` is
// optional — the hub view omits it (shows everything this role can see),
// the per-category workbench passes it so paging stays scoped to that
// category instead of paging through a mixed list.
async function getActivityLog(req, res) {
  try {
    const stationId = req.user.stationId;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

    const requestedType = req.query.type;
    const filter = { stationId };

    if (requestedType) {
      if (!ReportExport.REPORT_TYPES.includes(requestedType) || !canAccessCategory(req.user.role, requestedType)) {
        return res.status(403).json({ error: "You do not have permission to view this report category" });
      }
      // Reports logged before the Weapons/Ammunition split were saved as
      // "inventory" — fold those legacy rows into the "weapons" ledger so
      // history doesn't silently drop them.
      filter.type = requestedType === "weapons" ? { $in: ["weapons", "inventory"] } : requestedType;
    } else {
      // Unscoped "hub" view — only ever hit by admin/oic in practice
      // (every other role's sidebar only ever links to one category's
      // workbench), but scope it defensively to whatever this role can see.
      const visibleTypes = REPORT_CATEGORY_TYPES.filter((t) => canAccessCategory(req.user.role, t));
      if (visibleTypes.includes("weapons")) visibleTypes.push("inventory");
      filter.type = { $in: visibleTypes };
    }

    const [logs, total] = await Promise.all([
      ReportExport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ReportExport.countDocuments(filter),
    ]);

    return res.json({
      data: logs.map((l) => l.toJSON()),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    console.error("getActivityLog error:", err);
    return res.status(500).json({ error: "Could not load activity log" });
  }
}

// Human-readable title shown in the sidebar / used as the default report
// title. Kept separate from the enum value so the DB stores a stable key
// while the UI can still show a friendly label.
const REPORT_TYPE_LABELS = {
  duty: "Duty Compliance",
  officers: "Officer Roster",
  leave: "Leave Summary",
  crime: "Complaint Registry",
  inventory: "Weapons Issue & Return", // legacy rows only
  weapons: "Weapons Issue & Return",
  ammunition: "Ammunition Usage",
  ammo_stock: "Ammunition Stock",
  maintenance: "Weapon Maintenance",
  inspections: "Inspection History",
  exceptions: "Overdue & Discrepancies",
  station: "Station Summary",
  performance: "Officer Performance",
};

// Ceiling on how many rows a single report is allowed to pull into memory.
// Generous enough that normal usage (even a full year for one station)
// stays well under it, but it keeps worst-case request time and memory use
// predictable. Adjust here if it turns out to be too tight or too loose.
const MAX_REPORT_ROWS = 5000;

class ReportRowLimitError extends Error {
  constructor(count) {
    super(
      `This range has ${count} matching records, which is over the ${MAX_REPORT_ROWS} row limit. Please narrow the date range and try again.`
    );
    this.name = "ReportRowLimitError";
    this.count = count;
  }
}

// Cheap count-only check run before a report type pulls its matching rows
// into memory. Without this, an open-ended date range (e.g. "since 2015")
// on a mature station could mean loading tens of thousands of documents —
// and then PDF-rendering them — in a single request, hanging or crashing
// the server. countDocuments() answers "how many would this match?"
// without fetching them, so the guard itself stays fast even when the
// range is huge.
async function guardRowCount(Model, filter) {
  const count = await Model.countDocuments(filter);
  if (count > MAX_REPORT_ROWS) throw new ReportRowLimitError(count);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Which extra filter keys each category accepts, and which of those keys
// are officer ObjectIds (validated below rather than trusted from the
// client). Unknown keys the client sends are silently dropped — only
// these are ever read by gatherReportData.
const FILTER_KEYS_BY_TYPE = {
  duty: ["officerId", "shiftType", "department"],
  officers: ["role", "status", "department"],
  leave: ["leaveType", "status", "officerId"],
  crime: ["category", "status", "priority", "assignedOfficerId"],
  weapons: ["transactionType", "officerId"],
  ammunition: ["officerId"],
  ammo_stock: [],
  maintenance: ["status"],
  inspections: ["result"],
  exceptions: ["exceptionType"],
  station: [],
  performance: ["department"],
};
const OBJECT_ID_FILTER_KEYS = new Set(["officerId", "assignedOfficerId"]);

// Drops anything not on this type's whitelist and any officer id that
// isn't a valid ObjectId, rather than letting a bad value reach Mongoose
// and blow up the query with a CastError.
function sanitizeFilters(type, rawFilters) {
  const allowedKeys = FILTER_KEYS_BY_TYPE[type] || [];
  const clean = {};
  for (const key of allowedKeys) {
    const value = rawFilters && rawFilters[key];
    if (value === undefined || value === null || value === "") continue;
    if (OBJECT_ID_FILTER_KEYS.has(key) && !mongoose.Types.ObjectId.isValid(value)) continue;
    clean[key] = value;
  }
  return clean;
}

const FILTER_LABELS = {
  officerId: "Officer",
  assignedOfficerId: "Officer",
  shiftType: "Shift",
  department: "Department",
  role: "Role",
  status: "Status",
  leaveType: "Leave Type",
  category: "Category",
  priority: "Priority",
  transactionType: "Transaction Type",
  result: "Result",
  exceptionType: "Exception",
};

// Turns a stored filters object into the "Filters applied: …" line on the
// PDF, resolving officer ids to a readable name instead of printing a
// bare ObjectId.
async function describeFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) return "";
  const parts = [];
  for (const [key, value] of Object.entries(filters)) {
    let displayValue = value;
    if (OBJECT_ID_FILTER_KEYS.has(key)) {
      const officer = await User.findById(value).select("fullName rankAndNumber").lean();
      displayValue = officer ? `${officer.fullName} (${officer.rankAndNumber})` : "Unknown officer";
    }
    parts.push(`${FILTER_LABELS[key] || key}: ${displayValue}`);
  }
  return parts.join(", ");
}

// Builds the {columns, rows} table for a given report type + date range +
// filters. Every report type funnels through here so generateReport
// (persists the log entry), previewReport (shows it before committing),
// and downloadReport (regenerates the file on demand) always produce
// identical data for the same params.
async function gatherReportData(type, stationId, dateFrom, dateTo, filters = {}) {
  if (type === "duty") {
    const filter = { stationId, date: { $gte: dateFrom, $lte: dateTo } };
    if (filters.officerId) filter.officerId = filters.officerId;
    if (filters.shiftType) filter.shiftType = filters.shiftType;
    if (filters.department) filter.department = new RegExp(escapeRegex(filters.department), "i");
    await guardRowCount(DutySchedule, filter);
    const rows = await DutySchedule.find(filter)
      .populate("officerId", "fullName rankAndNumber")
      .sort({ date: 1 })
      .lean();

    return {
      columns: [
        { key: "date", label: "Date" },
        { key: "officer", label: "Officer" },
        { key: "shift", label: "Shift" },
        { key: "department", label: "Department" },
        { key: "status", label: "Status" },
      ],
      rows: rows.map((r) => ({
        date: r.date?.toISOString().slice(0, 10),
        officer: r.officerId?.fullName || r.officerId?.rankAndNumber || "—",
        shift: `${r.shiftStart} - ${r.shiftEnd}`,
        department: r.department || "—",
        status: r.status || "—",
      })),
    };
  }

  if (type === "officers") {
    const filter = { stationId, createdAt: { $gte: dateFrom, $lte: dateTo } };
    if (filters.role) filter.role = filters.role;
    if (filters.status) filter.status = filters.status;
    if (filters.department) filter.department = new RegExp(escapeRegex(filters.department), "i");
    await guardRowCount(User, filter);
    const rows = await User.find(filter).sort({ createdAt: 1 }).lean();

    return {
      columns: [
        { key: "rankAndNumber", label: "Rank & Number" },
        { key: "fullName", label: "Full Name" },
        { key: "role", label: "Role" },
        { key: "department", label: "Department" },
        { key: "status", label: "Status" },
        { key: "joined", label: "Joined" },
      ],
      rows: rows.map((r) => ({
        rankAndNumber: r.rankAndNumber,
        fullName: r.fullName,
        role: r.role,
        department: r.department || "—",
        status: r.status,
        joined: r.createdAt?.toISOString().slice(0, 10),
      })),
    };
  }

  if (type === "leave") {
    const filter = { stationId, startDate: { $lte: dateTo }, endDate: { $gte: dateFrom } };
    if (filters.leaveType) filter.leaveType = filters.leaveType;
    if (filters.status) filter.status = filters.status;
    if (filters.officerId) filter.officerId = filters.officerId;
    await guardRowCount(LeaveRequest, filter);
    const rows = await LeaveRequest.find(filter)
      .sort({ startDate: 1 })
      .lean();

    return {
      columns: [
        { key: "refId", label: "Ref ID" },
        { key: "officer", label: "Officer" },
        { key: "leaveType", label: "Type" },
        { key: "startDate", label: "Start" },
        { key: "endDate", label: "End" },
        { key: "days", label: "Days" },
        { key: "status", label: "Status" },
      ],
      rows: rows.map((r) => ({
        refId: r.refId,
        officer: r.officerName,
        leaveType: r.leaveType,
        startDate: r.startDate?.toISOString().slice(0, 10),
        endDate: r.endDate?.toISOString().slice(0, 10),
        days: r.days,
        status: r.status,
      })),
    };
  }

  if (type === "crime") {
    const filter = { stationId, dateOfIncident: { $gte: dateFrom, $lte: dateTo } };
    if (filters.category) filter.category = filters.category;
    if (filters.status) filter.status = filters.status;
    if (filters.priority) filter.priority = filters.priority;
    if (filters.assignedOfficerId) filter.assignedOfficerId = filters.assignedOfficerId;
    await guardRowCount(Complaint, filter);
    const rows = await Complaint.find(filter)
      .sort({ dateOfIncident: 1 })
      .lean();

    return {
      columns: [
        { key: "refId", label: "Ref ID" },
        { key: "category", label: "Category" },
        { key: "severity", label: "Severity" },
        { key: "status", label: "Status" },
        { key: "date", label: "Date" },
      ],
      rows: rows.map((r) => ({
        refId: r.refId,
        category: r.category,
        severity: r.severity,
        status: r.status,
        date: r.dateOfIncident?.toISOString().slice(0, 10),
      })),
    };
  }

  if (type === "inventory" || type === "weapons") {
    const filter = { stationId, dateTime: { $gte: dateFrom, $lte: dateTo } };
    if (filters.transactionType) filter.type = filters.transactionType;
    if (filters.officerId) filter.officerId = filters.officerId;
    await guardRowCount(InventoryTransaction, filter);
    const rows = await InventoryTransaction.find(filter)
      .populate("officerId", "fullName rankAndNumber")
      .sort({ dateTime: 1 })
      .lean();

    // InventoryTransaction.itemId points at the Inventory collection, but
    // (see Inventory model vs InventoryTransaction's ref name) it isn't a
    // populate-safe ref, so items are looked up manually instead.
    const itemIds = [...new Set(rows.map((r) => String(r.itemId)))];
    const items = await Inventory.find({ _id: { $in: itemIds } }).lean();
    const itemNameById = new Map(items.map((i) => [String(i._id), `${i.itemName} (${i.itemId})`]));

    return {
      columns: [
        { key: "date", label: "Date" },
        { key: "item", label: "Item" },
        { key: "type", label: "Type" },
        { key: "quantity", label: "Qty" },
        { key: "officer", label: "Officer" },
        { key: "condition", label: "Condition" },
      ],
      rows: rows.map((r) => ({
        date: r.dateTime?.toISOString().slice(0, 10),
        item: itemNameById.get(String(r.itemId)) || String(r.itemId),
        type: r.type,
        quantity: r.quantity,
        officer: r.officerId?.fullName || r.officerId?.rankAndNumber || "—",
        condition: r.condition || "—",
      })),
    };
  }

  if (type === "ammunition") {
    // Rounds are reconciled at return time: issued (from the issue
    // record), counted back, used = issued - returned, and what the
    // officer declared fired. Discrepancy is used - declared.
    const filter = {
      stationId,
      dateTime: { $gte: dateFrom, $lte: dateTo },
      type: { $in: ["return", "damaged"] },
      $or: [{ ammoIssued: { $ne: null } }, { ammoReturned: { $ne: null } }, { ammoUsed: { $ne: null } }],
    };
    if (filters.officerId) filter.officerId = filters.officerId;
    await guardRowCount(InventoryTransaction, filter);
    const rows = await InventoryTransaction.find(filter)
      .populate("officerId", "fullName rankAndNumber")
      .sort({ dateTime: 1 })
      .lean();

    const itemIds = [...new Set(rows.flatMap((r) => [String(r.itemId), r.ammoItemId && String(r.ammoItemId)]).filter(Boolean))];
    const items = await Inventory.find({ _id: { $in: itemIds } }).lean();
    const itemNameById = new Map(items.map((i) => [String(i._id), `${i.itemName} (${i.itemId})`]));

    return {
      columns: [
        { key: "date", label: "Date" },
        { key: "item", label: "Weapon" },
        { key: "ammo", label: "Ammunition" },
        { key: "officer", label: "Officer" },
        { key: "ammoIssued", label: "Issued" },
        { key: "ammoReturned", label: "Returned" },
        { key: "ammoUsed", label: "Used" },
        { key: "ammoDeclaredUsed", label: "Declared Used" },
        { key: "ammoDiscrepancy", label: "Discrepancy" },
      ],
      rows: rows.map((r) => ({
        date: r.dateTime?.toISOString().slice(0, 10),
        item: itemNameById.get(String(r.itemId)) || String(r.itemId),
        ammo: r.ammoItemId ? itemNameById.get(String(r.ammoItemId)) || "—" : "—",
        officer: r.officerId?.fullName || r.officerId?.rankAndNumber || "—",
        ammoIssued: r.ammoIssued ?? 0,
        ammoReturned: r.ammoReturned ?? 0,
        ammoUsed: r.ammoUsed ?? 0,
        ammoDeclaredUsed: r.ammoDeclaredUsed ?? "—",
        ammoDiscrepancy: r.ammoDiscrepancy ?? "—",
      })),
    };
  }

  if (type === "ammo_stock") {
    // A snapshot of current stock per ammunition line plus how many
    // rounds went out / came back in the selected period.
    const lines = await Inventory.find({ stationId, category: AMMUNITION_CATEGORY }).sort({ itemName: 1 }).lean();
    const movements = await InventoryTransaction.find({
      stationId,
      ammoItemId: { $in: lines.map((l) => l._id) },
      dateTime: { $gte: dateFrom, $lte: dateTo },
    }).lean();
    const issuedBy = new Map();
    const returnedBy = new Map();
    for (const m of movements) {
      const key = String(m.ammoItemId);
      if (m.type === "issue") issuedBy.set(key, (issuedBy.get(key) || 0) + (m.ammoIssued || 0));
      else returnedBy.set(key, (returnedBy.get(key) || 0) + (m.ammoReturned || 0));
    }

    return {
      columns: [
        { key: "batch", label: "Batch / Lot" },
        { key: "type", label: "Ammunition Type" },
        { key: "location", label: "Storage" },
        { key: "inStock", label: "In Stock" },
        { key: "threshold", label: "Low-Stock Threshold" },
        { key: "issued", label: "Issued (period)" },
        { key: "returned", label: "Returned (period)" },
        { key: "state", label: "Status" },
      ],
      rows: lines.map((l) => ({
        batch: l.itemId,
        type: l.itemName,
        location: l.storageLocation || "—",
        inStock: l.quantity,
        threshold: l.lowStockThreshold ?? "—",
        issued: issuedBy.get(String(l._id)) || 0,
        returned: returnedBy.get(String(l._id)) || 0,
        state: l.lowStockThreshold !== null && l.lowStockThreshold !== undefined && l.quantity <= l.lowStockThreshold ? "LOW" : l.status,
      })),
    };
  }

  if (type === "maintenance") {
    const filter = { stationId, reportedDate: { $gte: dateFrom, $lte: dateTo } };
    if (filters.status) filter.status = filters.status;
    await guardRowCount(Maintenance, filter);
    const rows = await Maintenance.find(filter)
      .populate("itemId", "itemId itemName")
      .populate("reportedBy", "fullName")
      .sort({ reportedDate: 1 })
      .lean();

    return {
      columns: [
        { key: "refId", label: "Ref ID" },
        { key: "weapon", label: "Weapon" },
        { key: "issue", label: "Issue" },
        { key: "type", label: "Type" },
        { key: "technician", label: "Assigned To" },
        { key: "parts", label: "Parts" },
        { key: "totalCost", label: "Total Cost (LKR)" },
        { key: "reported", label: "Reported" },
        { key: "completed", label: "Completed" },
        { key: "status", label: "Status" },
        { key: "result", label: "Final Inspection" },
        { key: "backInStock", label: "Returned to Stock" },
      ],
      rows: rows.map((r) => ({
        refId: r.refId,
        weapon: r.itemId ? `${r.itemId.itemName} (${r.itemId.itemId})` : "—",
        issue: r.issueDescription,
        type: r.maintenanceType,
        technician: r.assignedTechnician || "—",
        // "2 × Firing Pin; 1 × Recoil Spring" — falls back to the old
        // free-text note on records from before the itemised list.
        parts: r.parts?.length ? r.parts.map((p) => `${p.quantity} × ${p.name}`).join("; ") : r.partsCost || "—",
        totalCost: r.parts?.length ? (r.totalCost || 0).toFixed(2) : "—",
        reported: r.reportedDate?.toISOString().slice(0, 10),
        completed: r.completionDate ? r.completionDate.toISOString().slice(0, 10) : "—",
        status: r.status,
        result: r.finalInspectionPassed === null || r.finalInspectionPassed === undefined ? "—" : r.finalInspectionPassed ? "Passed" : "Failed",
        backInStock: r.returnedToStockAt
          ? r.returnedToStockAt.toISOString().slice(0, 10)
          : r.finalInspectionPassed
            ? "Awaiting"
            : "—",
      })),
    };
  }

  if (type === "inspections") {
    const filter = { stationId, inspectionDate: { $gte: dateFrom, $lte: dateTo } };
    if (filters.result) filter.result = filters.result;
    await guardRowCount(Inspection, filter);
    const rows = await Inspection.find(filter)
      .populate("itemId", "itemId itemName")
      .populate("inspectedBy", "fullName")
      .sort({ inspectionDate: 1 })
      .lean();

    return {
      columns: [
        { key: "refId", label: "Ref ID" },
        { key: "date", label: "Date" },
        { key: "weapon", label: "Weapon" },
        { key: "inspector", label: "Inspected By" },
        { key: "type", label: "Type" },
        { key: "condition", label: "Condition" },
        { key: "result", label: "Result" },
        { key: "next", label: "Next Due" },
      ],
      rows: rows.map((r) => ({
        refId: r.refId,
        date: r.inspectionDate?.toISOString().slice(0, 10),
        weapon: r.itemId ? `${r.itemId.itemName} (${r.itemId.itemId})` : "—",
        inspector: r.inspectedBy?.fullName || "—",
        type: r.inspectionType,
        condition: r.condition,
        result: r.result,
        next: r.nextInspectionDate ? r.nextInspectionDate.toISOString().slice(0, 10) : "—",
      })),
    };
  }

  if (type === "exceptions") {
    // Everything that needed someone's review: overdue returns,
    // unconfirmed transactions, ammo discrepancies, missing weapons,
    // missing accessories, low ammo stock — read straight off the alert
    // trail, which already records who handled each one and when.
    const EXCEPTION_ALERT_TYPES = {
      return_overdue: "Overdue Return",
      confirmation_overdue: "Unconfirmed Transaction",
      ammo_discrepancy: "Ammunition Discrepancy",
      weapon_missing: "Missing Weapon",
      accessories_missing: "Missing Accessories",
      low_ammo_stock: "Low Ammunition Stock",
    };
    const types = filters.exceptionType && EXCEPTION_ALERT_TYPES[filters.exceptionType]
      ? [filters.exceptionType]
      : Object.keys(EXCEPTION_ALERT_TYPES);
    const filter = { stationId, alertType: { $in: types }, generatedAt: { $gte: dateFrom, $lte: dateTo } };
    await guardRowCount(Alert, filter);
    const rows = await Alert.find(filter)
      .populate("itemId", "itemId itemName")
      .populate("recipientId", "fullName")
      .populate("resolvedBy", "fullName")
      .sort({ generatedAt: 1 })
      .lean();

    return {
      columns: [
        { key: "refId", label: "Ref ID" },
        { key: "date", label: "Raised" },
        { key: "kind", label: "Exception" },
        { key: "item", label: "Item" },
        { key: "officer", label: "Officer" },
        { key: "detail", label: "Detail" },
        { key: "status", label: "Status" },
        { key: "resolvedBy", label: "Resolved By" },
      ],
      rows: rows.map((r) => ({
        refId: r.refId,
        date: r.generatedAt?.toISOString().slice(0, 16).replace("T", " "),
        kind: EXCEPTION_ALERT_TYPES[r.alertType],
        item: r.itemId ? `${r.itemId.itemName} (${r.itemId.itemId})` : "—",
        officer: r.recipientId?.fullName || "—",
        detail: r.message,
        status: r.status,
        resolvedBy: r.resolvedBy?.fullName || "—",
      })),
    };
  }

  if (type === "station") {
    // A rollup, not a record ledger — one row per station-wide metric for
    // the period, reusing the same counts the hub's Overview cards use.
    // Bounded to a handful of rows, so no guardRowCount needed here.
    const dutyFilter = { stationId, date: { $gte: dateFrom, $lte: dateTo } };
    const [totalShifts, confirmedShifts] = await Promise.all([
      DutySchedule.countDocuments(dutyFilter),
      // "present", not "confirmed" — see getSummary's comment above.
      DutySchedule.countDocuments({ ...dutyFilter, status: "present" }),
    ]);

    const approvedLeaves = await LeaveRequest.find({
      stationId,
      status: "approved",
      startDate: { $lte: dateTo },
      endDate: { $gte: dateFrom },
    }).lean();
    const leaveDays = approvedLeaves.reduce((sum, l) => sum + (l.days || 0), 0);

    const [weaponsIssued, weaponsReturned] = await Promise.all([
      InventoryTransaction.countDocuments({ stationId, dateTime: { $gte: dateFrom, $lte: dateTo }, type: "issue" }),
      InventoryTransaction.countDocuments({ stationId, dateTime: { $gte: dateFrom, $lte: dateTo }, type: "return" }),
    ]);

    const complaintFilter = { stationId, createdAt: { $gte: dateFrom, $lte: dateTo } };
    const [complaintsRegistered, complaintsResolved] = await Promise.all([
      Complaint.countDocuments(complaintFilter),
      Complaint.countDocuments({ ...complaintFilter, status: "closed" }),
    ]);

    const activeOfficers = await User.countDocuments({ stationId, status: "active" });

    return {
      columns: [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" },
      ],
      rows: [
        { metric: "Total Duty Shifts", value: totalShifts },
        { metric: "Confirmed Duty Shifts", value: confirmedShifts },
        { metric: "Leave Days Approved", value: leaveDays },
        { metric: "Weapons Issued", value: weaponsIssued },
        { metric: "Weapons Returned", value: weaponsReturned },
        { metric: "Complaints Registered", value: complaintsRegistered },
        { metric: "Complaints Resolved", value: complaintsResolved },
        { metric: "Active Officers (current)", value: activeOfficers },
      ],
    };
  }

  if (type === "performance") {
    // One row per active officer, not one row per event — same rollup
    // shape as "station" above, just per-officer instead of per-metric.
    // Answers "how is officer X doing" (attendance, caseload, leave
    // taken), which nothing else in Reports could show before this —
    // every other category is a raw, unaggregated record ledger.
    const officerFilter = { stationId, status: "active" };
    if (filters.department) officerFilter.department = new RegExp(escapeRegex(filters.department), "i");
    const officers = await User.find(officerFilter).select("fullName rankAndNumber department").sort({ fullName: 1 }).lean();
    const officerIds = officers.map((o) => o._id);

    const [shifts, complaints, leaves] = await Promise.all([
      // Only present/absent — "pending" (a future/unresolved shift) and
      // "removed" aren't attendance outcomes, so they're excluded from
      // both the counts and the attendance-rate denominator.
      DutySchedule.find({
        stationId,
        officerId: { $in: officerIds },
        date: { $gte: dateFrom, $lte: dateTo },
        status: { $in: ["present", "absent"] },
      }).select("officerId status").lean(),
      // createdAt, not dateOfIncident — this is about how busy the
      // officer actually was during the period, not when the incident
      // itself happened (which can be much older if reported late).
      Complaint.find({
        stationId,
        assignedOfficerId: { $in: officerIds },
        createdAt: { $gte: dateFrom, $lte: dateTo },
      }).select("assignedOfficerId status").lean(),
      LeaveRequest.find({
        stationId,
        officerId: { $in: officerIds },
        status: "approved",
        startDate: { $lte: dateTo },
        endDate: { $gte: dateFrom },
      }).select("officerId days").lean(),
    ]);

    const presentByOfficer = new Map();
    const absentByOfficer = new Map();
    for (const s of shifts) {
      const key = String(s.officerId);
      const map = s.status === "present" ? presentByOfficer : absentByOfficer;
      map.set(key, (map.get(key) || 0) + 1);
    }

    const assignedByOfficer = new Map();
    const resolvedByOfficer = new Map();
    for (const c of complaints) {
      const key = String(c.assignedOfficerId);
      assignedByOfficer.set(key, (assignedByOfficer.get(key) || 0) + 1);
      if (c.status === "closed") resolvedByOfficer.set(key, (resolvedByOfficer.get(key) || 0) + 1);
    }

    const leaveDaysByOfficer = new Map();
    for (const l of leaves) {
      const key = String(l.officerId);
      leaveDaysByOfficer.set(key, (leaveDaysByOfficer.get(key) || 0) + (l.days || 0));
    }

    const rows = officers.map((o) => {
      const key = String(o._id);
      const present = presentByOfficer.get(key) || 0;
      const absent = absentByOfficer.get(key) || 0;
      const recorded = present + absent;
      return {
        rankAndNumber: o.rankAndNumber,
        fullName: o.fullName,
        department: o.department || "—",
        present,
        absent,
        attendanceRate: recorded > 0 ? Math.round((present / recorded) * 1000) / 10 : "",
        complaintsAssigned: assignedByOfficer.get(key) || 0,
        complaintsResolved: resolvedByOfficer.get(key) || 0,
        leaveDaysTaken: leaveDaysByOfficer.get(key) || 0,
      };
    });

    return {
      columns: [
        { key: "rankAndNumber", label: "Rank & Number" },
        { key: "fullName", label: "Officer" },
        { key: "department", label: "Department" },
        { key: "present", label: "Present" },
        { key: "absent", label: "Absent" },
        { key: "attendanceRate", label: "Attendance %" },
        { key: "complaintsAssigned", label: "Complaints Assigned" },
        { key: "complaintsResolved", label: "Complaints Resolved" },
        { key: "leaveDaysTaken", label: "Leave Days Taken" },
      ],
      rows,
    };
  }

  throw new Error(`Unknown report type: ${type}`);
}

// Small per-type stat cards shown at the top of the preview panel, above
// the full data table — the "at a glance" numbers the spec's preview
// mockup calls out (Issued/Returned/Used etc). Derived from the same
// rows gatherReportData already produced, not a second query.
function computeSummary(type, rows) {
  switch (type) {
    case "duty":
      // "present", not "confirmed" — see getSummary's comment above.
      return { "Total Shifts": rows.length, "Confirmed": rows.filter((r) => r.status === "present").length };
    case "officers":
      return { "Total Officers": rows.length, "Active": rows.filter((r) => r.status === "active").length };
    case "leave":
      return {
        "Requests": rows.length,
        "Total Days": rows.reduce((sum, r) => sum + (r.days || 0), 0),
      };
    case "crime":
      return { "Total": rows.length, "Resolved": rows.filter((r) => r.status === "closed").length };
    case "inventory":
    case "weapons":
      return {
        "Issued": rows.filter((r) => r.type === "issue").length,
        "Returned": rows.filter((r) => r.type === "return").length,
        "Damaged": rows.filter((r) => r.type === "damaged").length,
      };
    case "ammunition":
      return {
        "Ammo Issued": rows.reduce((sum, r) => sum + (r.ammoIssued || 0), 0),
        "Ammo Returned": rows.reduce((sum, r) => sum + (r.ammoReturned || 0), 0),
        "Ammo Used": rows.reduce((sum, r) => sum + (r.ammoUsed || 0), 0),
      };
    case "performance": {
      const rates = rows.map((r) => r.attendanceRate).filter((v) => typeof v === "number");
      const avgAttendance = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : "—";
      return {
        "Officers": rows.length,
        "Avg Attendance %": avgAttendance,
        "Total Complaints Assigned": rows.reduce((sum, r) => sum + (r.complaintsAssigned || 0), 0),
      };
    }
    default:
      return {};
  }
}

function parseDateRange(body) {
  const dateFrom = body.dateFrom ? new Date(body.dateFrom) : null;
  const dateTo = body.dateTo ? new Date(body.dateTo) : null;
  if (!dateFrom || !dateTo || Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return null;
  }
  // Include the entire "to" day rather than cutting off at 00:00.
  dateTo.setHours(23, 59, 59, 999);
  return { dateFrom, dateTo };
}

// POST /api/reports/preview
// Body: { type, dateFrom, dateTo, filters? }
// Same validation/query as generateReport, but doesn't persist anything —
// lets the workbench show what the report will contain (summary cards +
// a capped table) before the officer commits to logging/downloading it.
// Rows are capped here purely to keep the response light; downloadReport
// re-runs the same query without this cap (up to MAX_REPORT_ROWS).
const PREVIEW_ROW_LIMIT = 200;

async function previewReport(req, res) {
  const { type } = req.body;
  const range = parseDateRange(req.body);

  if (!REPORT_CATEGORY_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unknown or unsupported report type" });
  }
  if (!canAccessCategory(req.user.role, type)) {
    return res.status(403).json({ error: "You do not have permission to preview this report" });
  }
  if (!range) {
    return res.status(400).json({ error: "A valid dateFrom and dateTo are required" });
  }

  const filters = sanitizeFilters(type, req.body.filters);

  try {
    const { columns, rows } = await gatherReportData(type, req.user.stationId, range.dateFrom, range.dateTo, filters);
    return res.json({
      columns,
      rows: rows.slice(0, PREVIEW_ROW_LIMIT),
      total: rows.length,
      truncated: rows.length > PREVIEW_ROW_LIMIT,
      summary: computeSummary(type, rows),
    });
  } catch (err) {
    if (err instanceof ReportRowLimitError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("previewReport error:", err);
    return res.status(500).json({ error: "Could not preview report" });
  }
}

// POST /api/reports/generate
// Body: { type, format, dateFrom, dateTo, title?, filters? }
// Runs the query for the requested range up front (so a broken filter
// fails loudly here, not silently at download time) and logs the export
// in ReportExport. The file itself isn't stored — downloadReport
// re-runs the same query (+ the same filters) from the saved params.
async function generateReport(req, res) {
  const { type, format, title } = req.body;
  const range = parseDateRange(req.body);

  if (!REPORT_CATEGORY_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unknown or unsupported report type" });
  }
  if (!canAccessCategory(req.user.role, type)) {
    return res.status(403).json({ error: "You do not have permission to generate this report" });
  }
  if (!ReportExport.REPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: "Format must be pdf or csv" });
  }
  if (!range) {
    return res.status(400).json({ error: "A valid dateFrom and dateTo are required" });
  }

  const filters = sanitizeFilters(type, req.body.filters);

  try {
    const stationId = req.user.stationId;
    // Validates the query works before we log it as "Complete".
    await gatherReportData(type, stationId, range.dateFrom, range.dateTo, filters);

    const requester = await User.findById(req.user.uid);

    const record = await ReportExport.create({
      title: title?.trim() || REPORT_TYPE_LABELS[type],
      type,
      format,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      filters,
      generatedById: req.user.uid,
      generatedByName: requester?.fullName || "Unknown",
      status: "Complete",
      stationId,
    });

    return res.status(201).json(record.toJSON());
  } catch (err) {
    if (err instanceof ReportRowLimitError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("generateReport error:", err);
    return res.status(500).json({ error: "Could not generate report" });
  }
}

// GET /api/reports/:id/download
// Regenerates the file from the stored params (date range + filters) and
// streams it back.
async function downloadReport(req, res) {
  try {
    const record = await ReportExport.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!canAccessCategory(req.user.role, record.type)) {
      return res.status(403).json({ error: "You do not have permission to download this report" });
    }

    const { columns, rows } = await gatherReportData(
      record.type,
      record.stationId,
      record.dateFrom,
      record.dateTo,
      record.filters || {}
    );
    const safeName = record.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    if (record.format === "csv") {
      const csv = buildCsv(columns, rows);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
      return res.send(csv);
    }

    const filterSummary = await describeFilters(record.filters);

    const pdfBuffer = await buildPdf({
      title: record.title,
      subtitle: REPORT_TYPE_LABELS[record.type],
      reportRef: `RPT-${record.id.slice(-6).toUpperCase()}`,
      meta: [
        ["Date range", `${record.dateFrom.toISOString().slice(0, 10)} to ${record.dateTo.toISOString().slice(0, 10)}`],
        ["Filters applied", filterSummary || "None"],
        ["Generated by", record.generatedByName],
        ["Generated on", record.createdAt.toISOString().slice(0, 10)],
      ],
      columns,
      rows,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    if (err instanceof ReportRowLimitError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("downloadReport error:", err);
    return res.status(500).json({ error: "Could not generate the report file" });
  }
}

// PATCH /api/reports/:id/archive
async function archiveReport(req, res) {
  try {
    const record = await ReportExport.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!canAccessCategory(req.user.role, record.type)) {
      return res.status(403).json({ error: "You do not have permission to archive this report" });
    }
    record.status = "Archived";
    await record.save();
    return res.json(record.toJSON());
  } catch (err) {
    console.error("archiveReport error:", err);
    return res.status(500).json({ error: "Could not archive report" });
  }
}

// DELETE /api/reports/:id
async function deleteReport(req, res) {
  try {
    const record = await ReportExport.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!canAccessCategory(req.user.role, record.type)) {
      return res.status(403).json({ error: "You do not have permission to delete this report" });
    }
    await record.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteReport error:", err);
    return res.status(500).json({ error: "Could not delete report" });
  }
}

module.exports = {
  getSummary,
  getCrimeDistribution,
  getForceStrength,
  getComplaintTrend,
  getActivityLog,
  previewReport,
  generateReport,
  downloadReport,
  archiveReport,
  deleteReport,
};
