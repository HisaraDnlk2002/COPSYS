const mongoose = require("mongoose");

// One uploaded file's metadata — shared shape for Complaint case-note
// attachments and LeaveRequest doctor's notes (any future file-upload
// feature should reuse this too, rather than redefining it). The
// on-disk filename is always a random token (see the matching upload
// middleware, e.g. complaintAttachmentUpload.js/leaveDoctorNoteUpload.js),
// never the officer's original filename — this just keeps that around
// for display/download purposes.
const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
});

module.exports = attachmentSchema;
