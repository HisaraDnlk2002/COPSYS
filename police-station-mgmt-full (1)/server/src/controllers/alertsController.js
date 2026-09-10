const Alert = require("../models/Alert");
const Inventory = require("../models/Inventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const { generateAlert } = require("../utils/alerts");

// How soon before nextInspectionDate "Inspection Due" fires — mirrors
// INSPECTION_DUE_SOON_DAYS in Inventory.jsx, kept in sync manually since
// there's no shared config module between client and server here.
const INSPECTION_DUE_SOON_DAYS = 14;

// Runs on every GET /api/alerts. return_overdue and inspection_due
// aren't tied to a single action the way the other 10 alert types are
// (issue, confirm, maintenance status change, inspection recorded) —
// they're conditions that become true purely with the passage of time,
// so there's nothing to hook them into directly. This scans for them
// instead, gated by the overdueAlertGenerated/dueAlertGenerated flags on
// the underlying documents so it's safe to run on every fetch without
// creating duplicate alerts each time someone opens the page.
async function scanForTimeBasedAlerts(stationId) {
  const now = new Date();

  const overdueIssues = await InventoryTransaction.find({
    stationId,
    type: "issue",
    expectedReturnDate: { $ne: null, $lt: now },
    overdueAlertGenerated: false,
  }).populate("itemId");

  for (const tx of overdueIssues) {
    // Already returned (and confirmed) since — not actually overdue,
    // just never got its flag cleared because nothing clears it on
    // return. Skip rather than false-alarm.
    if (tx.itemId?.status !== "issued") continue;

    await generateAlert({
      alertType: "return_overdue",
      title: "Weapon Return Overdue",
      message: `${tx.itemId.itemId} was expected back by ${tx.expectedReturnDate.toISOString().slice(0, 16).replace("T", " ")}.`,
      itemId: tx.itemId._id,
      transactionId: tx._id,
      recipientId: tx.officerId,
      stationId,
    });
    tx.overdueAlertGenerated = true;
    await tx.save();
  }

  const dueSoonCutoff = new Date(now.getTime() + INSPECTION_DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  const dueItems = await Inventory.find({
    stationId,
    nextInspectionDate: { $ne: null, $lte: dueSoonCutoff },
    dueAlertGenerated: false,
    // Can't physically inspect a weapon that's out with an officer, or
    // one nobody can currently locate — neither is "due" in practice.
    status: { $nin: ["issued", "missing"] },
  });

  for (const item of dueItems) {
    const overdue = item.nextInspectionDate < now;
    await generateAlert({
      alertType: "inspection_due",
      title: overdue ? "Weapon Inspection Overdue" : "Weapon Inspection Due Soon",
      message: `${item.itemId} — next inspection ${overdue ? "was due" : "due"} ${item.nextInspectionDate.toISOString().slice(0, 10)}.`,
      itemId: item._id,
      stationId,
    });
    item.dueAlertGenerated = true;
    await item.save();
  }
}

// GET /api/alerts — duty_officer, inventory_officer. Station-wide feed
// for the Inventory Officer's dashboard. ?status= and ?priority= filter.
async function list(req, res) {
  try {
    const stationId = req.user.stationId;
    await scanForTimeBasedAlerts(stationId);

    const filter = { stationId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;

    const alerts = await Alert.find(filter)
      .sort({ generatedAt: -1 })
      .populate("itemId", "itemId itemName")
      .populate("recipientId", "fullName rankAndNumber")
      .populate("acknowledgedBy", "fullName rankAndNumber")
      .populate("actionTakenBy", "fullName rankAndNumber")
      .populate("resolvedBy", "fullName rankAndNumber");

    return res.json(alerts.map((a) => a.toJSON()));
  } catch (err) {
    console.error("list alerts error:", err);
    return res.status(500).json({ error: "Could not load alerts" });
  }
}

// GET /api/alerts/mine — any authenticated role. Only alerts personally
// addressed to the caller (recipientId === them) — a personal
// notification feed, not the station-wide dashboard. Does NOT run the
// time-based scan itself (list() already covers that whenever the
// Inventory Officer's dashboard is open); this just reads what exists.
async function listMine(req, res) {
  try {
    const alerts = await Alert.find({ recipientId: req.user.uid })
      .sort({ generatedAt: -1 })
      .limit(30)
      .populate("itemId", "itemId itemName");
    return res.json(alerts.map((a) => a.toJSON()));
  } catch (err) {
    console.error("listMine alerts error:", err);
    return res.status(500).json({ error: "Could not load your alerts" });
  }
}

const NEXT_STATUS = { new: "acknowledged", acknowledged: "action_taken", action_taken: "resolved" };

// PATCH /api/alerts/:id — inventory_officer (any station alert) OR the
// alert's own recipientId (only their own — the "relevant officer"
// acting on their own notification). Advances exactly one step through
// NEW -> ACKNOWLEDGED -> ACTION_TAKEN -> RESOLVED at a time; can't skip
// a step or move backwards. Same shape as Maintenance's status
// lifecycle in maintenanceController.js.
async function updateStatus(req, res) {
  const { status, remarks } = req.body;

  try {
    const alert = await Alert.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    const isInventoryOfficer = req.user.role === "inventory_officer";
    const isRecipient = alert.recipientId && String(alert.recipientId) === String(req.user.uid);
    if (!isInventoryOfficer && !isRecipient) {
      return res.status(403).json({ error: "You do not have permission to update this alert" });
    }

    const expected = NEXT_STATUS[alert.status];
    if (!expected || status !== expected) {
      return res.status(400).json({
        error: expected ? `This alert must move to "${expected}" next` : "This alert has already been resolved",
      });
    }

    const now = new Date();
    if (status === "acknowledged") {
      alert.acknowledgedBy = req.user.uid;
      alert.acknowledgedAt = now;
    } else if (status === "action_taken") {
      alert.actionTakenBy = req.user.uid;
      alert.actionTakenAt = now;
    } else if (status === "resolved") {
      alert.resolvedBy = req.user.uid;
      alert.resolvedAt = now;
    }
    alert.status = status;
    if (remarks !== undefined) alert.remarks = remarks;

    await alert.save();
    return res.json(alert.toJSON());
  } catch (err) {
    console.error("updateStatus alert error:", err);
    return res.status(500).json({ error: "Could not update this alert" });
  }
}

module.exports = { list, listMine, updateStatus };
