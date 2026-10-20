const mongoose = require("mongoose");

// How often a weapon is due for a periodic inspection, independent of
// whether it's ever been reported damaged. Set on the item both at
// creation and whenever a "passed" inspection records a fresh
// nextInspectionDate — see inspectionsController.js and
// inventoryController.js's create().
const INSPECTION_INTERVAL_DAYS = 90;

const inventorySchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true }, // "WP-8821" style, human-facing
    // Weapons are tracked one record per physical weapon. A registration of
    // quantity 6 creates six records sharing one main ID (groupId, e.g.
    // "10016") with sub IDs as their itemId ("10016-01" ... "10016-06"), so
    // issue/return always names the exact weapon. Ammunition and other
    // bulk stock keep one record with a quantity and have no groupId.
    groupId: { type: String, default: null, index: true },
    unitNumber: { type: Number, default: null },
    itemName: { type: String, required: true },
    caliber: { type: String, default: "", trim: true },
    storageLocation: { type: String, default: "", trim: true }, // e.g. "Armory Rack A-3"
    category: { type: String, required: true }, // "Firearms" | "Electronics" | ...
    quantity: { type: Number, required: true, min: 0 },
    // "missing" — set only via POST /inventory/:id/report-missing (see
    // inventoryController.js). Blocked from issue() same as "damaged".
    // "ready_for_stock" — repaired and passed its final inspection, but
    // not yet physically put back in the armory. Set by a completed
    // maintenance record; cleared by POST /maintenance/:id/return-to-stock.
    status: { type: String, enum: ["available", "issued", "damaged", "missing", "ready_for_stock"], default: "available" },
    condition: { type: String, default: "good" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // For items with quantity > 1, each unit is allocated a unique sub ID (e.g. 10004-01)
    // and tracked with its individual custody and maintenance state.
    subItems: [
      {
        subId: { type: String, required: true },
        status: {
          type: String,
          enum: ["available", "issued", "damaged", "missing", "ready_for_stock"],
          default: "available",
        },
        condition: { type: String, default: "good" },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        lastIssuedDate: { type: Date, default: null },
      },
    ],

    lastInspectionDate: { type: Date, default: null },
    nextInspectionDate: { type: Date, default: null }, // drives the Due/Overdue alerts on the Inspections tab

    // Set once an "Inspection Due" alert has been generated for the
    // current nextInspectionDate, so the on-demand scan in
    // alertsController.js doesn't create a duplicate on every fetch.
    // Reset to false every time nextInspectionDate is (re)scheduled.
    dueAlertGenerated: { type: Boolean, default: false },

    // Ammunition only: at or below this many rounds raises a "Low
    // Ammunition Stock" alert (see utils/ammoStock.js). null = no alert.
    lowStockThreshold: { type: Number, default: null, min: 0 },
    // Same one-alert-per-dip idea as dueAlertGenerated — cleared once
    // stock climbs back above the threshold.
    lowStockAlertGenerated: { type: Boolean, default: false },

    stationId: { type: String, required: true, default: "default-station" },
  },
  { timestamps: true }
);

inventorySchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id;
  delete obj._id;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("Inventory", inventorySchema);
module.exports.INSPECTION_INTERVAL_DAYS = INSPECTION_INTERVAL_DAYS;