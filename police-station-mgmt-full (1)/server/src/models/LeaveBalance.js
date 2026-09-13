const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema(
  {
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Casual and Personal are both rank-based (see config/ranks.js's
    // casualPersonalAllowance — 28 days/year for Sergeant and below, 21
    // above that), computed explicitly at account creation in
    // usersController.js. The schema default here only covers the rare
    // case a balance doc gets created without going through that path.
    personal: { type: Number, default: 21 },
    casual: { type: Number, default: 21 },
    // Medical leave has no cap at all — always null, meaning unlimited.
    // Never checked or decremented in leaveController.js, unlike the two
    // above.
    medical: { type: Number, default: null },
    year: { type: Number, default: () => new Date().getFullYear() },
  },
  { timestamps: true }
);

// One balance doc per officer per year.
leaveBalanceSchema.index({ officerId: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("LeaveBalance", leaveBalanceSchema);
