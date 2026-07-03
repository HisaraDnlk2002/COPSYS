const mongoose = require("mongoose");

// Per-rank permission flags for one RBAC module row (page 15's checkboxes).
const rbacModuleSchema = new mongoose.Schema(
  {
    chiefInspector: { type: Boolean, default: false },
    inspectorOIC: { type: Boolean, default: false },
    sergeant: { type: Boolean, default: false },
    constable: { type: Boolean, default: false },
  },
  { _id: false }
);

const systemSettingsSchema = new mongoose.Schema(
  {
    // One doc per station — seed.js looks this up by stationId directly.
    stationId: { type: String, required: true, unique: true },

    smsNotificationsEnabled: { type: Boolean, default: true },
    emailDispatchEnabled: { type: Boolean, default: true },
    criticalComplaintThreshold: { type: Number, default: 5 },

    // Keyed by moduleName -> per-rank booleans. NOTE (per ARCHITECTURE.md
    // Open Items): this is stored and editable via /api/settings, but
    // requireRole() does NOT read from it yet — it's UI-only for now.
    rbac: {
      type: Map,
      of: rbacModuleSchema,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SystemSettings", systemSettingsSchema);
