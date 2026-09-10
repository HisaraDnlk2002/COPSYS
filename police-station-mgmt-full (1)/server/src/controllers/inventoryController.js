const Inventory = require("../models/Inventory");
const { INSPECTION_INTERVAL_DAYS } = require("../models/Inventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const Maintenance = require("../models/Maintenance");
const { generateAlert } = require("../utils/alerts");

// GET /api/inventory/stats — duty_officer, inventory_officer
// Backs the 4 stat cards at the top of the Inventory Dashboard (Total
// Assets, Issued Items, Available Stock, Damaged/Repairs). This route
// never actually existed — getInventoryStats() on the client has been
// hitting a 404 since the dashboard was built, silently leaving those
// cards blank. Counts item *lines* (Inventory documents), matching how
// the "Showing X / Y items registered" footer already uses totalAssets.
async function getStats(req, res) {
  try {
    const stationId = req.user.stationId;
    const [totalAssets, issuedItems, availableStock, damagedRepairs] = await Promise.all([
      Inventory.countDocuments({ stationId }),
      Inventory.countDocuments({ stationId, status: "issued" }),
      Inventory.countDocuments({ stationId, status: "available" }),
      Inventory.countDocuments({ stationId, status: "damaged" }),
    ]);
    return res.json({ totalAssets, issuedItems, availableStock, damagedRepairs });
  } catch (err) {
    console.error("getStats inventory error:", err);
    return res.status(500).json({ error: "Could not load inventory stats" });
  }
}

// GET /api/inventory — duty_officer, inventory_officer
// Returns the Equipment Inventory Ledger (page 8): Item ID, Name, Category, Quantity, Status
async function list(req, res) {
  try {
    const items = await Inventory.find({ stationId: req.user.stationId }).sort({ itemName: 1 });
    return res.json(items.map((i) => i.toJSON()));
  } catch (err) {
    console.error("list inventory error:", err);
    return res.status(500).json({ error: "Could not load inventory" });
  }
}

// POST /api/inventory — inventory_officer
// Matches the "Add New Item" modal: Officer ID, Weapon Serial ID (-> itemId),
// Quantity to Add, Weapon Type (-> category)
async function create(req, res) {
  const { itemId, itemName, category, quantity, condition } = req.body;

  if (!itemId || !itemName || !category || quantity === undefined) {
    return res.status(400).json({ error: "Item ID, name, category and quantity are required" });
  }

  try {
    const existing = await Inventory.findOne({ itemId });
    if (existing) {
      return res.status(409).json({ error: "An item with that ID already exists" });
    }

    // A brand-new item goes on the periodic inspection schedule
    // immediately, not just once someone gets around to first
    // inspecting it — otherwise the "every weapon periodically checked"
    // goal has a gap for anything freshly added.
    const item = await Inventory.create({
      itemId,
      itemName,
      category,
      quantity,
      condition,
      status: "available",
      lastUpdatedBy: req.user.uid,
      nextInspectionDate: new Date(Date.now() + INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000),
      stationId: req.user.stationId,
    });
    return res.status(201).json(item.toJSON());
  } catch (err) {
    console.error("create inventory error:", err);
    return res.status(500).json({ error: "Could not add inventory item" });
  }
}

// PATCH /api/inventory/:id — duty_officer, inventory_officer
async function update(req, res) {
  const { quantity, condition, status, assignedTo } = req.body;

  try {
    const item = await Inventory.findByIdAndUpdate(
      req.params.id,
      {
        ...(quantity !== undefined && { quantity }),
        ...(condition && { condition }),
        ...(status && { status }),
        ...(assignedTo !== undefined && { assignedTo }),
        lastUpdatedBy: req.user.uid,
      },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: "Item not found" });
    return res.json(item.toJSON());
  } catch (err) {
    console.error("update inventory error:", err);
    return res.status(500).json({ error: "Could not update inventory item" });
  }
}

