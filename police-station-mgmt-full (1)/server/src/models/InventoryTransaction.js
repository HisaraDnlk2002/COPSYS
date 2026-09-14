const mongoose = require("mongoose");

const inventoryTransactionSchema = new mongoose.Schema(
  {
    // NOTE: ref is "Inventory", not "InventoryItem" — items are actually
    // created via the Inventory model (see inventoryController.js). The
    // near-identical InventoryItem model is unused leftover; pointing
    // this ref at it silently broke every .populate("itemId") call (it
    // always resolved to null, since InventoryItem's collection is
    // empty). Fixed here so item details actually populate.
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // issued to / returned by

    // Which inventory_officer actually carried out the issue/return —
    // distinct from officerId (who the weapon went to/came from). Powers
    // the "processed by" column on custody history views.
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    type: { type: String, enum: ["issue", "return", "damaged"], required: true },
    dutyType: { type: String, default: "" }, // "Patrol", "Traffic" — shown in log tables
    quantity: { type: Number, required: true, default: 1 },

    dateTime: { type: Date, default: Date.now },
    condition: { type: String, default: null }, // "Good" / "Faulty" — only on return
    remarks: { type: String, default: null },

    // Only meaningful for type: "issue". The Inventory Officer can set
    // an explicit expected-back date on the Issue form; if they leave it
    // blank, inventoryController.js's issue() defaults it to 24 hours
    // after dateTime — every issue ends up with one either way, so
    // alertsController.js's on-demand scan can always fire a "Return
    // Overdue" alert once this passes, not only when a deadline was
    // manually set.
    expectedReturnDate: { type: Date, default: null },

    // Set once an overdue alert has been generated for this issue, so
    // the scan doesn't create a duplicate on every alerts list fetch —
    // there's one "Return Overdue" alert per overdue issue, not one per
    // page load.
    overdueAlertGenerated: { type: Boolean, default: false },

    // Ammunition reconciliation. ammoIssued is optional on BOTH an
    // "issue" transaction (recorded at issue time, if the Inventory
    // Officer entered it then) and a "return"/"damaged" one — the
    // Return form pre-fills its own ammoIssued/quantity from the
    // officer's matching open issue record when one exists (see
    // Inventory.jsx's returnForm-prefill effect), but it's still a
    // separate, editable value here rather than a read of the issue
    // row, since older issues predate this field and an officer can
    // always correct it at return time. ammoReturned is only ever
    // entered on return/damaged; ammoUsed is derived from the pair and
    // stored so history views don't have to recompute it.
    ammoIssued: { type: Number, default: null },
    ammoReturned: { type: Number, default: null },
    ammoUsed: { type: Number, default: null },

    // Two-party confirmation workflow — meaningful for every type
    // (issue AND return/damaged). Set to "pending" the moment an
    // Inventory Officer submits the transaction; only flips to
    // "secured" via confirmTransaction() in inventoryController.js,
    // which requires the caller to BE officerId (the officer the
    // weapon was issued to / is being returned by) — there is
    // deliberately no path for the Inventory Officer (or anyone else)
    // to set this directly. For issue, confirming only records the
    // officer's acknowledgment (the item's stock/status already updated
    // at issue time). For return/damaged, confirming is what actually
    // applies the stock update (see confirmTransaction) — deferred
    // until then specifically so a not-yet-confirmed return can't
    // silently free up stock nobody has actually verified came back.
    confirmationStatus: { type: String, enum: ["pending", "secured"], default: null },
    confirmedAt: { type: Date, default: null },
    confirmationRemarks: { type: String, default: null },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
inventoryTransactionSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("InventoryTransaction", inventoryTransactionSchema);
