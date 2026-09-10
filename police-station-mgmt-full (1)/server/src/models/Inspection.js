const mongoose = require("mongoose");

const INSPECTION_TYPES = ["Scheduled", "Random", "Post-Maintenance", "Other"];

// One record per periodic physical inspection — independent of the
// Issue/Return/Maintenance flows, this is what catches a weapon that's
// simply due a routine check even though it's never been reported
// damaged. See inspectionsController.js for the pass/fail side effects.
const inspectionSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true }, // "INS-0001" style, human-facing

    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    inspectionDate: { type: Date, default: Date.now },
    inspectionType: { type: String, enum: INSPECTION_TYPES, default: "Scheduled" },

    condition: { type: String, default: "good" }, // overall condition rating at time of inspection
    findings: { type: String, default: "" }, // physical/safety/cleanliness/function observations
    damageIssues: { type: String, default: "" }, // specific damage or issues found, if any
    accessoriesChecked: { type: String, default: "" }, // notes on parts/accessories inspected
    remarks: { type: String, default: "" },

    result: { type: String, enum: ["passed", "failed"], required: true },

    // Only set when result === "passed" — a failed inspection sends the
    // weapon to maintenance instead of back onto a schedule (see
    // inspectionsController.js). Mirrors Inventory.nextInspectionDate,
    // which is what the Due/Overdue alerts actually key off; this copy
    // is the historical record of what was scheduled at the time.
    nextInspectionDate: { type: Date, default: null },

    // Set when a failed inspection auto-creates a Maintenance record —
    // traceability back to it, same idea as
    // Maintenance.sourceTransactionId for a damaged return.
    resultingMaintenanceId: { type: mongoose.Schema.Types.ObjectId, ref: "Maintenance", default: null },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
inspectionSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("Inspection", inspectionSchema);
module.exports.INSPECTION_TYPES = INSPECTION_TYPES;
