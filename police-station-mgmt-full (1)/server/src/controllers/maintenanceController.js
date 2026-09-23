const Maintenance = require("../models/Maintenance");
const Inventory = require("../models/Inventory");
const { generateAlert } = require("../utils/alerts");
const { logAuditForActor } = require("../utils/auditLogger");
const { INSPECTION_INTERVAL_DAYS } = require("../models/Inventory");
const { STORAGE_LOCATIONS } = require("../config/weaponCatalog");

async function generateRefId() {
  const count = await Maintenance.countDocuments();
  return `MR-${String(count + 1).padStart(4, "0")}`;
}

// GET /api/maintenance — duty_officer, inventory_officer (view only for
// duty_officer, matching the Inventory module's own read/write split)
// Validates the itemised parts list sent from the Manage Maintenance form
// and works out the total. Returns { parts, totalCost } or { error }.
// Money is rounded to cents so floating-point sums don't drift.
function cleanParts(parts) {
  if (!Array.isArray(parts)) return { error: "Parts must be a list" };
  const cleaned = [];
  for (const [i, part] of parts.entries()) {
    const name = String(part?.name || "").trim();
    const quantity = Number(part?.quantity);
    const unitCost = Number(part?.unitCost);
    const row = `Part ${i + 1}`;
    if (!name) return { error: `${row}: enter the part name` };
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `${row}: quantity must be a whole number of 1 or more` };
    if (!Number.isFinite(unitCost) || unitCost < 0) return { error: `${row}: unit cost must be 0 or more` };
    cleaned.push({ name, quantity, unitCost: Math.round(unitCost * 100) / 100 });
  }
  const totalCost = Math.round(cleaned.reduce((sum, p) => sum + p.quantity * p.unitCost, 0) * 100) / 100;
  return { parts: cleaned, totalCost };
}

async function list(req, res) {
  try {
    const records = await Maintenance.find({ stationId: req.user.stationId })
      .sort({ createdAt: -1 })
      .populate("itemId", "itemId itemName category status")
      .populate("reportedBy", "fullName rankAndNumber")
      .populate("returnedToStockBy", "fullName rankAndNumber");

    return res.json(records.map((r) => r.toJSON()));
  } catch (err) {
    console.error("list maintenance error:", err);
    return res.status(500).json({ error: "Could not load maintenance records" });
  }
}

