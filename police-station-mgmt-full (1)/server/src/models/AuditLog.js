const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, required: true }, // denormalized so the log still reads fine if the account is later removed

    action: { type: String, required: true }, // e.g. "User Login"
    module: { type: String, required: true }, // e.g. "Authentication"

    status: { type: String, enum: ["success", "failed"], required: true },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Frontend tables key off `id`, not `_id` — see User.js for the same convention.
auditLogSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("AuditLog", auditLogSchema);
