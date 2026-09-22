const mongoose = require("mongoose");

const dutyScheduleSchema = new mongoose.Schema(
  {
    weekId: { type: mongoose.Schema.Types.ObjectId, ref: "DutyRosterWeek", required: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    date: { type: Date, required: true },
    shiftStart: { type: String, required: true }, // "08:00"
    shiftEnd: { type: String, required: true },
           department: { type: String, default: "" },

    shiftType: { type: String, enum: ["day", "night"], default: "day" },

    // Why this officer ended up on this branch (spec §22/§12):
    // PERMANENT = this is their home branch; GENERAL_POOL = borrowed
    // from the General Duty Branch pool to cover a shortage; SUBSTITUTE
    // = covering another officer's approved-leave or ad-hoc absence
    // (see substituteFor below) — kept distinct from GENERAL_POOL
    // because a substitute can come from ANY branch, including the
    // absent officer's own, not just the floating pool.
    assignmentType: {
      type: String,
      enum: ["PERMANENT", "GENERAL_POOL", "SUBSTITUTE"],
      default: "PERMANENT",
    },

    // Set only on a SUBSTITUTE row — the officer originally rostered
    // for this exact slot who's being covered for. The original row
    // itself is never deleted when a substitute is created, just
    // re-flagged (see status/absenceReason below) — this lets the
    // system answer "who was originally assigned vs who actually
    // covered it" without losing either side of that history.
    substituteFor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Free-form short code for now (P/L/T seen on page 14's grid)
    status: { type: String, default: "" },

    // Set only when status is "absent" — distinguishes an absence
    // that's actually approved leave (auto-applied, see
    // autoSubstituteForApprovedLeave in leaveController.js) from a
    // genuine unplanned no-show (sick call-in, emergency — see
    // createDailyChange/update() in dutyScheduleController.js). Kept as
    // its own field rather than a new top-level status value so the
    // many existing places that already branch on status === "absent"
    // (attendance counts, dashboard, reports, eligibility checks) don't
    // all need touching — only the handful of places that actually
    // DISPLAY the reason to a person need to read this too.
    absenceReason: { type: String, enum: ["leave", "unplanned", null], default: null },

    // What this shift's actual task is, distinct from which branch it's
    // under (spec §8) — e.g. "Traffic Patrol" vs the branch "Traffic
    // Branch". Free text for now since the station's duty vocabulary
    // isn't fixed; left blank just shows the branch, same as before
    // this field existed.
    dutyType: { type: String, default: "" },

    // Captured when a Duty Officer manually removes an officer from a
    // slot (WeeklyGrid) rather than the row just vanishing without a
    // trace. Kept on the row itself (still findable via its "removed"
    // status) instead of a separate collection, since a removal is a
    // property of this one row, not an event spanning several.
    removalReason: { type: String, default: "" },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    removedAt: { type: Date, default: null },

    stationId: { type: String, default: "default-station" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

dutyScheduleSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("DutySchedule", dutyScheduleSchema);