const mongoose = require("mongoose");

// One row per "forgot password" click from the Login page. Deliberately
// stores no password/token of any kind — approving a request just
// generates a brand new password server-side and emails it (see
// passwordResetRequestsController.js's approve()); this record only
// tracks the request itself for Admin's queue and as an audit trail of
// who approved/rejected it and when.
const passwordResetRequestSchema = new mongoose.Schema(
  {
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Denormalized so the queue still reads correctly even if the
    // officer's name/rank is later edited.
    officerName: { type: String, required: true },
    rankAndNumber: { type: String, required: true },

    status: { type: String, enum: ["pending", "fulfilled", "rejected"], default: "pending" },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedByName: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

passwordResetRequestSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("PasswordResetRequest", passwordResetRequestSchema);
