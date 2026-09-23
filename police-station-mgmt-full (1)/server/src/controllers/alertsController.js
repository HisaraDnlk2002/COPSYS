const Alert = require("../models/Alert");
const { ALERT_SOURCES, alertTypesForSource } = require("../models/Alert");
const Inventory = require("../models/Inventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const { generateAlert } = require("../utils/alerts");
const { syncLowStockAlert } = require("../utils/ammoStock");
const { AMMUNITION_CATEGORY } = require("../config/weaponCatalog");

// How soon before nextInspectionDate "Inspection Due" fires — mirrors
// INSPECTION_DUE_SOON_DAYS in Inventory.jsx, kept in sync manually since
// there's no shared config module between client and server here.
const INSPECTION_DUE_SOON_DAYS = 14;

// How long an issue/return can sit unconfirmed by the officer before a
// "Confirmation Overdue" reminder goes out.
const CONFIRMATION_REMINDER_HOURS = 2;

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
    // item.status alone can't tell us "was THIS issue returned" — stock
    // is quantity-pooled (one Inventory doc can have many units, each
    // possibly out to a different officer at once), so status only
    // flips to "issued" once every last unit is out. A weapon with
    // stock remaining never trips that, letting a genuinely overdue
    // unit slip through. The only reliable signal is a later
    // return/damaged transaction for this same item + officer.
    const alreadyReturned = await InventoryTransaction.exists({
      itemId: tx.itemId?._id,
      officerId: tx.officerId,
      type: { $in: ["return", "damaged"] },
      dateTime: { $gte: tx.dateTime },
    });
    if (!tx.itemId || alreadyReturned) continue;

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

  const reminderCutoff = new Date(now.getTime() - CONFIRMATION_REMINDER_HOURS * 60 * 60 * 1000);
  const unconfirmed = await InventoryTransaction.find({
    stationId,
    confirmationStatus: "pending",
    createdAt: { $lt: reminderCutoff },
    confirmationReminderGenerated: false,
  }).populate("itemId", "itemId");

  for (const tx of unconfirmed) {
    await generateAlert({
      alertType: "confirmation_overdue",
      title: tx.type === "issue" ? "Weapon Receipt Not Confirmed" : "Weapon Return Not Confirmed",
      message: `${tx.itemId?.itemId || "A weapon"} ${tx.type === "issue" ? "issue" : "return"} has been waiting over ${CONFIRMATION_REMINDER_HOURS} hours for the officer's confirmation on My Weapons.`,
      itemId: tx.itemId?._id || null,
      transactionId: tx._id,
      recipientId: tx.officerId,
      stationId,
    });
    tx.confirmationReminderGenerated = true;
    await tx.save();
  }

  // Catches ammunition lines that were already at/below threshold
  // without passing through issue/restock (e.g. threshold raised later).
  const ammoLines = await Inventory.find({
    stationId,
    category: AMMUNITION_CATEGORY,
    lowStockThreshold: { $ne: null },
    lowStockAlertGenerated: false,
  });
  for (const item of ammoLines) await syncLowStockAlert(item);
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

// GET /api/alerts/feed — every role. Backs the Notifications page.
// What each role sees:
//   oic                       -> every alert at the station (reviews all exceptions)
//   inventory/duty officer    -> all inventory alerts at the station + their own
//   everyone else             -> only alerts addressed to them
// Optional ?source=inventory|leave|duty|complaints, ?status=, ?priority=.
const INVENTORY_ROLES = ["inventory_officer", "duty_officer"];

async function feed(req, res) {
  try {
    const { stationId, uid, role } = req.user;
    await scanForTimeBasedAlerts(stationId);

    let visibility;
    if (role === "oic") {
      visibility = {};
    } else if (INVENTORY_ROLES.includes(role)) {
      visibility = { $or: [{ alertType: { $in: alertTypesForSource("inventory") } }, { recipientId: uid }] };
    } else {
      visibility = { recipientId: uid };
    }

    const filter = { stationId, ...visibility };
    if (req.query.source) {
      if (!ALERT_SOURCES.includes(req.query.source)) {
        return res.status(400).json({ error: "Unknown alert source" });
      }
      filter.alertType = { $in: alertTypesForSource(req.query.source) };
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;

    const alerts = await Alert.find(filter)
      .sort({ generatedAt: -1 })
      .limit(500)
      .populate("itemId", "itemId itemName")
      .populate("recipientId", "fullName rankAndNumber")
      .populate("acknowledgedBy", "fullName rankAndNumber")
      .populate("actionTakenBy", "fullName rankAndNumber")
      .populate("resolvedBy", "fullName rankAndNumber");

    return res.json(alerts.map((a) => a.toJSON()));
  } catch (err) {
    console.error("feed alerts error:", err);
    return res.status(500).json({ error: "Could not load notifications" });
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

    // OIC reviews exceptions (workflow section 8), so can move any
    // alert along its lifecycle too, same as the Inventory Officer.
    const isOic = req.user.role === "oic";
    const isInventoryAlertForInventoryOfficer =
      req.user.role === "inventory_officer" && alertTypesForSource("inventory").includes(alert.alertType);
    const isRecipient = alert.recipientId && String(alert.recipientId) === String(req.user.uid);
    if (!isOic && !isInventoryAlertForInventoryOfficer && !isRecipient) {
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

module.exports = { list, listMine, feed, updateStatus };
