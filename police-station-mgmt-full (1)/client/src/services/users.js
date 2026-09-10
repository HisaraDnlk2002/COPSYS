import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyUsers, dummyPersonnelStats } from "./dummyData";

export async function getMyProfile() {
  if (USE_DUMMY_DATA) {
    const storedId = localStorage.getItem("dummyUserId");
    const user = dummyUsers.find((u) => u.id === storedId);
    if (!user) throw new Error("Not logged in");
    return Promise.resolve(user);
  }
  return api.get("/users/me");
}

export async function listUsers() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyUsers);
  }
  return api.get("/users");
}

export async function getPersonnelStats() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyPersonnelStats);
  }
  // No dedicated stats endpoint yet — derive from /api/users once the
  // real backend is connected (count by status, etc).
  return api.get("/users/stats");
}

export async function createUser(payload) {
  if (USE_DUMMY_DATA) {
    const newUser = { id: `u${dummyUsers.length + 1}`, status: "active", ...payload, generatedPassword: "Dummy#1234" };
    dummyUsers.push(newUser);
    return Promise.resolve(newUser);
  }
  // Matches server/src/controllers/usersController.js -> POST /api/users
  // Expects { fullName, rankAndNumber, department, role, phoneNumber, email, address }
  // — no `password`, the server generates and returns one as `generatedPassword`.
  return api.post("/users", payload);
}

// Edits an existing officer's profile details (name, department, role,
// phone, address). Does not change rankAndNumber (login username) or
// password — those have their own dedicated flows.
export async function updateUser(id, payload) {
  if (USE_DUMMY_DATA) {
    const user = dummyUsers.find((u) => u.id === id);
    if (user) Object.assign(user, payload);
    return Promise.resolve(user);
  }
  // Matches server/src/controllers/usersController.js -> PATCH /api/users/:id
  return api.patch(`/users/${id}`, payload);
}

export async function updateUserStatus(id, status) {
  if (USE_DUMMY_DATA) {
    const user = dummyUsers.find((u) => u.id === id);
    if (user) user.status = status;
    return Promise.resolve(user);
  }
  return api.patch(`/users/${id}/status`, { status });
}

// Admin reissues an officer's password on the spot — the server
// generates it and returns it once as `generatedPassword` for Admin to
// relay. For the officer-initiated flow (Login page -> Admin approves ->
// emailed to the officer, Admin never sees it), see
// services/passwordResetRequests.js instead.
export async function resetPassword(id) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id, generatedPassword: "Dummy#1234", message: "Password updated (dummy mode)" });
  }
  return api.patch(`/users/${id}/password`, {});
}
