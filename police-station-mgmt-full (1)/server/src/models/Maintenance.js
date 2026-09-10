const mongoose = require("mongoose");

const MAINTENANCE_TYPES = ["Repair", "Inspection", "Cleaning", "Part Replacement", "Overhaul", "Other"];

// One record per weapon sent for repair/inspection. Created automatically
// when a damaged return is confirmed (see confirmTransaction in
// inventoryController.js) — see the module-level note there for how this
// ties back to Inventory.status.
const maintenanceSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true }, // "MR-0001" style, human-facing

    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },

    issueDescription: { type: String, required: true },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reportedDate: { type: Date, default: Date.now },

    maintenanceType: { type: String, enum: MAINTENANCE_TYPES, default: "Repair" },

    // Free text rather than a ref User: the person doing the actual
    // repair is often an external armorer/gunsmith, not a station
    // account.
    assignedTechnician: { type: String, default: "" },

    startDate: { type: Date, default: null }, // set when status -> in_progress
    completionDate: { type: Date, default: null }, // set when status -> completed

    partsCost: { type: String, default: "" }, // free text — no currency/accounting system elsewhere to key off
    remarks: { type: String, default: "" },

    finalCondition: { type: String, default: null }, // only set on completion
    finalInspectionPassed: { type: Boolean, default: null }, // only set on completion — see Inventory sync note below

    status: { type: String, enum: ["pending", "in_progress", "completed"], default: "pending" },

    // Traceability back to whatever triggered this record, when
    // auto-created — at most one of these is set; both null when
    // reported another way (there is no other way yet, but the model
    // doesn't assume one won't exist).
    sourceTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction", default: null }, // damaged return
    sourceInspectionId: { type: mongoose.Schema.Types.ObjectId, ref: "Inspection", default: null }, // failed periodic inspection

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
maintenanceSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("Maintenance", maintenanceSchema);
module.exports.MAINTENANCE_TYPES = MAINTENANCE_TYPES;
