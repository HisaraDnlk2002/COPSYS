const mongoose = require("mongoose");

const inventoryItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true }, // e.g. "WP-8821"
    itemName: { type: String, required: true },
    category: { type: String, required: true }, // "Firearms" | "Electronics" | etc.
    quantity: { type: Number, required: true, default: 0 },

    status: {
      type: String,
      enum: ["available", "issued", "damaged"],
      default: "available",
    },

    stationId: { type: String, default: "default-station" },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryItem", inventoryItemSchema);
