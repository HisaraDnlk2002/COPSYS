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

// Downloads the formal "Complaint Acknowledgement / Receipt" PDF for a
// complaint — regenerated fresh from the current record each time
// (nothing's stored server-side), so it's always safe to re-download
// later if the complainant's copy is lost.
export async function downloadComplaintReceipt(id, refId) {
  if (USE_DUMMY_DATA) {
    const blob = new Blob(["Dummy data mode has no receipt to generate.\n"], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `complaint-receipt-${refId || id}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return;
  }
  const { blob, filename } = await api.getFile(`/complaints/${id}/receipt`);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
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

// Adds one entry to a complaint's case-notes timeline — text and/or up
// to 5 file attachments (photos of the scene, a scanned statement, …).
// Returns the whole updated complaint (with its fresh `notes` array),
// same shape as every other complaint mutation here.
export async function addComplaintNote(id, { text, files = [] }) {
  if (USE_DUMMY_DATA) {
    const complaint = dummyComplaints.find((c) => c.id === id);
    if (complaint) {
      if (!complaint.notes) complaint.notes = [];
      complaint.notes.push({
        id: `note-${complaint.notes.length + 1}`,
        authorName: "You",
        text,
        attachments: files.map((f) => ({ id: f.name, originalName: f.name, mimeType: f.type, size: f.size })),
        createdAt: new Date().toISOString(),
      });
    }
    return Promise.resolve(complaint);
  }

  const formData = new FormData();
  formData.append("text", text || "");
  files.forEach((file) => formData.append("attachments", file));
  return api.postForm(`/complaints/${id}/notes`, formData);
}

// Fetches one attachment as a blob (auth-gated, same pattern as
// downloadComplaintReceipt above) and either opens it in a new tab
// (images/PDFs preview fine that way) or triggers a save, depending on
// what the browser can actually display inline.
export async function openComplaintAttachment(complaintId, noteId, attachmentId) {
  if (USE_DUMMY_DATA) {
    window.alert("Dummy data mode has no real attachment file to open.");
    return;
  }
  const { blob } = await api.getFile(`/complaints/${complaintId}/notes/${noteId}/attachments/${attachmentId}`);
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Deliberately not revoked immediately — the new tab is still reading
  // from this blob URL; the browser reclaims it when that tab closes.
}
