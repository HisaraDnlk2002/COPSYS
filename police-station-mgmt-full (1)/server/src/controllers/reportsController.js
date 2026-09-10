const mongoose = require("mongoose");
const LeaveRequest = require("../models/LeaveRequest");
const DutySchedule = require("../models/DutySchedule");
const InventoryTransaction = require("../models/InventoryTransaction");
const Inventory = require("../models/Inventory");
const Complaint = require("../models/Complaint");
const User = require("../models/User");
const ReportExport = require("../models/ReportExport");
const { buildCsv, buildPdf } = require("../utils/reportFileBuilder");

// The real, selectable report categories — "inventory" is deliberately
// excluded here: it's the pre-split name for what's now "weapons", kept
// alive in ReportExport.REPORT_TYPES only so old rows still validate.
const REPORT_CATEGORY_TYPES = ["duty", "officers", "leave", "crime", "weapons", "ammunition", "station"];

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
  station: ["admin", "oic"],
};

function canAccessCategory(role, type) {
  const allowed = CATEGORY_ROLES[type];
  return Array.isArray(allowed) && allowed.includes(role);
}

// GET /api/reports/summary — admin/oic only
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

// GET /api/reports/crime-distribution — admin/oic only
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

// GET /api/reports/force-strength — admin/oic only
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
  station: "Station Summary",
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
  station: [],
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
    // Ammo is only ever reconciled at return/damaged time (see
    // InventoryTransaction's ammoIssued/ammoReturned/ammoUsed comment) —
    // there's no separate ammo stock ledger, so this report reads those
    // fields straight off the weapon transactions that carry them.
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

    const itemIds = [...new Set(rows.map((r) => String(r.itemId)))];
    const items = await Inventory.find({ _id: { $in: itemIds } }).lean();
    const itemNameById = new Map(items.map((i) => [String(i._id), `${i.itemName} (${i.itemId})`]));

    return {
      columns: [
        { key: "date", label: "Date" },
        { key: "item", label: "Weapon" },
        { key: "officer", label: "Officer" },
        { key: "type", label: "Transaction" },
        { key: "ammoIssued", label: "Ammo Issued" },
        { key: "ammoReturned", label: "Ammo Returned" },
        { key: "ammoUsed", label: "Ammo Used" },
      ],
      rows: rows.map((r) => ({
        date: r.dateTime?.toISOString().slice(0, 10),
        item: itemNameById.get(String(r.itemId)) || String(r.itemId),
        officer: r.officerId?.fullName || r.officerId?.rankAndNumber || "—",
        type: r.type,
        ammoIssued: r.ammoIssued ?? 0,
        ammoReturned: r.ammoReturned ?? 0,
        ammoUsed: r.ammoUsed ?? 0,
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
      DutySchedule.countDocuments({ ...dutyFilter, status: "confirmed" }),
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

  throw new Error(`Unknown report type: ${type}`);
}

// Small per-type stat cards shown at the top of the preview panel, above
// the full data table — the "at a glance" numbers the spec's preview
// mockup calls out (Issued/Returned/Used etc). Derived from the same
// rows gatherReportData already produced, not a second query.
function computeSummary(type, rows) {
  switch (type) {
    case "duty":
      return { "Total Shifts": rows.length, "Confirmed": rows.filter((r) => r.status === "confirmed").length };
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
  getActivityLog,
  previewReport,
  generateReport,
  downloadReport,
  archiveReport,
  deleteReport,
};
