const mongoose = require("mongoose");

const branchRequirementSchema = new mongoose.Schema(
  {
    branch: { type: String, required: true },
    dayRequired: { type: Number, default: 0 },
    nightRequired: { type: Number, default: 0 },
  },
  { _id: false }
);

// One entry per status transition this week has ever gone through —
// submitted, approved, rejected, published, unpublished. Append-only,
// never edited or removed, so "what happened to this roster and when"
// stays answerable without needing a separate document per version
// (see `version` below for the lighter-weight versioning that pairs
// with this — a resubmission after rejection bumps `version` rather
// than forking into a whole new document, but every step along the way
// is still preserved right here).
const historyEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    version: { type: Number, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: Date.now },
    remarks: { type: String, default: "" },
  },
  { _id: false }
);

const dutyRosterWeekSchema = new mongoose.Schema(
  {
    weekStarting: { type: Date, required: true }, // Sunday of the week

    // One week spans every branch being planned together (spec §8) —
    // replaces the old single `department`/`requiredStaffing` fields.
    requirements: { type: [branchRequirementSchema], default: [] },

    shiftPattern: { type: String, default: "" },

    // "unpublished" behaves like "draft"/"sent_back" for editing
    // purposes (composition unlocks again) — see the draft/sent_back
    // checks in dutyScheduleController.js, which now also accept it.
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "sent_back", "published", "unpublished"],
      default: "draft",
    },

    // Bumped every time a sent-back week is resubmitted (spec §15) —
    // "Version 2" is literally "the plan as it stood on this
    // resubmission", without forking a whole separate document per
    // attempt. Paired with `history` below for the full timeline.
    version: { type: Number, default: 1 },
    history: { type: [historyEntrySchema], default: [] },

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

    // Set only by unpublishWeek — a published week pulled back for
    // revision (spec §17). Distinct from sendBackReason: that's the
    // OIC rejecting a submission; this is the Duty Officer themselves
    // pulling back something already live, for an operational reason,
    // not a review verdict.
    unpublishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    unpublishedAt: { type: Date, default: null },
    unpublishReason: { type: String, default: "" },

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