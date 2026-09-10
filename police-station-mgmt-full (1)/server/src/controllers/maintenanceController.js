const Maintenance = require("../models/Maintenance");
const Inventory = require("../models/Inventory");
const { generateAlert } = require("../utils/alerts");

async function generateRefId() {
  const count = await Maintenance.countDocuments();
  return `MR-${String(count + 1).padStart(4, "0")}`;
}

// GET /api/maintenance — duty_officer, inventory_officer (view only for
// duty_officer, matching the Inventory module's own read/write split)
async function list(req, res) {
  try {
    const records = await Maintenance.find({ stationId: req.user.stationId })
      .sort({ createdAt: -1 })
      .populate("itemId", "itemId itemName category")
      .populate("reportedBy", "fullName rankAndNumber");

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
  const { assignedTechnician, maintenanceType, partsCost, remarks, status, finalCondition, finalInspectionPassed } = req.body;

  try {
    const record = await Maintenance.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!record) return res.status(404).json({ error: "Maintenance record not found" });

    if (assignedTechnician !== undefined) record.assignedTechnician = assignedTechnician;
    if (maintenanceType) record.maintenanceType = maintenanceType;
    if (partsCost !== undefined) record.partsCost = partsCost;
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
            item.status = "available"; // MAINTENANCE -> AVAILABLE, the key rule
            item.dueAlertGenerated = false; // eligible for a fresh Inspection Due alert on its next cycle
          }
          item.lastUpdatedBy = req.user.uid;
          await item.save();

          await generateAlert({
            alertType: "maintenance_completed",
            title: "Maintenance Completed",
            message: `${item.itemId} maintenance completed — ${record.finalInspectionPassed ? "passed final inspection, back in service." : "failed final inspection, remains out of service."}`,
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
    return res.json(record.toJSON());
  } catch (err) {
    console.error("update maintenance error:", err);
    return res.status(500).json({ error: "Could not update maintenance record" });
  }
}

module.exports = { list, update, generateRefId };