// PATCH /api/maintenance/:id — inventory_officer only
// Handles the Pending -> In Progress -> Completed lifecycle plus
// updating the assigned technician / type / parts / remarks at any
// stage. This is the ONLY place Inventory.status can move a weapon back
// from "damaged" to "available" — and only when the maintenance record
// is being completed with finalInspectionPassed === true. A completed
// record with a failed inspection intentionally leaves the weapon
// exactly where it was (still "damaged", still unable to be issued —
// see the check in issue()) even though the maintenance record itself
// is done; someone has to open a fresh record to try again.
async function update(req, res) {
  const { assignedTechnician, maintenanceType, parts, remarks, status, finalCondition, finalInspectionPassed } = req.body;

  try {
    const record = await Maintenance.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Maintenance record not found" });

    if (assignedTechnician !== undefined) record.assignedTechnician = assignedTechnician;
    if (maintenanceType) record.maintenanceType = maintenanceType;
    if (parts !== undefined) {
      if (record.status === "completed") {
        return res.status(400).json({ error: "Parts can't be changed after maintenance is completed" });
      }
      const cleaned = cleanParts(parts);
      if (cleaned.error) return res.status(400).json({ error: cleaned.error });
      record.parts = cleaned.parts;
      record.totalCost = cleaned.totalCost;
    }
    if (remarks !== undefined) record.remarks = remarks;

    if (status && status !== record.status) {
      if (status === "in_progress") {
        if (record.status !== "pending") {
          return res.status(400).json({ error: "Only a pending record can move to In Progress" });
        }
        record.startDate = new Date();
      } else if (status === "completed") {
        if (record.status !== "in_progress") {
          return res.status(400).json({ error: "Only an in-progress record can be completed" });
        }
        if (!finalCondition || finalInspectionPassed === undefined || finalInspectionPassed === null) {
          return res.status(400).json({ error: "Final condition and final inspection result are required to complete maintenance" });
        }

        record.completionDate = new Date();
        record.finalCondition = finalCondition;
        record.finalInspectionPassed = Boolean(finalInspectionPassed);

        const item = await Inventory.findById(record.itemId);
        if (item) {
          item.condition = finalCondition;
          if (record.finalInspectionPassed) {
            // Passed, but not back in the armory yet — the Inventory
            // Officer does that explicitly with Return to Stock (below),
            // which is what makes it AVAILABLE again.
            item.status = "ready_for_stock";
          }
          item.lastUpdatedBy = req.user.uid;
          await item.save();

          // Failed final inspection -> the weapon stays in MAINTENANCE:
          // open a follow-up record so it's still on the Maintenance tab
          // rather than sitting "damaged" with nothing tracking it.
          if (!record.finalInspectionPassed) {
            const followUp = await Maintenance.create({
              refId: await generateRefId(),
              itemId: item._id,
              issueDescription: `Failed final inspection after ${record.refId}${record.remarks ? ` — ${record.remarks}` : ""}`,
              reportedBy: req.user.uid,
              reportedDate: new Date(),
              maintenanceType: record.maintenanceType,
              assignedTechnician: record.assignedTechnician,
              stationId: req.user.stationId,
            });
            await generateAlert({
              alertType: "maintenance_pending",
              title: "Maintenance Pending",
              message: `${item.itemId} failed its final inspection — follow-up ${followUp.refId} opened.`,
              itemId: item._id,
              maintenanceId: followUp._id,
              stationId: req.user.stationId,
            });
          }

          await generateAlert({
            alertType: "maintenance_completed",
            title: "Maintenance Completed",
            message: `${item.itemId} maintenance completed — ${record.finalInspectionPassed ? "passed final inspection, ready to be returned to stock." : "failed final inspection, remains out of service."}`,
            itemId: item._id,
            maintenanceId: record._id,
            stationId: req.user.stationId,
          });
        }
      } else {
        return res.status(400).json({ error: "Invalid status transition" });
      }
      record.status = status;
    }

    await record.save();

    const item = await Inventory.findById(record.itemId).select("itemId");
    const what =
      status === "in_progress"
        ? "Started"
        : status === "completed"
          ? `Completed (final inspection ${record.finalInspectionPassed ? "passed" : "failed"})`
          : "Updated";
    logAuditForActor(req, { action: `${what} Maintenance ${record.refId} — ${item?.itemId || "weapon"}`, module: "Inventory" });

    return res.json(record.toJSON());
  } catch (err) {
    console.error("update maintenance error:", err);
    return res.status(500).json({ error: "Could not update maintenance record" });
  }
}

// POST /api/maintenance/:id/return-to-stock — inventory_officer
// The last step of the maintenance workflow: a weapon that passed its
// final inspection is physically put back in the armory. Only this makes
// it AVAILABLE (and issuable) again. Records who did it, when, and where
// it's now stored.
async function returnToStock(req, res) {
  const { storageLocation } = req.body;
  if (!storageLocation || !STORAGE_LOCATIONS.includes(storageLocation)) {
    return res.status(400).json({ error: "Choose where the weapon is being stored" });
  }

  try {
    const record = await Maintenance.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Maintenance record not found" });
    if (record.status !== "completed" || record.finalInspectionPassed !== true) {
      return res.status(400).json({ error: "Only maintenance that passed its final inspection can be returned to stock" });
    }
    if (record.returnedToStockAt) {
      return res.status(400).json({ error: "This weapon has already been returned to stock" });
    }

    const item = await Inventory.findById(record.itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.status !== "ready_for_stock") {
      return res.status(400).json({ error: "This weapon isn't waiting to be returned to stock" });
    }

    // The final inspection counts as an inspection, so the periodic
    // schedule restarts from the completion date.
    const inspectedAt = record.completionDate || new Date();
    item.status = "available";
    item.storageLocation = storageLocation;
    item.assignedTo = null;
    item.lastInspectionDate = inspectedAt;
    item.nextInspectionDate = new Date(inspectedAt.getTime() + INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    item.dueAlertGenerated = false;
    item.lastUpdatedBy = req.user.uid;
    await item.save();

    record.returnedToStockAt = new Date();
    record.returnedToStockBy = req.user.uid;
    await record.save();

    logAuditForActor(req, {
      action: `Returned ${item.itemId} to stock after Maintenance ${record.refId} — stored at ${storageLocation}`,
      module: "Inventory",
    });

    return res.json(record.toJSON());
  } catch (err) {
    console.error("returnToStock maintenance error:", err);
    return res.status(500).json({ error: "Could not return this weapon to stock" });
  }
}

module.exports = { list, update, returnToStock, generateRefId };
