const Inspection = require("../models/Inspection");
const Inventory = require("../models/Inventory");
const Maintenance = require("../models/Maintenance");
const { INSPECTION_INTERVAL_DAYS } = require("../models/Inventory");
const { generateAlert } = require("../utils/alerts");

async function generateRefId() {
  const count = await Inspection.countDocuments();
  return `INS-${String(count + 1).padStart(4, "0")}`;
}

// GET /api/inspections — duty_officer, inventory_officer
async function list(req, res) {
  try {
    const records = await Inspection.find({ stationId: req.user.stationId })
      .sort({ inspectionDate: -1 })
      .populate("itemId", "itemId itemName category")
      .populate("inspectedBy", "fullName rankAndNumber");

    return res.json(records.map((r) => r.toJSON()));
  } catch (err) {
    console.error("list inspections error:", err);
    return res.status(500).json({ error: "Could not load inspection records" });
  }
}

// POST /api/inspections — inventory_officer only
// Records one physical inspection and applies the outcome:
//   - passed: reschedules the item's next inspection
//     (INSPECTION_INTERVAL_DAYS out) and updates its condition. Does
//     NOT touch status — a passed inspection doesn't change whether the
//     item is available/issued, it just clears it for another cycle.
//   - failed: the weapon must NOT remain available (the key rule) — sets
//     Inventory.status = "damaged" (same state a damaged return leaves
//     it in, so it's blocked from being issued — see the check in
//     issue()) and auto-creates a Maintenance record, same as a damaged
//     return does. nextInspectionDate is cleared; it gets a fresh one
//     only once maintenance's own final inspection passes.
async function create(req, res) {
  const {
    itemId,
    inspectionType,
    condition,
    findings,
    damageIssues,
    accessoriesChecked,
    remarks,
    result,
  } = req.body;

  if (!itemId || !result) {
    return res.status(400).json({ error: "Item and result are required" });
  }
  if (!["passed", "failed"].includes(result)) {
    return res.status(400).json({ error: "Result must be passed or failed" });
  }

  try {
    const item = await Inventory.findById(itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const now = new Date();
    let nextInspectionDate = null;
    let resultingMaintenanceId = null;

    if (result === "passed") {
      nextInspectionDate = new Date(now.getTime() + INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
      item.lastInspectionDate = now;
      item.nextInspectionDate = nextInspectionDate;
      item.dueAlertGenerated = false; // fresh cycle — eligible for its own Inspection Due alert later
      if (condition) item.condition = condition;
      item.lastUpdatedBy = req.user.uid;
      await item.save();
    } else {
      item.status = "damaged"; // the key rule: a failed inspection cannot leave the weapon available
      item.condition = condition || "damaged";
      item.lastInspectionDate = now;
      item.nextInspectionDate = null;
      item.lastUpdatedBy = req.user.uid;
      await item.save();

      const maintenanceCount = await Maintenance.countDocuments();
      const maintenance = await Maintenance.create({
        refId: `MR-${String(maintenanceCount + 1).padStart(4, "0")}`,
        itemId: item._id,
        issueDescription: damageIssues || findings || "Failed periodic inspection",
        reportedBy: req.user.uid,
        reportedDate: now,
        stationId: req.user.stationId,
      });
      resultingMaintenanceId = maintenance._id;

      await generateAlert({
        alertType: "inspection_failed",
        title: "Failed Weapon Inspection",
        message: `${item.itemId} failed inspection — a maintenance record has been opened.`,
        itemId: item._id,
        maintenanceId: maintenance._id,
        stationId: req.user.stationId,
      });
      await generateAlert({
        alertType: "maintenance_pending",
        title: "Maintenance Pending",
        message: `${item.itemId} is awaiting maintenance.`,
        itemId: item._id,
        maintenanceId: maintenance._id,
        stationId: req.user.stationId,
      });
    }

    const record = await Inspection.create({
      refId: await generateRefId(),
      itemId: item._id,
      inspectedBy: req.user.uid,
      inspectionDate: now,
      inspectionType,
      condition,
      findings,
      damageIssues,
      accessoriesChecked,
      remarks,
      result,
      nextInspectionDate,
      resultingMaintenanceId,
      stationId: req.user.stationId,
    });

    if (resultingMaintenanceId) {
      await Maintenance.updateOne({ _id: resultingMaintenanceId }, { sourceInspectionId: record._id });
    }

    // Fires regardless of result — a routine info record that an
    // inspection happened at all — separate from the Critical
    // inspection_failed alert generated above for a failed result.
    await generateAlert({
      alertType: "inspection_completed",
      title: "Inspection Completed",
      message: `${item.itemId} inspected — result: ${result}.`,
      itemId: item._id,
      inspectionId: record._id,
      stationId: req.user.stationId,
    });

    return res.status(201).json(record.toJSON());
  } catch (err) {
    console.error("create inspection error:", err);
    return res.status(500).json({ error: "Could not record this inspection" });
  }
}

module.exports = { list, create };
