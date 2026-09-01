const mongoose = require("mongoose");

// Records an ad-hoc absence + replacement on a single day, AFTER the
// week's roster has already been published. Two things are tracked
// together so there's one audit trail: (1) the original officer's
// entry gets marked absent, (2) if a replacement was assigned, who it
// was and why — not just what the "duty text" changed to, since the
// duty/branch itself usually doesn't change, only who's covering it.
const dailyDutyChangeSchema = new mongoose.Schema(
  {
    weekId: { type: mongoose.Schema.Types.ObjectId, ref: "DutyRosterWeek", required: true },
    scheduleEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "DutySchedule", required: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // the absent officer
    date: { type: Date, required: true },
    department: { type: String, required: true }, // branch/duty this shift covers (unchanged by a replacement)
    reason: { type: String, required: true },
    replacementOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    replacementScheduleEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "DutySchedule", default: null },
    notifiedOfficer: { type: Boolean, default: false }, // whether "Notify Officer" was actioned
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Duty Officer
    stationId: { type: String, required: true, default: "default-station" },
  },
  { timestamps: true }
);

dailyDutyChangeSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("DailyDutyChange", dailyDutyChangeSchema);