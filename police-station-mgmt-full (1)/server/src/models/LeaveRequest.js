const mongoose = require("mongoose");

const leaveRequestSchema = new mongoose.Schema(
  {
    refId: { type: String, required: true, unique: true }, // e.g. "LV-112"

    officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    officerName: { type: String, required: true }, // denormalized for table display

    leaveType: { type: String, enum: ["annual", "sick", "casual"], required: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true },

    // Required, >=30 words, if annual leave > 5 days — enforce this in the
    // controller/validation layer, not here, since it depends on leaveType/days.
    justification: { type: String, default: "" },

    actingOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    emergencyContact: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: "" },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables/handlers key off `id`, not `_id` — see User.js for the
// same convention.
leaveRequestSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
