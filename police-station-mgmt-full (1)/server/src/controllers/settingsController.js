const SystemSettings = require("../models/SystemSettings");
const { logAuditForActor } = require("../utils/auditLogger");

// Must match Settings.jsx's RBAC_MODULES exactly — the client indexes
// settings.rbac[module.key][rank.key] directly with no existence check,
// so a settings doc missing any of these keys crashes that page's RBAC
// table entirely (blank screen, "Cannot read properties of undefined").
const RBAC_MODULE_KEYS = ["leaveApprovals", "complaintRegistry", "inventoryIssues", "dutyRosterPublish", "systemReports"];

function emptyRbacModule() {
  return { chiefInspector: false, inspectorOIC: false, sergeant: false, constable: false };
}

// GET /api/settings — oic and admin only
// Returns the station's settings doc, creating a default one on first
// access so the frontend never has to handle "no settings exist yet".
async function getSettings(req, res) {
  try {
    let settings = await SystemSettings.findOne({ stationId: req.user.stationId });
    if (!settings) {
      const rbac = {};
      for (const key of RBAC_MODULE_KEYS) rbac[key] = emptyRbacModule();
      settings = await SystemSettings.create({ stationId: req.user.stationId, rbac });
    } else {
      // Self-heals a settings doc that predates RBAC_MODULE_KEYS growing
      // (or one auto-created before this fix existed at all, with an
      // empty rbac map) — backfill whatever's missing rather than
      // leaving the RBAC table permanently broken for this station.
      let changed = false;
      for (const key of RBAC_MODULE_KEYS) {
        if (!settings.rbac.get(key)) {
          settings.rbac.set(key, emptyRbacModule());
          changed = true;
        }
      }
      if (changed) await settings.save();
    }
    return res.json(settings.toJSON());
  } catch (err) {
    console.error("getSettings error:", err);
    return res.status(500).json({ error: "Could not load settings" });
  }
}

// PATCH /api/settings — oic and admin only
// Matches page 15's "Save changes" button — accepts the whole settings
// shape (Communication Protocols toggles + RBAC matrix) and overwrites it.
async function updateSettings(req, res) {
  const { smsNotificationsEnabled, emailDispatchEnabled, criticalComplaintThreshold, rbac } = req.body;

  try {
    const settings = await SystemSettings.findOneAndUpdate(
      { stationId: req.user.stationId },
      {
        ...(smsNotificationsEnabled !== undefined && { smsNotificationsEnabled }),
        ...(emailDispatchEnabled !== undefined && { emailDispatchEnabled }),
        ...(criticalComplaintThreshold !== undefined && { criticalComplaintThreshold }),
        ...(rbac && { rbac }),
        lastModifiedBy: req.user.uid,
      },
      { new: true, upsert: true }
    );
    logAuditForActor(req, { action: "Updated System Settings", module: "Settings" });
    return res.json(settings.toJSON());
  } catch (err) {
    console.error("updateSettings error:", err);
    return res.status(500).json({ error: "Could not save settings" });
  }
}

module.exports = { getSettings, updateSettings };
