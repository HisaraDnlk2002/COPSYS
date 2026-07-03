const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema(
  {
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    annual: { type: Number, default: 21 },
    sick: { type: Number, default: 15 },
    casual: { type: Number, default: 15 },
    year: { type: Number, default: () => new Date().getFullYear() },
  },
  { timestamps: true }
);

// One balance doc per officer per year.
leaveBalanceSchema.index({ officerId: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("LeaveBalance", leaveBalanceSchema);
