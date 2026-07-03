import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyLeaveRequests, dummyLeaveBalances } from "./dummyData";

function currentUserId() {
  return localStorage.getItem("dummyUserId");
}

export async function getMyLeaveRequests() {
  if (USE_DUMMY_DATA) {
    const uid = currentUserId();
    return Promise.resolve(dummyLeaveRequests.filter((l) => l.officerId === uid));
  }
  return api.get("/leave-requests/mine");
}

export async function getAllLeaveRequests() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyLeaveRequests);
  }
  return api.get("/leave-requests");
}

export async function getMyLeaveBalance() {
  if (USE_DUMMY_DATA) {
    const uid = currentUserId();
    return Promise.resolve(dummyLeaveBalances[uid] || { annual: 0, sick: 0, casual: 0 });
  }
  return api.get("/leave-balances/me");
}

export async function applyForLeave(payload) {
  if (USE_DUMMY_DATA) {
    const uid = currentUserId();
    const newRequest = {
      id: `lv${dummyLeaveRequests.length + 1}`,
      refId: `LV-${100 + dummyLeaveRequests.length + 1}`,
      officerId: uid,
      status: "pending",
      ...payload,
    };
    dummyLeaveRequests.unshift(newRequest);
    return Promise.resolve(newRequest);
  }
  return api.post("/leave-requests", payload);
}

export async function approveLeaveRequest(id) {
  if (USE_DUMMY_DATA) {
    const req = dummyLeaveRequests.find((l) => l.id === id);
    if (req) req.status = "approved";
    return Promise.resolve(req);
  }
  return api.patch(`/leave-requests/${id}/approve`);
}

export async function rejectLeaveRequest(id) {
  if (USE_DUMMY_DATA) {
    const req = dummyLeaveRequests.find((l) => l.id === id);
    if (req) req.status = "rejected";
    return Promise.resolve(req);
  }
  return api.patch(`/leave-requests/${id}/reject`);
}
