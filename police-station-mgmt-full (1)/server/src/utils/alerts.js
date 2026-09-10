// Shared by every controller that can trigger a weapon-related alert
// (inventoryController, maintenanceController, inspectionsController) —
// kept here rather than in alertsController.js so those controllers
// don't have to require a controller module just to generate an alert
// as a side effect of something else they're doing.

const Alert = require("../models/Alert");

const ALERT_PRIORITY = {
  weapon_missing: "critical",
  ammo_discrepancy: "critical",
  inspection_failed: "critical",
  weapon_damage: "critical",
  return_overdue: "warning",
  inspection_due: "warning",
  maintenance_pending: "warning",
  return_awaiting_confirmation: "warning",
  weapon_issued: "info",
  weapon_returned: "info",
  maintenance_completed: "info",
  inspection_completed: "info",
};

async function generateRefId() {
  const count = await Alert.countDocuments();
  return `ALT-${String(count + 1).padStart(4, "0")}`;
}

// Never called from a route handler directly — always as a side effect
// of some other action (issue, return confirmation, maintenance status
// change, inspection recorded, ...). stationId must come from the
// triggering request's req.user.stationId.
async function generateAlert({
  alertType,
  title,
  message = "",
  itemId = null,
  transactionId = null,
  maintenanceId = null,
  inspectionId = null,
  recipientId = null,
  stationId,
}) {
  const priority = ALERT_PRIORITY[alertType];
  if (!priority) throw new Error(`Unknown alert type: ${alertType}`);

  return Alert.create({
    refId: await generateRefId(),
    alertType,
    priority,
    title,
    message,
    itemId,
    transactionId,
    maintenanceId,
    inspectionId,
    recipientId,
    stationId,
  });
}

module.exports = { generateAlert };
