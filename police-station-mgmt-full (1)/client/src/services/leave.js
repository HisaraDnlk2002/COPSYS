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
    return Promise.resolve(dummyLeaveBalances[uid] || { personal: 0, medical: null, casual: 0 });
  }
  return api.get("/leave-balances/me");
}

// Used by the OIC/admin "View" detail modal on the leave registry, to show
// a specific officer's remaining balance rather than the viewer's own.
export async function getLeaveBalanceForOfficer(officerId) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyLeaveBalances[officerId] || { personal: 0, medical: null, casual: 0 });
  }
  return api.get(`/leave-balances/${officerId}`);
}

// Always multipart/form-data, not plain JSON — a medical application
// attaches its doctor's note (files) in the very same request. Every
// other leave type just sends no files, which the backend treats as
// "nothing attached" rather than requiring a different request shape.
export async function applyForLeave(payload, files = []) {
  if (USE_DUMMY_DATA) {
    const uid = currentUserId();
    const newRequest = {
      id: `lv${dummyLeaveRequests.length + 1}`,
      refId: `LV-${100 + dummyLeaveRequests.length + 1}`,
      officerId: uid,
      status: "pending",
      doctorNote: files.map((f) => ({ id: f.name, originalName: f.name, mimeType: f.type, size: f.size })),
      ...payload,
    };
    dummyLeaveRequests.unshift(newRequest);
    return Promise.resolve(newRequest);
  }

  const formData = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) formData.append(key, value);
  });
  files.forEach((file) => formData.append("doctorNote", file));
  return api.postForm("/leave-requests", formData);
}

// Fetches a leave request's doctor's note as a blob (auth-gated, same
// pattern as Complaints' openComplaintAttachment) and opens it in a new
// tab — the officer who filed it, or oic/duty_officer/admin reviewing it.
export async function openLeaveDoctorNote(leaveRequestId, attachmentId) {
  if (USE_DUMMY_DATA) {
    window.alert("Dummy data mode has no real attachment file to open.");
    return;
  }
  const { blob } = await api.getFile(`/leave-requests/${leaveRequestId}/doctor-note/${attachmentId}`);
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function approveLeaveRequest(id) {
  if (USE_DUMMY_DATA) {
    const req = dummyLeaveRequests.find((l) => l.id === id);
    if (req) req.status = "approved";
    return Promise.resolve(req);
  }
  return api.patch(`/leave-requests/${id}/approve`);
}

export async function rejectLeaveRequest(id, remarks) {
  if (USE_DUMMY_DATA) {
    const req = dummyLeaveRequests.find((l) => l.id === id);
    if (req) {
      req.status = "rejected";
      req.remarks = remarks;
    }
    return Promise.resolve(req);
  }
  return api.patch(`/leave-requests/${id}/reject`, { remarks });
}
