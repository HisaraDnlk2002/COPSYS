const Inventory = require("../models/Inventory");
const { INSPECTION_INTERVAL_DAYS } = require("../models/Inventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const Maintenance = require("../models/Maintenance");
const User = require("../models/User");
const LeaveRequest = require("../models/LeaveRequest");
const { generateAlert } = require("../utils/alerts");
const { logAuditForActor } = require("../utils/auditLogger");
const {
  WEAPON_CATEGORIES,
  AMMUNITION_CATEGORY,
  STORAGE_LOCATIONS,
  calibersForType,
  accessoriesForType,
  isValidCatalogEntry,
} = require("../config/weaponCatalog");
const { syncLowStockAlert } = require("../utils/ammoStock");

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
// Weapon registration (workflow step 1): Weapon ID (-> itemId), serial
// number, category + type (-> itemName), caliber, storage location,
// condition, optional last inspection date. For ammunition the itemId is
// the batch/lot ID, quantity is rounds, and lowStockThreshold drives the
// "Low Ammunition Stock" alert.
const WEAPON_ID_PATTERN = /^\d{5}$/;

async function create(req, res) {
  const {
    itemId,
    itemName,
    category,
    quantity,
    condition,
    serialNumber,
    caliber,
    storageLocation,
    lastInspectionDate,
    lowStockThreshold,
  } = req.body;

  if (!itemId || !itemName || !category || quantity === undefined) {
    return res.status(400).json({ error: "Item ID, name, category and quantity are required" });
  }
  if (!isValidCatalogEntry(category, itemName)) {
    return res.status(400).json({ error: "Unknown weapon category or type" });
  }
  const isAmmunition = category === AMMUNITION_CATEGORY;
  if (!isAmmunition && !serialNumber?.trim()) {
    return res.status(400).json({ error: "Item ID is required for a weapon" });
  }
  // Firearms only. One possible caliber for the type -> set it here; more
  // than one -> the form must say which this particular weapon takes.
  const typeCalibers = category === "Firearms" ? calibersForType(itemName) : [];
  let resolvedCaliber = "";
  if (typeCalibers.length === 1) {
    resolvedCaliber = typeCalibers[0];
  } else if (typeCalibers.length > 1) {
    if (!typeCalibers.includes(caliber)) {
      return res.status(400).json({ error: `Select the caliber for this ${itemName} (${typeCalibers.join(" or ")})` });
    }
    resolvedCaliber = caliber;
  }
  if (storageLocation && !STORAGE_LOCATIONS.includes(storageLocation)) {
    return res.status(400).json({ error: "Unknown storage location" });
  }
  // Weapons use fixed-format IDs: Weapon ID and Item ID are exactly 5
  // digits each. (Ammunition batch IDs keep their free format.)
  if (!isAmmunition) {
    if (!WEAPON_ID_PATTERN.test(String(itemId))) {
      return res.status(400).json({ error: "Weapon ID must be exactly 5 digits" });
    }
    if (!WEAPON_ID_PATTERN.test(String(serialNumber).trim())) {
      return res.status(400).json({ error: "Item ID must be exactly 5 digits" });
    }
  }

  try {
    const existing = await Inventory.findOne({ itemId });
    if (existing) {
      return res.status(409).json({ error: "An item with that ID already exists" });
    }
    if (serialNumber?.trim()) {
      const serialTaken = await Inventory.exists({ serialNumber: serialNumber.trim() });
      if (serialTaken) return res.status(409).json({ error: "A weapon with that Item ID is already registered" });
    }

    // A brand-new weapon goes on the periodic inspection schedule
    // immediately — counted from its last inspection if one is known,
    // otherwise from today. Ammunition isn't periodically inspected.
    const lastInspected = lastInspectionDate ? new Date(lastInspectionDate) : null;
    const scheduleFrom = lastInspected || new Date();
    const item = await Inventory.create({
      itemId,
      itemName,
      category,
      quantity,
      condition: condition || "good",
      serialNumber: serialNumber?.trim() || "",
      caliber: resolvedCaliber,
      storageLocation: storageLocation?.trim() || "",
      status: "available",
      lastUpdatedBy: req.user.uid,
      lastInspectionDate: isAmmunition ? null : lastInspected,
      nextInspectionDate: isAmmunition
        ? null
        : new Date(scheduleFrom.getTime() + INSPECTION_INTERVAL_DAYS * 24 * 60 * 60 * 1000),
      lowStockThreshold:
        isAmmunition && lowStockThreshold !== undefined && lowStockThreshold !== "" && lowStockThreshold !== null
          ? Number(lowStockThreshold)
          : null,
      stationId: req.user.stationId,
    });
    await syncLowStockAlert(item);
    logAuditForActor(req, { action: `Added Inventory Item: ${item.itemId} (${item.itemName})`, module: "Inventory" });
    return res.status(201).json(item.toJSON());
  } catch (err) {
    console.error("create inventory error:", err);
    return res.status(500).json({ error: "Could not add inventory item" });
  }
}

// PATCH /api/inventory/:id — duty_officer, inventory_officer
async function update(req, res) {
  const { quantity, condition, status, assignedTo, storageLocation, lowStockThreshold } = req.body;
  if (storageLocation && !STORAGE_LOCATIONS.includes(storageLocation)) {
    return res.status(400).json({ error: "Unknown storage location" });
  }

  try {
    const item = await Inventory.findByIdAndUpdate(
      req.params.id,
      {
        ...(quantity !== undefined && { quantity }),
        ...(condition && { condition }),
        ...(status && { status }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(storageLocation !== undefined && { storageLocation }),
        ...(lowStockThreshold !== undefined && {
          lowStockThreshold: lowStockThreshold === "" || lowStockThreshold === null ? null : Number(lowStockThreshold),
        }),
        lastUpdatedBy: req.user.uid,
      },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: "Item not found" });
    await syncLowStockAlert(item);
    logAuditForActor(req, { action: `Updated Inventory Item: ${item.itemId} (${item.itemName})`, module: "Inventory" });
    return res.json(item.toJSON());
  } catch (err) {
    console.error("update inventory error:", err);
    return res.status(500).json({ error: "Could not update inventory item" });
  }
}

// POST /api/inventory/:id/restock — inventory_officer
// Adds received stock to an existing line (mainly ammunition deliveries).
// Recorded in the audit trail with who/when/how many.
async function restock(req, res) {
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be a whole number above zero" });
  }

  try {
    const item = await Inventory.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!item) return res.status(404).json({ error: "Item not found" });

    item.quantity += quantity;
    if (item.status === "issued" && item.quantity > 0) item.status = "available";
    item.lastUpdatedBy = req.user.uid;
    await item.save();
    await syncLowStockAlert(item);

    logAuditForActor(req, {
      action: `Restocked ${item.itemId} (${item.itemName}) +${quantity} — now ${item.quantity}${req.body.remarks ? ` (${req.body.remarks})` : ""}`,
      module: "Inventory",
    });
    return res.json(item.toJSON());
  } catch (err) {
    console.error("restock inventory error:", err);
    return res.status(500).json({ error: "Could not restock this item" });
  }
}

