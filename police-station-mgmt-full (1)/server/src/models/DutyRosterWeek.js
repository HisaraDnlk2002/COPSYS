const mongoose = require("mongoose");

const branchRequirementSchema = new mongoose.Schema(
  {
    branch: { type: String, required: true },
    dayRequired: { type: Number, default: 0 },
    nightRequired: { type: Number, default: 0 },
  },
  { _id: false }
);

const dutyRosterWeekSchema = new mongoose.Schema(
  {
    weekStarting: { type: Date, required: true }, // Monday of the week

    // One week spans every branch being planned together (spec §8) —
    // replaces the old single `department`/`requiredStaffing` fields.
    requirements: { type: [branchRequirementSchema], default: [] },

    shiftPattern: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "sent_back", "published"],
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

    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },
    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

dutyRosterWeekSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("DutyRosterWeek", dutyRosterWeekSchema);