// POST /api/inventory/:id/issue — duty_officer, inventory_officer
// Matches the "Issue Item" modal: Officer ID, Weapon Serial ID, Quantity to Issue, Deployment Date
async function issue(req, res) {
  const { officerId, quantity, dutyType, dateTime, expectedReturnDate } = req.body;

  if (!officerId || !quantity) {
    return res.status(400).json({ error: "Officer ID and quantity are required" });
  }

  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    // A weapon under maintenance — or reported missing — cannot be
    // issued. status only clears back to "available" via a completed
    // maintenance record with a passed final inspection (see
    // maintenanceController.js); "missing" only clears via a manual
    // update, there's no automatic path back from it.
    if (["damaged", "missing"].includes(item.status)) {
      return res.status(400).json({ error: "This item is unavailable (under maintenance or reported missing) and cannot be issued" });
    }
    if (item.quantity < quantity) {
      return res.status(400).json({ error: "Not enough stock available to issue" });
    }

    item.quantity -= quantity;
    item.status = item.quantity === 0 ? "issued" : item.status;
    item.assignedTo = officerId;
    item.lastUpdatedBy = req.user.uid;
    await item.save();

    const transaction = await InventoryTransaction.create({
      itemId: item._id,
      officerId,
      processedBy: req.user.uid,
      type: "issue",
      dutyType,
      quantity,
      dateTime: dateTime || new Date(),
      expectedReturnDate: expectedReturnDate || null,
      confirmationStatus: "pending",
      stationId: req.user.stationId,
    });

    await generateAlert({
      alertType: "weapon_issued",
      title: "Weapon Successfully Issued",
      message: `${item.itemId} issued, pending the officer's receipt confirmation.`,
      itemId: item._id,
      transactionId: transaction._id,
      recipientId: officerId,
      stationId: req.user.stationId,
    });

    return res.status(201).json(transaction.toJSON());
  } catch (err) {
    console.error("issue inventory error:", err);
    return res.status(500).json({ error: "Could not process issue transaction" });
  }
}

// POST /api/inventory/:id/return — duty_officer, inventory_officer
// Steps 1-4 of the return workflow (physical verification + ammo check +
// submit): the Inventory Officer records what they observed and
// submits. This deliberately does NOT touch the item's stock/status —
// see confirmTransaction below, which applies that once the officer
// who's returning it confirms the return actually happened. Until then
// the item stays exactly as it was (issued, assigned to that officer),
// same as before this handler ran.
async function returnItem(req, res) {
  const { officerId, quantity, condition, remarks, dateTime, ammoIssued, ammoReturned } = req.body;

  if (!officerId || !quantity || !condition) {
    return res.status(400).json({ error: "Officer ID, quantity and condition are required" });
  }

  const hasAmmoIssued = ammoIssued !== undefined && ammoIssued !== null && ammoIssued !== "";
  const hasAmmoReturned = ammoReturned !== undefined && ammoReturned !== null && ammoReturned !== "";
  if (hasAmmoIssued && hasAmmoReturned && Number(ammoReturned) > Number(ammoIssued)) {
    return res.status(400).json({ error: "Ammunition returned cannot exceed ammunition issued" });
  }

  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const transactionType = condition.toLowerCase() === "faulty" ? "damaged" : "return";

    const transaction = await InventoryTransaction.create({
      itemId: item._id,
      officerId,
      processedBy: req.user.uid,
      type: transactionType,
      quantity,
      dateTime: dateTime || new Date(),
      condition,
      remarks,
      ammoIssued: hasAmmoIssued ? Number(ammoIssued) : null,
      ammoReturned: hasAmmoReturned ? Number(ammoReturned) : null,
      ammoUsed: hasAmmoIssued && hasAmmoReturned ? Number(ammoIssued) - Number(ammoReturned) : null,
      confirmationStatus: "pending",
      stationId: req.user.stationId,
    });

    await generateAlert({
      alertType: "return_awaiting_confirmation",
      title: "Return Awaiting Officer Confirmation",
      message: `${item.itemId} return submitted — waiting on the officer to confirm before it's secured.`,
      itemId: item._id,
      transactionId: transaction._id,
      recipientId: officerId,
      stationId: req.user.stationId,
    });

    return res.status(201).json(transaction.toJSON());
  } catch (err) {
    console.error("return inventory error:", err);
    return res.status(500).json({ error: "Could not process return transaction" });
  }
}