// Units of each item this officer still holds: issues minus
// return/damaged records (confirmed or not — once a return is submitted
// the weapon is physically back in the armory). Keyed by item id, with
// the most recent issue transaction kept for its expectedReturnDate.
async function getOutstandingIssues(officerId) {
  const txs = await InventoryTransaction.find({ officerId })
    .sort({ dateTime: 1 })
    .populate("itemId", "itemId itemName category");
  const byItem = new Map();
  for (const tx of txs) {
    if (!tx.itemId) continue;
    const key = tx.itemId._id.toString();
    const entry = byItem.get(key) || { item: tx.itemId, net: 0, lastIssue: null };
    if (tx.type === "issue") {
      entry.net += tx.quantity || 1;
      entry.lastIssue = tx;
    } else {
      entry.net -= tx.quantity || 1;
    }
    byItem.set(key, entry);
  }
  return [...byItem.values()].filter((e) => e.net > 0);
}

// Workflow step 2.3 — "COPSYS performs eligibility and availability
// checks". Returns an error message, or null if the officer can take
// this item.
async function checkIssueEligibility(officerId, item) {
  const officer = await User.findById(officerId).select("fullName status role");
  if (!officer) return "Officer not found";
  if (officer.status !== "active") return `${officer.fullName}'s account is not active`;
  // Admin/OIC aren't operational roles and have no My Weapons page to
  // confirm receipt from, so an issue to them could never be secured.
  if (["admin", "oic"].includes(officer.role)) return `${officer.fullName} is not an operational role and cannot hold a weapon`;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const onLeave = await LeaveRequest.exists({
    officerId,
    status: "approved",
    startDate: { $lte: now },
    endDate: { $gte: startOfToday },
  });
  if (onLeave) return `${officer.fullName} is on approved leave today`;

  const outstanding = await getOutstandingIssues(officerId);
  const overdue = outstanding.find((e) => e.lastIssue?.expectedReturnDate && e.lastIssue.expectedReturnDate < now);
  if (overdue) return `${officer.fullName} has an overdue weapon that hasn't been returned (${overdue.item.itemId})`;
  // One weapon per officer, of any kind (firearm, baton, taser...). Only
  // weapons are ever issued as items — ammunition rides along on the
  // weapon's issue record — so anything outstanding here is a weapon.
  if (outstanding.length > 0) {
    const held = outstanding[0].item;
    return `${officer.fullName} already holds a weapon (${held.itemId} — ${held.itemName}). It must be returned before another is issued`;
  }
  return null;
}

