const mongoose = require("mongoose");

const complainantSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    nic: { type: String, default: "" },
    passportId: { type: String, default: "" },
    contactNumber: { type: String, default: "" },
    occupation: { type: String, default: "" },
    address: { type: String, default: "" },
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true }, // e.g. "CMP-001"

    complainant: { type: complainantSchema, required: true },

    category: { type: String, required: true },
    dateOfIncident: { type: Date, required: true },
    description: { type: String, default: "" },

    // Shown to OIC as Unassigned / In-Progress / Resolved on the Incident Monitor
    status: {
      type: String,
      enum: ["open", "investigating", "closed"],
      default: "open",
    },

    // Independent of status — drives the red "Critical" badge regardless
    // of whether the complaint is still open or already being investigated.
    severity: { type: String, enum: ["normal", "critical"], default: "normal" },

    assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Complaint", complaintSchema);
