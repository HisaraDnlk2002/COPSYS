const LeaveRequest = require("../models/LeaveRequest");
const DutySchedule = require("../models/DutySchedule");
const InventoryTransaction = require("../models/InventoryTransaction");
const Inventory = require("../models/Inventory");
const Complaint = require("../models/Complaint");
const User = require("../models/User");
const ReportExport = require("../models/ReportExport");
const { buildCsv, buildPdf } = require("../utils/reportFileBuilder");

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

// GET /api/reports/activity-log?page=1&limit=10&type=duty — oic only
// "Recent Activity Logs" table on page 16: generated reports ready for
// download, backed by the ReportExport collection (see generateReport).
// `type` is optional — the hub view omits it (shows everything), the
// per-category workbench passes it so paging stays scoped to that
// category instead of paging through a mixed list.
async function getActivityLog(req, res) {
  try {
    const stationId = req.user.stationId;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

    const filter = { stationId };
    if (req.query.type && ReportExport.REPORT_TYPES.includes(req.query.type)) {
      filter.type = req.query.type;
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
  leave: "Leave Summary",
  inventory: "Inventory Audit",
  crime: "Criminal Investigation",
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

// Builds the {columns, rows} table for a given report type + date range.
// Every report type funnels through here so generateReport (persists the
// log entry) and downloadReport (regenerates the file on demand) always
// produce identical data for the same params.
async function gatherReportData(type, stationId, dateFrom, dateTo) {
  if (type === "duty") {
    const filter = { stationId, date: { $gte: dateFrom, $lte: dateTo } };
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

  if (type === "leave") {
    const filter = { stationId, startDate: { $lte: dateTo }, endDate: { $gte: dateFrom } };
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

  if (type === "inventory") {
    const filter = { stationId, dateTime: { $gte: dateFrom, $lte: dateTo } };
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

  if (type === "crime") {
    const filter = { stationId, dateOfIncident: { $gte: dateFrom, $lte: dateTo } };
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

  throw new Error(`Unknown report type: ${type}`);
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

// POST /api/reports/generate — oic only
// Body: { type, format, dateFrom, dateTo, title? }
// Runs the query for the requested range up front (so a broken filter
// fails loudly here, not silently at download time) and logs the export
// in ReportExport. The file itself isn't stored — downloadReport
// re-runs the same query from the saved params.
async function generateReport(req, res) {
  const { type, format, title } = req.body;
  const range = parseDateRange(req.body);

  if (!ReportExport.REPORT_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unknown or unsupported report type" });
  }
  if (!ReportExport.REPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: "Format must be pdf or csv" });
  }
  if (!range) {
    return res.status(400).json({ error: "A valid dateFrom and dateTo are required" });
  }

  try {
    const stationId = req.user.stationId;
    // Validates the query works before we log it as "Complete".
    await gatherReportData(type, stationId, range.dateFrom, range.dateTo);

    const requester = await User.findById(req.user.uid);

    const record = await ReportExport.create({
      title: title?.trim() || REPORT_TYPE_LABELS[type],
      type,
      format,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
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

// GET /api/reports/:id/download — oic only
// Regenerates the file from the stored params and streams it back.
async function downloadReport(req, res) {
  try {
    const record = await ReportExport.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Report not found" });

    const { columns, rows } = await gatherReportData(record.type, record.stationId, record.dateFrom, record.dateTo);
    const safeName = record.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    if (record.format === "csv") {
      const csv = buildCsv(columns, rows);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
      return res.send(csv);
    }

    const pdfBuffer = await buildPdf({
      title: record.title,
      subtitle: REPORT_TYPE_LABELS[record.type],
      meta: [
        ["Date range", `${record.dateFrom.toISOString().slice(0, 10)} to ${record.dateTo.toISOString().slice(0, 10)}`],
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

// PATCH /api/reports/:id/archive — oic only
async function archiveReport(req, res) {
  try {
    const record = await ReportExport.findOneAndUpdate(
      { _id: req.params.id, stationId: req.user.stationId },
      { status: "Archived" },
      { new: true }
    );
    if (!record) return res.status(404).json({ error: "Report not found" });
    return res.json(record.toJSON());
  } catch (err) {
    console.error("archiveReport error:", err);
    return res.status(500).json({ error: "Could not archive report" });
  }
}

// DELETE /api/reports/:id — oic only
async function deleteReport(req, res) {
  try {
    const record = await ReportExport.findOneAndDelete({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Report not found" });
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
  generateReport,
  downloadReport,
  archiveReport,
  deleteReport,
};