function hasValue(v) {
  return v !== undefined && v !== null && v !== "";
}

// POST /api/inventory/:id/issue — inventory_officer
// Workflow step 2: officer + weapon + duty/time/expected return, plus
// optional ammunition drawn from an Ammunition stock line and the
// accessories handed over. Creates a PENDING record — only the receiving
// officer can secure it (see confirmTransaction).
async function issue(req, res) {
  const { officerId, dutyType, expectedReturnDate, ammoIssued, ammoItemId, accessories } = req.body;

  if (!officerId) {
    return res.status(400).json({ error: "Officer ID is required" });
  }
  // One weapon per issue. A stock line can hold several units (e.g. 5
  // batons), but an officer only ever takes one of them.
  if (req.body.quantity !== undefined && Number(req.body.quantity) !== 1) {
    return res.status(400).json({ error: "Only one weapon can be issued to an officer at a time" });
  }
  const quantity = 1;
  const rounds = hasValue(ammoIssued) ? Number(ammoIssued) : 0;
  if (!Number.isInteger(rounds) || rounds < 0) {
    return res.status(400).json({ error: "Ammunition issued must be a whole number" });
  }
  if (rounds > 0 && !ammoItemId) {
    return res.status(400).json({ error: "Select the ammunition stock the rounds are drawn from" });
  }

  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.category === AMMUNITION_CATEGORY) {
      return res.status(400).json({ error: "Ammunition is issued together with a weapon, not on its own" });
    }
    // A weapon under maintenance, repaired but not yet returned to
    // stock, or reported missing cannot be issued. "damaged" ->
    // "ready_for_stock" happens on a passed final inspection, and only
    // the Return to Stock step makes it "available" (see
    // maintenanceController.js); "missing" only clears via a manual
    // update, there's no automatic path back from it.
    if (["damaged", "missing", "ready_for_stock"].includes(item.status)) {
      return res.status(400).json({
        error:
          item.status === "ready_for_stock"
            ? "This weapon has passed maintenance but hasn't been returned to stock yet"
            : "This item is unavailable (under maintenance or reported missing) and cannot be issued",
      });
    }
    if (item.quantity < quantity) {
      return res.status(400).json({ error: "Not enough stock available to issue" });
    }

    // Accessories arrive as a list of ticked items; only ones that belong
    // with this weapon type are accepted. Stored as one readable string.
    const accessoryList = Array.isArray(accessories)
      ? accessories
      : (accessories || "").split(",").map((a) => a.trim()).filter(Boolean);
    const allowedAccessories = accessoriesForType(item.itemName);
    const unknownAccessory = accessoryList.find((a) => !allowedAccessories.includes(a));
    if (unknownAccessory) {
      return res.status(400).json({ error: `"${unknownAccessory}" isn't an accessory for a ${item.itemName}` });
    }

    const ineligible = await checkIssueEligibility(officerId, item);
    if (ineligible) return res.status(400).json({ error: ineligible });

    let ammoItem = null;
    if (rounds > 0) {
      ammoItem = await Inventory.findOne({ _id: ammoItemId, stationId: req.user.stationId });
      if (!ammoItem || ammoItem.category !== AMMUNITION_CATEGORY) {
        return res.status(400).json({ error: "Selected ammunition stock not found" });
      }
      if (["damaged", "missing"].includes(ammoItem.status)) {
        return res.status(400).json({ error: "That ammunition batch is unavailable" });
      }
      if (ammoItem.quantity < rounds) {
        return res.status(400).json({ error: `Only ${ammoItem.quantity} round(s) left in ${ammoItem.itemId}` });
      }
    }

    item.quantity -= quantity;
    item.status = item.quantity === 0 ? "issued" : item.status;
    item.assignedTo = officerId;
    item.lastUpdatedBy = req.user.uid;
    await item.save();

    // Rounds leave the armory at the same moment as the weapon, same
    // reasoning as the weapon's own stock update above.
    if (ammoItem) {
      ammoItem.quantity -= rounds;
      ammoItem.lastUpdatedBy = req.user.uid;
      await ammoItem.save();
      await syncLowStockAlert(ammoItem);
    }

    // Always the real moment the weapon (and its rounds) left the armory —
    // stamped by the server, never taken from the form, so it can't be
    // back- or forward-dated.
    const issueDateTime = new Date();
    // A weapon is only meant to stay out for 24 hours by default — the
    // Inventory Officer can still set a longer/shorter explicit
    // deadline on the Issue form for a specific deployment, but leaving
    // it blank no longer means "never goes overdue" (see
    // InventoryTransaction.js's expectedReturnDate comment). Whichever
    // value ends up here is what scanForTimeBasedAlerts in
    // alertsController.js checks to fire "Return Overdue".
    const resolvedExpectedReturn = expectedReturnDate
      ? new Date(expectedReturnDate)
      : new Date(issueDateTime.getTime() + 24 * 60 * 60 * 1000);

    const transaction = await InventoryTransaction.create({
      itemId: item._id,
      officerId,
      processedBy: req.user.uid,
      type: "issue",
      dutyType,
      quantity,
      dateTime: issueDateTime,
      expectedReturnDate: resolvedExpectedReturn,
      ammoIssued: rounds > 0 ? rounds : null,
      ammoItemId: ammoItem ? ammoItem._id : null,
      accessories: accessoryList.join(", "),
      confirmationStatus: "pending",
      stationId: req.user.stationId,
    });

    await generateAlert({
      alertType: "weapon_issued",
      title: "Weapon Successfully Issued",
      message: `${item.itemId} issued${rounds > 0 ? ` with ${rounds} round(s)` : ""}, pending the officer's receipt confirmation.`,
      itemId: item._id,
      transactionId: transaction._id,
      recipientId: officerId,
      stationId: req.user.stationId,
    });

    const officer = await User.findById(officerId).select("fullName");
    logAuditForActor(req, {
      action: `Issued ${item.itemId} (${item.itemName})${ammoItem ? ` + ${rounds} × ${ammoItem.itemName}` : ""} to ${officer?.fullName || "an officer"}`,
      module: "Inventory",
    });

    return res.status(201).json(transaction.toJSON());
  } catch (err) {
    console.error("issue inventory error:", err);
    return res.status(500).json({ error: "Could not process issue transaction" });
  }
}

