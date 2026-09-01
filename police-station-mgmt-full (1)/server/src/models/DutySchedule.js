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
    // from the General Duty Branch pool to cover a shortage.
    assignmentType: {
      type: String,
      enum: ["PERMANENT", "GENERAL_POOL"],
      default: "PERMANENT",
    },

    // Free-form short code for now (P/L/T seen on page 14's grid)
    status: { type: String, default: "" },

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