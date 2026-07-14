const SystemSettings = require("../models/SystemSettings");

// GET /api/settings — oic and admin only
// Returns the station's settings doc, creating a default one on first
// access so the frontend never has to handle "no settings exist yet".
async function getSettings(req, res) {
  try {
    let settings = await SystemSettings.findOne({ stationId: req.user.stationId });
    if (!settings) {
      settings = await SystemSettings.create({ stationId: req.user.stationId });
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
    return res.json(settings.toJSON());
  } catch (err) {
    console.error("updateSettings error:", err);
    return res.status(500).json({ error: "Could not save settings" });
  }
}

module.exports = { getSettings, updateSettings };
