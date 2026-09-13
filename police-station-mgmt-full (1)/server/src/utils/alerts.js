// Shared by every controller that can trigger a weapon-related alert
// (inventoryController, maintenanceController, inspectionsController) —
// kept here rather than in alertsController.js so those controllers
// don't have to require a controller module just to generate an alert
// as a side effect of something else they're doing.

const Alert = require("../models/Alert");
const { sendToUser } = require("./sseHub");

const ALERT_PRIORITY = {
  weapon_missing: "critical",
  ammo_discrepancy: "critical",
  inspection_failed: "critical",
  weapon_damage: "critical",
  critical_complaint: "critical",
  return_overdue: "warning",
  inspection_due: "warning",
  maintenance_pending: "warning",
  return_awaiting_confirmation: "warning",
  leave_rejected: "warning",
  weapon_issued: "info",
  weapon_returned: "info",
  maintenance_completed: "info",
  inspection_completed: "info",
  roster_published: "info",
  leave_request_submitted: "info",
  leave_approved: "info",
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

  const alert = await Alert.create({
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

  // Live push, on top of the normal on-open/on-load fetch — reaches the
  // recipient immediately if they already have the app open, rather
  // than waiting for them to next open the bell or reload the page. Only
  // ever for personal alerts (recipientId set); station-wide/armory-side
  // ones (missing/damaged/maintenance/inspection housekeeping) only ever
  // showed on the Inventory Officer's own dashboard anyway, never the
  // personal bell — see the bell's own eligibility comment.
  sendToUser(recipientId, { type: "alert", alertType, priority, title });

  return alert;
}

module.exports = { generateAlert };
