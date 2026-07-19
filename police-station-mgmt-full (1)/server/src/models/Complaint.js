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

    // Which physical/official register this complaint is logged under —
    // see the "Complaint Book" field on the registration form.
    complaintBook: {
      type: String,
      enum: ["IB", "CR", "TR", "LPR", "MPR", "WCD", "DVR", "GCR"],
      required: true,
    },
    title: { type: String, required: true },
    complaintSource: {
      type: String,
      enum: ["Walk-in", "Telephone", "Online", "Referral"],
      default: "Walk-in",
    },
    priority: { type: String, enum: ["Low", "Medium", "High", "Urgent"], default: "Medium" },

    complainant: { type: complainantSchema, required: true },

    category: { type: String, required: true },
    dateOfIncident: { type: Date, required: true },
    incidentTime: { type: String, default: "" },
    incidentLocation: { type: String, default: "" },
    description: { type: String, default: "" },

    // Shown to OIC as Unassigned / In-Progress / Resolved on the Incident Monitor
    status: {
      type: String,
      enum: ["open", "investigating", "paused", "closed"],
      default: "open",
    },

    // Independent of status — drives the red "Critical" badge regardless
    // of whether the complaint is still open or already being investigated.
    // "Grave Crime" is treated as the equivalent of the old "critical" flag.
    severity: {
      type: String,
      enum: ["General", "Serious", "Grave Crime"],
      default: "General",
    },

    assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
complaintSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("Complaint", complaintSchema);
