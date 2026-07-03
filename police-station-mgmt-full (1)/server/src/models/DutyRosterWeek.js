const mongoose = require("mongoose");

const dutyRosterWeekSchema = new mongoose.Schema(
  {
    weekStarting: { type: Date, required: true }, // Monday of the week
    department: { type: String, required: true },
    shiftPattern: { type: String, default: "" }, // "Optimal" / "Reserve" etc.

    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "sent_back"],
      default: "draft",
    },

    // Page 14 footer stats
    scheduledUnits: { type: Number, default: 0 },
    offDuty: { type: Number, default: 0 },
    leaveCoverage: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    sendBackReason: { type: String, default: "" },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DutyRosterWeek", dutyRosterWeekSchema);
