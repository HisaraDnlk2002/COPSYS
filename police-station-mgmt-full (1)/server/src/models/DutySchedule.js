const mongoose = require("mongoose");

const dutyScheduleSchema = new mongoose.Schema(
  {
    weekId: { type: mongoose.Schema.Types.ObjectId, ref: "DutyRosterWeek", required: true },
    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    date: { type: Date, required: true },
    shiftStart: { type: String, required: true }, // "08:00"
    shiftEnd: { type: String, required: true },
    department: { type: String, default: "" },

    // Free-form short code for now (P/L/T seen on page 14's grid)
    status: { type: String, default: "" },

    stationId: { type: String, default: "default-station" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DutySchedule", dutyScheduleSchema);
