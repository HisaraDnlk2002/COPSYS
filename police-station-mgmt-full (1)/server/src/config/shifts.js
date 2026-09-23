// Day/Night shift definitions (spec §5/§7). Was a hardcoded object;
// now an in-memory cache in front of the real, admin-editable Shift
// collection (see models/Shift.js, controllers/shiftController.js) —
// refreshShiftCache reloads it from the DB, called once at server boot
// (index.js) and again after any update through the Shifts API.
//
// The SHIFTS object reference itself never changes (only the label/
// start/end fields on day/night are mutated in place), so
// dutyAllocationEngine.js's `const { SHIFTS } = require(...)` keeps
// seeing live values without needing to change how it reads this.
const SHIFTS = {
  day: { label: "Day Shift", start: "08:00", end: "20:00" },
  night: { label: "Night Shift", start: "20:00", end: "08:00" },
};

// What seedDefaultShifts (shiftController.js) inserts the very first
// time it finds the Shift collection empty.
const DEFAULT_SHIFTS = [
  { key: "day", label: SHIFTS.day.label, startTime: SHIFTS.day.start, endTime: SHIFTS.day.end },
  { key: "night", label: SHIFTS.night.label, startTime: SHIFTS.night.start, endTime: SHIFTS.night.end },
];

async function refreshShiftCache(stationId = "default-station") {
  const Shift = require("../models/Shift"); // lazy require — avoids a require cycle at module load time
  const docs = await Shift.find({ stationId, key: { $in: ["day", "night"] }, status: "active" });
  for (const doc of docs) {
    if (SHIFTS[doc.key]) {
      SHIFTS[doc.key].label = doc.label;
      SHIFTS[doc.key].start = doc.startTime;
      SHIFTS[doc.key].end = doc.endTime;
    }
  }
}

module.exports = { SHIFTS, refreshShiftCache, DEFAULT_SHIFTS };
