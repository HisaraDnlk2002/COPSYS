import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";

// POST /api/password-reset-requests — public, no auth (the officer can't
// log in, that's the whole point). Always resolves with a generic
// message regardless of whether that rank & number exists, matching the
// server's anti-enumeration behavior — never branch UI on "found" vs
// "not found" here.
export async function submitPasswordResetRequest(rankAndNumber) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ message: "If that account exists, your request has been sent to the administrator." });
  }
  return api.post("/password-reset-requests", { rankAndNumber }, { skipAuth: true });
}

// GET /api/password-reset-requests — admin only
export async function listPasswordResetRequests() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve([]);
  }
  return api.get("/password-reset-requests");
}

// PATCH /api/password-reset-requests/:id/approve — admin only. Generates
// a new password and emails it straight to the officer; nothing comes
// back here for Admin to see.
export async function approvePasswordResetRequest(id) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, status: "fulfilled" });
  }
  return api.patch(`/password-reset-requests/${id}/approve`);
}

// PATCH /api/password-reset-requests/:id/reject — admin only
export async function rejectPasswordResetRequest(id) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, status: "rejected" });
  }
  return api.patch(`/password-reset-requests/${id}/reject`);
}
