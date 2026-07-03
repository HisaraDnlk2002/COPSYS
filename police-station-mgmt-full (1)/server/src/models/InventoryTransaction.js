const mongoose = require("mongoose");

const inventoryTransactionSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // issued to / returned by

    type: { type: String, enum: ["issue", "return", "damaged"], required: true },
    dutyType: { type: String, default: "" }, // "Patrol", "Traffic" — shown in log tables
    quantity: { type: Number, required: true, default: 1 },

    dateTime: { type: Date, default: Date.now },
    condition: { type: String, default: null }, // "Good" / "Faulty" — only on return
    remarks: { type: String, default: null },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryTransaction", inventoryTransactionSchema);
