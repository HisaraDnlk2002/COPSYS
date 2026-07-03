const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true }, // "WP-8821" style, human-facing
    itemName: { type: String, required: true },
    category: { type: String, required: true }, // "Firearms" | "Electronics" | ...
    quantity: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["available", "issued", "damaged"], default: "available" },
    condition: { type: String, default: "good" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
