const Shift = require("../models/Shift");
const { refreshShiftCache, DEFAULT_SHIFTS } = require("../config/shifts");
const { logAuditForActor } = require("../utils/auditLogger");

// Called once at server boot (index.js) — inserts the station's
// original Day/Night times the very first time this collection is
// empty. Safe on every boot: a no-op once anything exists.
async function seedDefaultShifts(stationId = "default-station") {
  const count = await Shift.countDocuments({ stationId });
  if (count > 0) return;
  await Shift.insertMany(DEFAULT_SHIFTS.map((s) => ({ ...s, stationId })));
}

// GET /api/shifts — any authenticated role.
async function list(req, res) {
  try {
    const shifts = await Shift.find({ stationId: req.user.stationId }).sort({ key: 1 });
    return res.json(shifts.map((s) => s.toJSON()));
  } catch (err) {
    console.error("list shifts error:", err);
    return res.status(500).json({ error: "Could not load shifts" });
  }
}

// PATCH /api/shifts/:id — admin/oic. Only label/startTime/endTime are
// editable — `key` stays fixed to "day"/"night" (see Shift.js's own
// comment for why the app can't yet support an arbitrary third shift).
async function update(req, res) {
  const { label, startTime, endTime } = req.body;

  try {
    const shift = await Shift.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!shift) return res.status(404).json({ error: "Shift not found" });

    if (label !== undefined && label.trim()) shift.label = label.trim();
    if (startTime !== undefined) shift.startTime = startTime;
    if (endTime !== undefined) shift.endTime = endTime;
    await shift.save();

    await refreshShiftCache(req.user.stationId);
    logAuditForActor(req, { action: `Updated ${shift.label} times to ${shift.startTime}–${shift.endTime}`, module: "Settings" });
    return res.json(shift.toJSON());
  } catch (err) {
    console.error("update shift error:", err);
    return res.status(500).json({ error: "Could not update shift" });
  }
}

module.exports = { list, update, seedDefaultShifts };
