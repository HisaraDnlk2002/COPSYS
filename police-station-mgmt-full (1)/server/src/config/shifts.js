// Day/Night shift definitions (spec §7). Centralized so the engine,
// controller, and client wizard all agree on start/end times without
// duplicating magic strings. Not yet Admin-editable — a reasonable
// future improvement, out of scope for now.

const SHIFTS = {
  day: { label: "Day Shift", start: "08:00", end: "20:00" },
  night: { label: "Night Shift", start: "20:00", end: "08:00" },
};

module.exports = { SHIFTS };