const mongoose = require("mongoose");

// Spec §5/§23 — admin-editable Day/Night shift times, replacing the
// hardcoded config/shifts.js constants (still the seed source and the
// in-memory cache dutyAllocationEngine.js reads through — see
// refreshShiftCache in config/shifts.js).
//
// `key` is deliberately fixed to exactly "day"/"night", not an
// admin-addable field — the roster grid, branch requirements
// (dayRequired/nightRequired as two dedicated numbers, not an array),
// and DutySchedule.shiftType's own enum all structurally assume
// exactly two shift slots throughout this app. Making the *set* of
// shifts open-ended would mean redesigning those too, well beyond "the
// times shouldn't be hardcoded" (the actual spec §5 wording); this
// gives a station real control over what Day/Night actually mean
// (e.g. moving the handover from 20:00 to 18:00) without that larger,
// separate redesign.
const shiftSchema = new mongoose.Schema(
  {
    key: { type: String, enum: ["day", "night"], required: true },
    label: { type: String, required: true },
    startTime: { type: String, required: true }, // "HH:MM"
    endTime: { type: String, required: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

shiftSchema.index({ stationId: 1, key: 1 }, { unique: true });

shiftSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("Shift", shiftSchema);
