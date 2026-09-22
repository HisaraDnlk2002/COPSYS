import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { BRANCHES as STATIC_BRANCHES } from "../config/branches";

// There's no client/src/config/shifts.js — shift times are only ever
// inlined directly where used (WeeklyGrid.jsx, translation strings for
// "Day Shift (08:00–20:00)" etc.), so this is just the dummy-data
// fallback's own default, not mirroring a real shared config file.
const STATIC_SHIFTS = {
  day: { label: "Day Shift", start: "08:00", end: "20:00" },
  night: { label: "Night Shift", start: "20:00", end: "08:00" },
};

// Spec §23 — Branch/Shift are now real, admin-editable collections
// server-side (see server/src/models/Branch.js, Shift.js), reachable
// via GET/POST/PATCH here. This is the Settings page's own management
// UI for that catalog; the rest of the app (WeeklyGrid, the roster
// wizard's branch dropdowns, ...) still reads the static
// client/src/config/branches.js|shifts.js list for now rather than
// fetching live — the two are seeded from the exact same source, so
// they agree by default, but an edit made here won't retroactively
// relabel those dropdowns until the app is migrated to fetch this API
// everywhere too. Flagged as a known follow-up, not silently assumed
// complete.

export async function getBranchList() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(STATIC_BRANCHES.map((b, i) => ({ id: `branch-${i}`, name: b.value, isGeneralPool: b.isGeneralPool, status: "active" })));
  }
  return api.get("/branches");
}

export async function createBranch(payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id: `branch-${Date.now()}`, status: "active", ...payload });
  }
  return api.post("/branches", payload);
}

export async function updateBranch(id, payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, ...payload });
  }
  return api.patch(`/branches/${id}`, payload);
}

export async function getShiftList() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(
      Object.entries(STATIC_SHIFTS).map(([key, s], i) => ({ id: `shift-${i}`, key, label: s.label, startTime: s.start, endTime: s.end, status: "active" }))
    );
  }
  return api.get("/shifts");
}

export async function updateShift(id, payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, ...payload });
  }
  return api.patch(`/shifts/${id}`, payload);
}