// POST /api/inventory/:id/return — inventory_officer
// Workflow step 3.1-3.4 (physical verification + accessories +
// ammunition count + submit): the Inventory Officer records what they
// observed. This deliberately does NOT touch stock — see
// confirmTransaction, which applies it once the returning officer
// confirms. Ammunition: issued (from the open issue record), counted
// returned, and the officer's declared rounds fired; used = issued -
// returned, and any gap between used and declared is the discrepancy.
async function returnItem(req, res) {
  const {
    officerId,
    condition,
    remarks,
    dateTime,
    ammoReturned,
    ammoDeclaredUsed,
    accessoriesComplete,
    accessoriesRemarks,
  } = req.body;

  if (!officerId || !condition) {
    return res.status(400).json({ error: "Officer ID and condition are required" });
  }
  // The reason becomes the maintenance record's issue description once
  // the officer confirms (see confirmTransaction), so it's mandatory.
  if (condition.toLowerCase() === "faulty" && !remarks?.trim()) {
    return res.status(400).json({ error: "Give the reason the weapon is faulty" });
  }

  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    // The officer's open issue for this weapon — its recorded rounds and
    // ammo stock line win over whatever the form sent, so the count
    // can't be quietly re-typed at return time.
    const outstanding = await getOutstandingIssues(officerId);
    const open = outstanding.find((e) => String(e.item._id) === String(item._id));
    if (!open) {
      return res.status(400).json({ error: "This officer has no open issue for this item" });
    }
    const sourceIssue = open.lastIssue;
    // Everything the officer holds of this item comes back together —
    // normally 1, but covers older multi-unit issues too.
    const quantity = open.net;

    // The rounds issued are fixed at issue time: always read from the
    // issue record, never from the form. No rounds issued -> none can be
    // counted back or declared used on the return either.
    const issuedRounds = hasValue(sourceIssue?.ammoIssued) && sourceIssue.ammoIssued > 0 ? sourceIssue.ammoIssued : null;
    const returnedRounds = hasValue(ammoReturned) ? Number(ammoReturned) : null;
    const declaredUsed = hasValue(ammoDeclaredUsed) ? Number(ammoDeclaredUsed) : null;
    if (issuedRounds === null && ((returnedRounds ?? 0) > 0 || (declaredUsed ?? 0) > 0)) {
      return res.status(400).json({ error: "No ammunition was issued with this weapon" });
    }

    if (issuedRounds !== null && issuedRounds > 0 && (returnedRounds === null || declaredUsed === null)) {
      return res.status(400).json({ error: "Count the returned rounds and record the rounds the officer declares used" });
    }
    if ([returnedRounds, declaredUsed].some((n) => n !== null && (!Number.isInteger(n) || n < 0))) {
      return res.status(400).json({ error: "Ammunition counts must be whole numbers" });
    }
    if (issuedRounds !== null && returnedRounds !== null && returnedRounds > issuedRounds) {
      return res.status(400).json({ error: "Ammunition returned cannot exceed ammunition issued" });
    }
    if (issuedRounds !== null && declaredUsed !== null && declaredUsed > issuedRounds) {
      return res.status(400).json({ error: "Rounds declared used cannot exceed ammunition issued" });
    }

    const ammoUsed = issuedRounds !== null && returnedRounds !== null ? issuedRounds - returnedRounds : null;
    const ammoDiscrepancy = ammoUsed !== null && declaredUsed !== null ? ammoUsed - declaredUsed : null;
    const accessoriesAllBack =
      accessoriesComplete === undefined || accessoriesComplete === null || accessoriesComplete === ""
        ? null
        : accessoriesComplete === true || accessoriesComplete === "true";
    if (accessoriesAllBack === false && !accessoriesRemarks?.trim()) {
      return res.status(400).json({ error: "Note which accessories are missing" });
    }

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
      ammoIssued: issuedRounds,
      ammoReturned: returnedRounds,
      ammoUsed,
      ammoDeclaredUsed: declaredUsed,
      ammoDiscrepancy,
      ammoItemId: sourceIssue?.ammoItemId || null,
      accessories: sourceIssue?.accessories || "",
      accessoriesComplete: accessoriesAllBack,
      accessoriesRemarks: accessoriesRemarks?.trim() || "",
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

    const officer = await User.findById(officerId).select("fullName");
    logAuditForActor(req, {
      action: `Recorded ${transactionType === "damaged" ? "Damaged Return" : "Return"} of ${item.itemId} from ${officer?.fullName || "an officer"}${ammoUsed !== null ? ` (rounds used ${ammoUsed}, declared ${declaredUsed})` : ""}`,
      module: "Inventory",
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
      .populate("ammoItemId", "itemId itemName")
      .populate("officerId", "fullName rankAndNumber department")
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
async function getMyWeapons(req, res) {
  try {
    const officerId = req.user.uid;

    // Pull a bit more than we'll show, then filter to weapons-only (every
    // WEAPON_CATEGORIES entry — ammunition excluded)
    // client-side of the query (category lives on the populated item,
    // not the transaction itself) before trimming to the display limit.
    const recentTx = await InventoryTransaction.find({ officerId })
      .sort({ dateTime: -1 })
      .limit(50)
      .populate("itemId", "itemId itemName category")
      .populate("ammoItemId", "itemId itemName")
      .populate("processedBy", "fullName rankAndNumber");

    const firearmsTx = recentTx.filter((tx) => WEAPON_CATEGORIES.includes(tx.itemId?.category));
    const history = firearmsTx.slice(0, 20);

    // Any transaction (issue OR return/damaged) naming this officer that
    // they haven't yet confirmed — surfaced separately (and first) on
    // the My Weapons page as an action item, not just another history
    // row. See confirmTransaction for what confirming each type does.
    const pendingConfirmation = firearmsTx.filter((tx) => tx.confirmationStatus === "pending");

    // "Currently assigned" is netted from this officer's OWN issue vs.
    // confirmed-return/damaged transaction history — NOT the shared
    // Inventory line's own status/assignedTo fields (the old approach).
    // Those only ever reflect the single most-recent officer, and
    // status only flips to "issued" once a line's whole stock count is
    // fully depleted to 0 (see issue()), so any line stocked above 1
    // unit never showed up here at all, even while this officer
    // genuinely holds one of its units — see Inventory.jsx's
    // getOutstandingItemIds, which hit the exact same bug in the
    // Return form's weapon picker. A return/damaged transaction only
    // counts against the balance once CONFIRMED (matching
    // confirmTransaction's own "a return actually applies the stock
    // update" timing) — a return the officer hasn't personally
    // confirmed yet shouldn't already stop showing the weapon as
    // theirs, since they're still formally accountable for it until
    // they do.
    //
    // Run over this officer's FULL firearms transaction history, not
    // just the capped `recentTx` above — an old still-outstanding issue
    // could otherwise fall off the 50-row cap once enough other
    // transactions (any category) pile up, and wrongly disappear from
    // "assigned" even though it was never actually returned.
    const allFirearmsTx = await InventoryTransaction.find({ officerId })
      .populate("itemId", "itemId itemName category");
    const netByItem = new Map(); // item's Mongo id -> { item, net }
    for (const tx of allFirearmsTx) {
      if (!WEAPON_CATEGORIES.includes(tx.itemId?.category)) continue;
      const key = tx.itemId._id.toString();
      const entry = netByItem.get(key) || { item: tx.itemId, net: 0 };
      if (tx.type === "issue") entry.net += tx.quantity || 1;
      else if (tx.confirmationStatus === "secured") entry.net -= tx.quantity || 1;
      netByItem.set(key, entry);
    }
    const assignedItemIds = [...netByItem.values()].filter((e) => e.net > 0).map((e) => e.item._id);
    const assigned = assignedItemIds.length
      ? await Inventory.find({ _id: { $in: assignedItemIds } }).sort({ itemName: 1 })
      : [];

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

        // Unused rounds go back into the ammunition stock they were
        // drawn from — same "only once the officer confirms" timing as
        // the weapon itself.
        if (tx.ammoItemId && tx.ammoReturned > 0) {
          const ammoItem = await Inventory.findById(tx.ammoItemId);
          if (ammoItem) {
            ammoItem.quantity += tx.ammoReturned;
            ammoItem.lastUpdatedBy = tx.processedBy || req.user.uid;
            await ammoItem.save();
            await syncLowStockAlert(ammoItem);
          }
        }

        // Used = issued - counted returned. Firing rounds on duty is
        // normal; what needs review is a gap between that and what the
        // officer declared they fired. Older records with no declared
        // figure fall back to flagging any rounds used at all.
        const unreconciled = tx.ammoDiscrepancy !== null ? tx.ammoDiscrepancy : tx.ammoUsed;
        if (unreconciled !== null && unreconciled !== 0) {
          await generateAlert({
            alertType: "ammo_discrepancy",
            title: "Ammunition Discrepancy",
            message:
              tx.ammoDiscrepancy !== null
                ? `${item.itemId}: issued ${tx.ammoIssued}, counted back ${tx.ammoReturned} (${tx.ammoUsed} used) but ${tx.ammoDeclaredUsed} declared fired — ${Math.abs(tx.ammoDiscrepancy)} round(s) ${tx.ammoDiscrepancy > 0 ? "unaccounted for" : "more returned than expected"}.`
                : `${tx.ammoUsed} round(s) not accounted for on return of ${item.itemId} (issued ${tx.ammoIssued}, returned ${tx.ammoReturned}).`,
            itemId: item._id,
            transactionId: tx._id,
            recipientId: tx.officerId,
            stationId: tx.stationId,
          });
        }

        if (tx.accessoriesComplete === false) {
          await generateAlert({
            alertType: "accessories_missing",
            title: "Accessories Missing on Return",
            message: `${item.itemId}: ${tx.accessoriesRemarks || "not all accessories were returned"}.`,
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

    const confirmedItem = await Inventory.findById(tx.itemId).select("itemId");
    logAuditForActor(req, {
      action: `Confirmed ${tx.type === "issue" ? "receipt" : "return"} of ${confirmedItem?.itemId || "a weapon"}`,
      module: "Inventory",
    });

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

    logAuditForActor(req, {
      action: `Reported Missing: ${item.itemId} (${item.itemName})`,
      module: "Inventory",
    });

    return res.json(item.toJSON());
  } catch (err) {
    console.error("reportMissing error:", err);
    return res.status(500).json({ error: "Could not report this item missing" });
  }
}

module.exports = {
  list,
  create,
  update,
  restock,
  issue,
  returnItem,
  listTransactions,
  getMyWeapons,
  getStats,
  confirmTransaction,
  reportMissing,
};
