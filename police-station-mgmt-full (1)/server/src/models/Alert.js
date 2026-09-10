const mongoose = require("mongoose");

// The 12 weapon-related alert types (dropped "Unauthorized weapon issue"
// — nothing in the system can actually trigger it; every issue already
// requires the Inventory Officer, and issuing a damaged/under-maintenance
// item is already hard-blocked at the API, not something to alert on
// after the fact). See generateAlert() in alertsController.js for what
// creates each one.
const ALERT_TYPES = [
  // critical
  "weapon_missing",
  "ammo_discrepancy",
  "inspection_failed",
  "weapon_damage",
  // warning
  "return_overdue",
  "inspection_due",
  "maintenance_pending",
  "return_awaiting_confirmation",
  // info
  "weapon_issued",
  "weapon_returned",
  "maintenance_completed",
  "inspection_completed",
];

const ALERT_PRIORITIES = ["critical", "warning", "info"];
const ALERT_STATUSES = ["new", "acknowledged", "action_taken", "resolved"];

const alertSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true }, // "ALT-0001" style, human-facing

    alertType: { type: String, enum: ALERT_TYPES, required: true },
    priority: { type: String, enum: ALERT_PRIORITIES, required: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },

    // Whichever of these applies to this alert type — never more than
    // one or two set at once, but all optional since alert types vary
    // in what they're "about".
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", default: null },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction", default: null },
    maintenanceId: { type: mongoose.Schema.Types.ObjectId, ref: "Maintenance", default: null },
    inspectionId: { type: mongoose.Schema.Types.ObjectId, ref: "Inspection", default: null },

    // The officer this alert is personally about (whoever has the
    // weapon, or used the ammo) — null for alerts that are purely
    // armory-side (missing/damaged/maintenance/inspection housekeeping),
    // which only ever show on the Inventory Officer's dashboard rather
    // than any individual officer's own notifications.
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    generatedAt: { type: Date, default: Date.now },

    // NEW -> ACKNOWLEDGED -> ACTION_TAKEN -> RESOLVED. Enforced in order
    // by updateStatus() in alertsController.js — same "can't skip or go
    // backwards" pattern as Maintenance's pending -> in_progress ->
    // completed.
    status: { type: String, enum: ALERT_STATUSES, default: "new" },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedAt: { type: Date, default: null },
    actionTakenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actionTakenAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    remarks: { type: String, default: "" },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
alertSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("Alert", alertSchema);
module.exports.ALERT_TYPES = ALERT_TYPES;
module.exports.ALERT_PRIORITIES = ALERT_PRIORITIES;
module.exports.ALERT_STATUSES = ALERT_STATUSES;
