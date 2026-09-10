import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";

// GET /api/inspections — duty_officer, inventory_officer. Every periodic
// physical inspection recorded for this station.
export async function getInspections() {
  if (USE_DUMMY_DATA) {
    // No dummy dataset for this yet — same situation as Maintenance,
    // this module is new and real records only exist via the actual
    // inspection form.
    return Promise.resolve([]);
  }
  return api.get("/inspections");
}

// POST /api/inspections — inventory_officer only. Records one physical
// inspection of a weapon; itemId is the Inventory document's real _id.
// See inspectionsController.js for what "passed" vs "failed" does to
// the item (reschedules it, or sends it to Maintenance).
export async function createInspection(payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id: `insp-${Date.now()}`, ...payload });
  }
  return api.post("/inspections", payload);
}
