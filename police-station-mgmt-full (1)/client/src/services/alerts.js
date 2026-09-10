import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";

// GET /api/alerts — duty_officer, inventory_officer. The station-wide
// feed for the Inventory Officer's dashboard. filters: { status?, priority? }
export async function getAlerts(filters = {}) {
  if (USE_DUMMY_DATA) {
    // New module — no dummy dataset simulates the event stream that
    // generates these, same situation as Maintenance/Inspections.
    return Promise.resolve([]);
  }
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.priority) query.set("priority", filters.priority);
  const qs = query.toString();
  return api.get(`/alerts${qs ? `?${qs}` : ""}`);
}

// GET /api/alerts/mine — any authenticated role. Only alerts personally
// addressed to the caller — powers the notifications section on the My
// Weapons page.
export async function getMyAlerts() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve([]);
  }
  return api.get("/alerts/mine");
}

// PATCH /api/alerts/:id — advances exactly one step through
// NEW -> ACKNOWLEDGED -> ACTION_TAKEN -> RESOLVED. Callable by the
// Inventory Officer (any alert) or the alert's own recipient (their own
// only) — enforced server-side.
export async function updateAlertStatus(id, status, remarks) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, status, remarks });
  }
  return api.patch(`/alerts/${id}`, { status, remarks });
}
