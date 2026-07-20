import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyComplaints, dummyUsers } from "./dummyData";

export async function getComplaints() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyComplaints);
  }
  return api.get("/complaints");
}

// "My assigned complaints" table on the Officer Dashboard
export async function getMyAssignedComplaints() {
  if (USE_DUMMY_DATA) {
    const uid = localStorage.getItem("dummyUserId");
    return Promise.resolve(dummyComplaints.filter((c) => c.assignedOfficerId === uid));
  }
  return api.get("/complaints?assignedToMe=true");
}

export async function registerComplaint(payload) {
  if (USE_DUMMY_DATA) {
    const uid = localStorage.getItem("dummyUserId");
    const newComplaint = {
      id: `c${dummyComplaints.length + 1}`,
      refId: `CMP-${String(dummyComplaints.length + 1).padStart(3, "0")}`,
      status: "open",
      severity: "normal",
      assignedOfficerId: null,
      registeredBy: uid,
      ...payload,
    };
    dummyComplaints.unshift(newComplaint);
    return Promise.resolve(newComplaint);
  }
  return api.post("/complaints", payload);
}

export async function getComplaintLog() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(
      dummyComplaints.map((c) => ({
        ...c,
        registeredByName: dummyUsers.find((u) => u.id === c.registeredBy)?.fullName || "",
        assignedOfficerName: dummyUsers.find((u) => u.id === c.assignedOfficerId)?.fullName || "",
      }))
    );
  }
  return api.get("/complaints/log");
}

export async function updateComplaintStatus(id, status) {
  if (USE_DUMMY_DATA) {
    const complaint = dummyComplaints.find((c) => c.id === id);
    if (complaint) complaint.status = status;
    return Promise.resolve(complaint);
  }
  return api.patch(`/complaints/${id}`, { status });
}

export async function assignComplaint(id, assignedOfficerId) {
  if (USE_DUMMY_DATA) {
    const complaint = dummyComplaints.find((c) => c.id === id);
    if (complaint) {
      complaint.assignedOfficerId = assignedOfficerId;
      complaint.status = "investigating";
    }
    return Promise.resolve(complaint);
  }
  return api.patch(`/complaints/${id}/assign`, { assignedOfficerId });
}
