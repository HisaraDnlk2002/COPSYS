const mongoose = require("mongoose");

// Records an ad-hoc change to a single officer's duty on a single day,
// AFTER the week's roster has already been approved/published. This is
// the "Roster Management — Officer / Current Duty / New Duty / Reason"
// feature, separate from editing the original DutySchedule entry so
// there's an audit trail of what changed and why.
const dailyDutyChangeSchema = new mongoose.Schema(
  {
    weekId: { type: mongoose.Schema.Types.ObjectId, ref: "DutyRosterWeek", required: true },
    scheduleEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "DutySchedule", required: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    previousDuty: { type: String, required: true }, // e.g. "Traffic"
    newDuty: { type: String, required: true }, // e.g. "Court Duty"
    reason: { type: String, required: true },
    notifiedOfficer: { type: Boolean, default: false }, // whether "Notify Officer" was actioned
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Duty Officer
    stationId: { type: String, required: true, default: "default-station" },
  },
  { timestamps: true }
);

dailyDutyChangeSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id;
  delete obj._id;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("DailyDutyChange", dailyDutyChangeSchema);
