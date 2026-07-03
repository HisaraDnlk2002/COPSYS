import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyOicStats } from "./dummyData";

export async function getOicStats() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyOicStats);
  }
  // No dedicated OIC summary endpoint yet on the server — combine
  // /api/users (count), /api/leave-requests (pending count), and
  // /api/complaints (active count) once wiring up the real backend.
  return api.get("/dashboard/oic-summary");
}
