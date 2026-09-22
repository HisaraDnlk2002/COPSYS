// Spec §23 — this used to be the single source of truth for the
// station's branches (a hardcoded array). It's now a thin in-memory
// cache in front of the real, admin-editable Branch collection (see
// models/Branch.js, controllers/branchController.js) — refreshBranchCache
// reloads it from the DB, called once at server boot (index.js) and
// again after any create/update through the Branches API, so every
// existing call site below keeps working unchanged in between.
//
// isGeneralPool marks the branch that acts as the floating officer pool
// (see ARCHITECTURE.md / Duty Roster spec §4): officers whose
// department is this branch are not tied to a specific branch and are
// the first candidates considered when another branch is short-staffed.

// Pre-seeded with the station's original list so the app behaves
// correctly in the brief window before the first DB query resolves at
// boot, and so a station that's never touched Settings still works.
// Also what seedDefaultBranches (branchController.js) inserts into the
// DB the very first time it finds the collection empty.
const DEFAULT_BRANCHES = [
  { name: "Administration Branch (පාලන අංශය)", isGeneralPool: false },
  { name: "Complaint Branch / Minor Complaints (පැමිණිලි අංශය)", isGeneralPool: false },
  { name: "Traffic Branch (ගමනාගමන අංශය)", isGeneralPool: false },
  { name: "Children & Women Bureau (ළමා හා කාන්තා කාර්යාංශය)", isGeneralPool: false },
  { name: "General Duty Branch (සාමාන්‍ය රාජකාරි අංශය)", isGeneralPool: true },
];

let cachedBranches = DEFAULT_BRANCHES.map((b) => ({ value: b.name, label: b.name, isGeneralPool: b.isGeneralPool }));

async function refreshBranchCache(stationId = "default-station") {
  const Branch = require("../models/Branch"); // lazy require — avoids a require cycle at module load time
  const docs = await Branch.find({ stationId, status: "active" }).sort({ name: 1 });
  if (docs.length > 0) {
    cachedBranches = docs.map((b) => ({ value: b.name, label: b.name, isGeneralPool: b.isGeneralPool }));
  }
}

function isGeneralPoolBranch(department) {
  return cachedBranches.some((b) => b.isGeneralPool && b.value === department);
}

module.exports = {
  // Getters, not a plain property — so every read (including one
  // already captured via destructuring elsewhere) sees the current
  // cache rather than a stale snapshot from whenever this module first
  // loaded.
  get BRANCHES() {
    return cachedBranches;
  },
  get GENERAL_POOL_BRANCH() {
    return cachedBranches.find((b) => b.isGeneralPool)?.value || null;
  },
  isGeneralPoolBranch,
  refreshBranchCache,
  DEFAULT_BRANCHES,
};
