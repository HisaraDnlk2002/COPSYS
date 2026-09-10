import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";

// GET /api/maintenance — duty_officer, inventory_officer. Every weapon
// currently (or previously) under repair/inspection for this station.
export async function getMaintenanceRecords() {
  if (USE_DUMMY_DATA) {
    // No dummy dataset for this yet — the maintenance module is new and
    // every real record is created automatically from a damaged return,
    // which the dummy data layer doesn't simulate.
    return Promise.resolve([]);
  }
  return api.get("/maintenance");
}

// PATCH /api/maintenance/:id — inventory_officer only. Covers assigning
// a technician / editing type / parts / remarks at any stage, and the
// Pending -> In Progress -> Completed status transitions (completing
// requires finalCondition + finalInspectionPassed in the payload).
export async function updateMaintenanceRecord(id, payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, ...payload });
  }
  return api.patch(`/maintenance/${id}`, payload);
}
