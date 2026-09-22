const Branch = require("../models/Branch");
const { refreshBranchCache, DEFAULT_BRANCHES } = require("../config/branches");
const { logAuditForActor } = require("../utils/auditLogger");

// Called once at server boot (index.js) — inserts the station's
// original hardcoded branch list the very first time this collection
// is empty, so an existing station's data never silently changes on
// upgrade, and a brand new one starts with the same branches it always
// had. Safe to call on every boot: a no-op once anything exists.
async function seedDefaultBranches(stationId = "default-station") {
  const count = await Branch.countDocuments({ stationId });
  if (count > 0) return;
  await Branch.insertMany(DEFAULT_BRANCHES.map((b) => ({ ...b, stationId })));
}

// GET /api/branches — any authenticated role (every branch dropdown in
// the app, not just Duty Roster, needs this list).
async function list(req, res) {
  try {
    const branches = await Branch.find({ stationId: req.user.stationId }).sort({ name: 1 });
    return res.json(branches.map((b) => b.toJSON()));
  } catch (err) {
    console.error("list branches error:", err);
    return res.status(500).json({ error: "Could not load branches" });
  }
}

// POST /api/branches — admin/oic
async function create(req, res) {
  const { name, isGeneralPool } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Branch name is required" });
  }

  try {
    const branch = await Branch.create({
      name: name.trim(),
      isGeneralPool: Boolean(isGeneralPool),
      stationId: req.user.stationId,
    });
    await refreshBranchCache(req.user.stationId);
    logAuditForActor(req, { action: `Created Branch "${branch.name}"`, module: "Settings" });
    return res.status(201).json(branch.toJSON());
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "A branch with this name already exists" });
    }
    console.error("create branch error:", err);
    return res.status(500).json({ error: "Could not create branch" });
  }
}

// PATCH /api/branches/:id — admin/oic. Renaming a branch that's
// already referenced by User.department/DutySchedule.department rows
// deliberately does NOT cascade-rename those — same "never silently
// rewrite history" principle as everywhere else in this app; treat a
// rename as effectively retiring the old name (set it inactive
// instead) if existing officers/rosters shouldn't quietly point at new
// text.
async function update(req, res) {
  const { name, isGeneralPool, status } = req.body;

  try {
    const branch = await Branch.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    if (name !== undefined && name.trim()) branch.name = name.trim();
    if (isGeneralPool !== undefined) branch.isGeneralPool = Boolean(isGeneralPool);
    if (status !== undefined) branch.status = status;
    await branch.save();

    await refreshBranchCache(req.user.stationId);
    logAuditForActor(req, { action: `Updated Branch "${branch.name}"`, module: "Settings" });
    return res.json(branch.toJSON());
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "A branch with this name already exists" });
    }
    console.error("update branch error:", err);
    return res.status(500).json({ error: "Could not update branch" });
  }
}

module.exports = { list, create, update, seedDefaultBranches };