// GET /api/inventory/transactions?type=issue|return|damaged
// Backs the Issue Records / Return Records / Damaged Records tabs (page 8)
async function listTransactions(req, res) {
  const { type } = req.query;

  try {
    const filter = { stationId: req.user.stationId };
    if (type) filter.type = type;

    const transactions = await InventoryTransaction.find(filter)
      .sort({ dateTime: -1 })
      .populate("itemId", "itemId itemName category")
      .populate("officerId", "fullName rankAndNumber")
      .populate("processedBy", "fullName rankAndNumber");

    return res.json(transactions.map((t) => t.toJSON()));
  } catch (err) {
    console.error("listTransactions error:", err);
    return res.status(500).json({ error: "Could not load transaction log" });
  }
}

// GET /api/inventory/my-weapons — any authenticated role. Unlike every
// other route in this file, this one is NOT gated to
// duty_officer/inventory_officer (see inventoryRoutes.js) — it's scoped
// server-side to req.user.uid, so an officer viewing it can only ever
// see their own currently-assigned firearm(s) and their own custody
// history, never the station-wide ledger.
//
// "Currently assigned" requires status === "issued" as well as
// assignedTo === me, belt-and-suspenders: assignedTo is only cleared
// once a return is *confirmed* (see confirmTransaction below), so
// during the pending-confirmation window it correctly still shows here
// — the officer is still the one formally accountable for it.
async function getMyWeapons(req, res) {
  try {
    const officerId = req.user.uid;

    const assigned = await Inventory.find({
      assignedTo: officerId,
      status: "issued",
      category: "Firearms",
    }).sort({ itemName: 1 });

    // Pull a bit more than we'll show, then filter to firearms-only
    // client-side of the query (category lives on the populated item,
    // not the transaction itself) before trimming to the display limit.
    const recentTx = await InventoryTransaction.find({ officerId })
      .sort({ dateTime: -1 })
      .limit(50)
      .populate("itemId", "itemId itemName category")
      .populate("processedBy", "fullName rankAndNumber");

    const firearmsTx = recentTx.filter((tx) => tx.itemId?.category === "Firearms");
    const history = firearmsTx.slice(0, 20);

    // Any transaction (issue OR return/damaged) naming this officer that
    // they haven't yet confirmed — surfaced separately (and first) on
    // the My Weapons page as an action item, not just another history
    // row. See confirmTransaction for what confirming each type does.
    const pendingConfirmation = firearmsTx.filter((tx) => tx.confirmationStatus === "pending");

    return res.json({
      assigned: assigned.map((i) => i.toJSON()),
      history: history.map((tx) => tx.toJSON()),
      pendingConfirmation: pendingConfirmation.map((tx) => tx.toJSON()),
    });
  } catch (err) {
    console.error("getMyWeapons error:", err);
    return res.status(500).json({ error: "Could not load your weapon custody" });
  }
}

// PATCH /api/inventory/transactions/:id/confirm — the officer named in
// the transaction (officerId) ONLY. This is deliberately the only place
// confirmationStatus can move from "pending" to "secured" anywhere in
// the codebase — there is no Inventory Officer action that can set it
// directly, and this handler itself refuses unless the caller IS
// officerId. That's the whole point of the two-party workflow: whoever
// processed a transaction (issued or physically took back a weapon)
// can't also be the one who attests the officer's end of it happened.
//
// Confirming means something different depending on type:
//   - issue: the officer acknowledges they physically received the
//     weapon. Its stock/status already updated at issue time (see
//     issue() above) — confirming here only records the acknowledgment.
//   - return / damaged: the officer acknowledges they physically
//     returned the weapon. THIS is what applies the stock update
//     (quantity restored, status -> available/damaged) — deliberately
//     deferred until now rather than at submission (see returnItem),
//     so stock can't free up on the Inventory Officer's say-so alone.
async function confirmTransaction(req, res) {
  try {
    const tx = await InventoryTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    if (!["issue", "return", "damaged"].includes(tx.type)) {
      return res.status(400).json({ error: "This transaction type cannot be confirmed" });
    }
    if (String(tx.officerId) !== String(req.user.uid)) {
      return res.status(403).json({ error: "Only the officer on this transaction can confirm it" });
    }
    if (tx.confirmationStatus === "secured") {
      return res.status(400).json({ error: "This transaction has already been confirmed" });
    }

    if (tx.type === "return" || tx.type === "damaged") {
      const item = await Inventory.findById(tx.itemId);
      if (item) {
        item.quantity += tx.quantity;
        item.status = tx.type === "damaged" ? "damaged" : "available";
        item.condition = tx.condition;
        item.assignedTo = null; // nobody's assigned to stock that's back in the armory
        item.lastUpdatedBy = tx.processedBy || req.user.uid;
        await item.save();

        if (tx.type === "damaged") {
          // Auto-connects the Return module to the Maintenance module: a
          // damaged weapon can't be issued again (see the check in
          // issue()) until a maintenance record for it is completed with
          // a passed final inspection.
          const maintenanceCount = await Maintenance.countDocuments();
          await Maintenance.create({
            refId: `MR-${String(maintenanceCount + 1).padStart(4, "0")}`,
            itemId: item._id,
            issueDescription: tx.remarks || "Reported damaged on return",
            reportedBy: tx.processedBy,
            reportedDate: new Date(),
            sourceTransactionId: tx._id,
            stationId: tx.stationId,
          });

          await generateAlert({
            alertType: "weapon_damage",
            title: "Serious Weapon Damage",
            message: `${item.itemId} returned in faulty condition — a maintenance record has been opened.`,
            itemId: item._id,
            transactionId: tx._id,
            recipientId: tx.officerId,
            stationId: tx.stationId,
          });
          await generateAlert({
            alertType: "maintenance_pending",
            title: "Maintenance Pending",
            message: `${item.itemId} is awaiting maintenance.`,
            itemId: item._id,
            transactionId: tx._id,
            stationId: tx.stationId,
          });
        } else {
          await generateAlert({
            alertType: "weapon_returned",
            title: "Weapon Returned",
            message: `${item.itemId} return confirmed and secured.`,
            itemId: item._id,
            transactionId: tx._id,
            recipientId: tx.officerId,
            stationId: tx.stationId,
          });
        }

        // Any ammo not accounted for needs review, regardless of
        // whether the weapon itself came back in good condition — using
        // ammo on duty is normal, but it still needs to reconcile.
        if (tx.ammoUsed !== null && tx.ammoUsed > 0) {
          await generateAlert({
            alertType: "ammo_discrepancy",
            title: "Ammunition Discrepancy",
            message: `${tx.ammoUsed} round(s) not accounted for on return of ${item.itemId} (issued ${tx.ammoIssued}, returned ${tx.ammoReturned}).`,
            itemId: item._id,
            transactionId: tx._id,
            recipientId: tx.officerId,
            stationId: tx.stationId,
          });
        }
      }
    }

    tx.confirmationStatus = "secured";
    tx.confirmedAt = new Date();
    tx.confirmationRemarks = req.body.remarks || null;
    await tx.save();

    return res.json(tx.toJSON());
  } catch (err) {
    console.error("confirmTransaction error:", err);
    return res.status(500).json({ error: "Could not confirm this transaction" });
  }
}

// POST /api/inventory/:id/report-missing — inventory_officer only.
// Marks a weapon missing — blocked from issue() same as "damaged" (see
// the check there) — and raises a Critical alert. There's no automatic
// path back from "missing" the way damaged/failed-inspection items have
// via Maintenance; it has to be manually cleared once the weapon is
// located (see update()).
async function reportMissing(req, res) {
  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const lastAssignee = item.assignedTo;
    item.status = "missing";
    item.lastUpdatedBy = req.user.uid;
    await item.save();

    await generateAlert({
      alertType: "weapon_missing",
      title: "Weapon Reported Missing",
      message: req.body.remarks || `${item.itemId} has been reported missing.`,
      itemId: item._id,
      recipientId: lastAssignee,
      stationId: req.user.stationId,
    });

    return res.json(item.toJSON());
  } catch (err) {
    console.error("reportMissing error:", err);
    return res.status(500).json({ error: "Could not report this item missing" });
  }
}

module.exports = { list, create, update, issue, returnItem, listTransactions, getMyWeapons, getStats, confirmTransaction, reportMissing };
