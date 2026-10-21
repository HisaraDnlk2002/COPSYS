const Inventory = require("../models/Inventory");
const { INSPECTION_INTERVAL_DAYS } = require("../models/Inventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const Maintenance = require("../models/Maintenance");
const User = require("../models/User");
const LeaveRequest = require("../models/LeaveRequest");
const { generateAlert } = require("../utils/alerts");
const { logAuditForActor } = require("../utils/auditLogger");
const {
  WEAPON_CATALOG,
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
    const items = await Inventory.find({ stationId: req.user.stationId }).sort({ createdAt: -1, _id: -1 });
    // Automatically clean up any ammunition items that accidentally have subItems
    // and ensure all weapons with quantity > 1 have unique individual subItems allocated
    for (const item of items) {
      if (item.category === AMMUNITION_CATEGORY && item.subItems && item.subItems.length > 0) {
        item.subItems = [];
        await Inventory.updateOne({ _id: item._id }, { $set: { subItems: [] } });
      } else if (item.category !== AMMUNITION_CATEGORY && item.quantity > 1) {
        if (!item.subItems || item.subItems.length === 0) {
          const padLength = item.quantity >= 100 ? 3 : 2;
          item.subItems = Array.from({ length: item.quantity }, (_, i) => ({
            subId: `${item.itemId}-${String(i + 1).padStart(padLength, "0")}`,
            status: item.status === "issued" ? "issued" : "available",
            condition: item.condition || "good",
            assignedTo: item.assignedTo || null,
          }));
          await Inventory.updateOne({ _id: item._id }, { $set: { subItems: item.subItems } });
        } else {
          // De-duplicate any subItems if needed
          const seen = new Set();
          let hasDuplicates = false;
          for (const s of item.subItems) {
            if (seen.has(s.subId)) hasDuplicates = true;
            seen.add(s.subId);
          }
          if (hasDuplicates || item.subItems.length !== item.quantity) {
            const padLength = Math.max(item.quantity, item.subItems.length) >= 100 ? 3 : 2;
            const updatedSubItems = Array.from({ length: item.quantity }, (_, idx) => {
              const existing = item.subItems[idx];
              const uniqueSubId = `${item.itemId}-${String(idx + 1).padStart(padLength, "0")}`;
              return {
                subId: uniqueSubId,
                status: existing?.status || (item.status === "issued" ? "issued" : "available"),
                condition: existing?.condition || item.condition || "good",
                assignedTo: existing?.assignedTo || item.assignedTo || null,
                lastIssuedDate: existing?.lastIssuedDate || null,
              };
            });
            item.subItems = updatedSubItems;
            await Inventory.updateOne({ _id: item._id }, { $set: { subItems: item.subItems } });
          }
        }
      }
    }
    return res.json(items.map((i) => i.toJSON()));
  } catch (err) {
    console.error("list inventory error:", err);
    return res.status(500).json({ error: "Could not load inventory" });
  }
}

// GET /api/inventory/next-item-id — duty_officer, inventory_officer, oic
// Previews the next auto-assigned weapon Item ID for the Add Item form modal
async function getNextItemId(req, res) {
  try {
    const nextItemId = await generateNextWeaponItemId();
    return res.json({ nextItemId });
  } catch (err) {
    console.error("getNextItemId error:", err);
    return res.status(500).json({ error: "Could not generate next item ID" });
  }
}

// POST /api/inventory — inventory_officer
// Weapon registration (workflow step 1): category + type (-> itemName),
// caliber, storage location, condition, optional last inspection date.
// A weapon's Item ID is assigned automatically (see
// generateNextWeaponItemId) — the officer never types one, so it can't
// collide or drift from the 5-digit format by hand. Ammunition is the
// one exception: its itemId IS a free-format batch/lot ID, still typed
// in by the inventory officer, since that's how the physical batch is
// actually labeled when it arrives.
const WEAPON_ID_PATTERN = /^\d{5}$/;

// Scans all existing item IDs and sub-unit IDs to ensure the next 5-digit
// weapon ID does not collide with ANY item ID or sub-unit ID anywhere in the DB.
async function generateNextWeaponItemId() {
  const allItems = await Inventory.find({}).select("itemId subItems.subId");
  let max = 10000;
  const usedItemIds = new Set();
  const usedSubIds = new Set();

  for (const item of allItems) {
    if (item.itemId) {
      usedItemIds.add(item.itemId);
      const match = item.itemId.match(/^(\d{5})/);
      if (match) {
        const n = Number(match[1]);
        if (n > max) max = n;
      }
    }
    if (item.subItems && Array.isArray(item.subItems)) {
      for (const s of item.subItems) {
        if (s.subId) {
          usedSubIds.add(s.subId);
          const sMatch = s.subId.match(/^(\d{5})/);
          if (sMatch) {
            const sn = Number(sMatch[1]);
            if (sn > max) max = sn;
          }
        }
      }
    }
  }

  let next = max + 1;
  while (true) {
    const candidate = String(next).padStart(5, "0");
    const collidesDirect = usedItemIds.has(candidate) || usedSubIds.has(candidate);

    let collidesPrefix = false;
    const prefix = `${candidate}-`;
    for (const id of usedItemIds) {
      if (id.startsWith(prefix)) {
        collidesPrefix = true;
        break;
      }
    }
    if (!collidesPrefix) {
      for (const sid of usedSubIds) {
        if (sid.startsWith(prefix)) {
          collidesPrefix = true;
          break;
        }
      }
    }

    if (!collidesDirect && !collidesPrefix) {
      const existsInDb = await Inventory.exists({
        $or: [
          { itemId: candidate },
          { "subItems.subId": candidate },
          { itemId: { $regex: `^${candidate}-` } },
          { "subItems.subId": { $regex: `^${candidate}-` } },
        ],
      });
      if (!existsInDb) {
        return candidate;
      }
    }
    next += 1;
  }
}

async function create(req, res) {
  const {
    itemId,
    itemName,
    category,
    quantity,
    condition,
    caliber,
    storageLocation,
    lastInspectionDate,
    lowStockThreshold,
  } = req.body;

  const isAmmunition = category === AMMUNITION_CATEGORY;
  if (!itemName || !category || quantity === undefined || (isAmmunition && !itemId)) {
    return res.status(400).json({ error: "Item ID, name, category and quantity are required" });
  }
  const resolvedQuantity = Number(quantity);
  if (!Number.isInteger(resolvedQuantity) || resolvedQuantity < 0) {
    return res.status(400).json({ error: "Quantity must be a whole number, zero or above" });
  }
  // The CATEGORY must be one of the built-in ones, but the TYPE can be
  // anything the station types in (e.g. a model that isn't in the list).
  if (![...WEAPON_CATEGORIES, AMMUNITION_CATEGORY].includes(category)) {
    return res.status(400).json({ error: "Unknown weapon category" });
  }
  const typedName = String(itemName).trim().replace(/\s+/g, " ");
  if (typedName.length < 2 || typedName.length > 60) {
    return res.status(400).json({ error: "Type name must be between 2 and 60 characters" });
  }
  // Typed the same as a built-in type (any capitalization)? Use the
  // built-in spelling so its calibers and accessories still apply.
  const catalogEntry = WEAPON_CATALOG.find((c) => c.category === category);
  const resolvedItemName =
    (catalogEntry && catalogEntry.types.find((ty) => ty.toLowerCase() === typedName.toLowerCase())) || typedName;

  // Firearms only. One possible caliber for the type -> set it here; more
  // than one -> the form must say which this particular weapon takes.
  const typeCalibers = category === "Firearms" ? calibersForType(resolvedItemName) : [];
  let resolvedCaliber = "";
  if (typeCalibers.length === 1) {
    resolvedCaliber = typeCalibers[0];
  } else if (typeCalibers.length > 1) {
    if (!typeCalibers.includes(caliber)) {
      return res.status(400).json({ error: `Select the caliber for this ${resolvedItemName} (${typeCalibers.join(" or ")})` });
    }
    resolvedCaliber = caliber;
  } else if (category === "Firearms" && caliber) {
    // A firearm type that isn't in the built-in caliber table: keep the
    // caliber that was typed in.
    resolvedCaliber = String(caliber).trim().slice(0, 30);
  }
  if (storageLocation && !STORAGE_LOCATIONS.includes(storageLocation)) {
    return res.status(400).json({ error: "Unknown storage location" });
  }

  try {
    let resolvedItemId = isAmmunition ? String(itemId).trim() : await generateNextWeaponItemId();

    // 1. Verify resolvedItemId does not exist as an itemId in any item
    const existingAsItem = await Inventory.findOne({ itemId: resolvedItemId });
    if (existingAsItem) {
      return res.status(409).json({ error: `An item with ID "${resolvedItemId}" already exists` });
    }

    // 2. Verify resolvedItemId does not exist as a subId in any item
    const existingAsSub = await Inventory.findOne({ "subItems.subId": resolvedItemId });
    if (existingAsSub) {
      return res.status(409).json({ error: `ID "${resolvedItemId}" is already in use as a sub-unit ID` });
    }

    // Allocate individual Sub IDs when quantity is more than one (e.g. 10004-01, 10004-02...)
    // Weapons only — ammunition is counted in rounds, not tracked per unit.
    const buildSubItems = (baseId) =>
      !isAmmunition && resolvedQuantity > 1
        ? Array.from({ length: resolvedQuantity }, (_, i) => ({
            subId: `${baseId}-${String(i + 1).padStart(resolvedQuantity >= 100 ? 3 : 2, "0")}`,
            status: "available",
            condition: condition || "good",
            assignedTo: null,
          }))
        : [];
    let subItems = buildSubItems(resolvedItemId);

    // Verify none of the generated subIds collide with existing itemIds or subIds
    if (subItems.length > 0) {
      const generatedSubIds = subItems.map((s) => s.subId);
      const conflictItemId = await Inventory.findOne({ itemId: { $in: generatedSubIds } }).select("itemId");
      if (conflictItemId) {
        return res.status(409).json({ error: `Generated Sub-ID "${conflictItemId.itemId}" conflicts with an existing Item ID` });
      }
      const conflictSubId = await Inventory.findOne({ "subItems.subId": { $in: generatedSubIds } }).select("subItems.subId");
      if (conflictSubId) {
        return res.status(409).json({ error: "One or more generated sub-IDs already exist in the inventory" });
      }
    }

    // A brand-new weapon goes on the periodic inspection schedule
    // immediately — counted from its last inspection if one is known,
    // otherwise from today. Ammunition isn't periodically inspected.
    const lastInspected = lastInspectionDate ? new Date(lastInspectionDate) : null;
    const scheduleFrom = lastInspected || new Date();
    const doc = {
      itemName: resolvedItemName,
      category,
      quantity: resolvedQuantity,
      condition: condition || "good",
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
    };
    // Two people adding a weapon at the same moment can be handed the same
    // next ID. The unique index rejects the second one; for a generated
    // weapon ID just take the next free number and try again.
    let item;
    for (let attempt = 0; ; attempt++) {
      try {
        item = await Inventory.create({ ...doc, itemId: resolvedItemId, subItems });
        break;
      } catch (e) {
        if (e && e.code === 11000 && !isAmmunition && attempt < 4) {
          resolvedItemId = await generateNextWeaponItemId();
          subItems = buildSubItems(resolvedItemId);
          continue;
        }
        if (e && e.code === 11000) return res.status(409).json({ error: "An item with that ID already exists" });
        throw e;
      }
    }
    await syncLowStockAlert(item);
    logAuditForActor(req, { action: `Added Inventory Item: ${item.itemId} (${item.itemName})${subItems.length > 0 ? ` with ${subItems.length} sub-units` : ""}`, module: "Inventory" });
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
  if (quantity !== undefined && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
    return res.status(400).json({ error: "Quantity must be a whole number, zero or above" });
  }

  try {
    // A weapon line's quantity IS its list of sub IDs (10004-01, -02, ...), so
    // typing a different number here would leave the count and the sub IDs
    // disagreeing. New units are added with Restock, which creates their sub
    // IDs; ammunition (counted in rounds) can still be edited freely.
    if (quantity !== undefined) {
      const current = await Inventory.findById(req.params.id).select("category quantity stationId");
      if (!current || current.stationId !== req.user.stationId) return res.status(404).json({ error: "Item not found" });
      if (current.category !== AMMUNITION_CATEGORY && Number(quantity) !== current.quantity) {
        return res.status(400).json({ error: "A weapon's quantity can't be typed in. Use Restock to add units — each gets its own sub ID" });
      }
    }
    const item = await Inventory.findByIdAndUpdate(
      req.params.id,
      {
        ...(quantity !== undefined && { quantity: Number(quantity) }),
        ...(condition && { condition }),
        ...(status && { status }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(storageLocation !== undefined && { storageLocation }),
        ...(lowStockThreshold !== undefined && {
          lowStockThreshold: lowStockThreshold === "" || lowStockThreshold === null ? null : Number(lowStockThreshold),
        }),
        lastUpdatedBy: req.user.uid,
      },
      { new: true, runValidators: true }
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

// True if any unit of this item is still out with an officer (issued, and not
// yet returned with a confirmed/legacy return). Used to refuse retro-fitting
// sub IDs onto an old weapon line while a unit is out.
async function itemHasUnitsOut(itemId) {
  const txs = await InventoryTransaction.find({ itemId, confirmationStatus: { $ne: "cancelled" } }).select("type quantity confirmationStatus");
  let net = 0;
  for (const tx of txs) {
    if (tx.type === "issue") net += tx.quantity || 1;
    else if (!["pending", "rejected"].includes(tx.confirmationStatus)) net -= tx.quantity || 1;
  }
  return net > 0;
}

// POST /api/inventory/:id/restock — inventory_officer
// Adds received stock to an existing line. For ammunition that is just more
// rounds. For a WEAPON line (e.g. more pistols of an existing type) every new
// unit gets its own sub ID continuing the existing numbering under the same
// item ID (10004-06, 10004-07, ...), so the count and the sub IDs always
// match. Recorded in the audit trail with who/when/how many.
async function restock(req, res) {
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be a whole number above zero" });
  }
  const isWeapon = (cat) => cat !== AMMUNITION_CATEGORY;

  try {
    const item = await Inventory.findOne({ _id: req.params.id, stationId: req.user.stationId });
    if (!item) return res.status(404).json({ error: "Item not found" });

    let newSubIds = [];
    if (isWeapon(item.category)) {
      if (quantity > 500) return res.status(400).json({ error: "Add at most 500 units at a time" });
      const subItems = item.subItems || [];
      const padding = (n) => String(n).padStart(2, "0");
      let next = 1;
      if (subItems.length === 0) {
        // Older single-unit line with no sub IDs yet: its existing unit(s)
        // become -01.. so the whole line is tracked per unit from now on. Not
        // possible while a unit is out, because that open issue has no sub ID.
        if (item.status !== "available" || (await itemHasUnitsOut(item._id))) {
          return res.status(409).json({
            error: "This weapon is currently out or unavailable. Wait until it is back in stock, then add more units",
          });
        }
        const existingUnits = Math.max(item.quantity, 0);
        for (let i = 1; i <= existingUnits; i++) {
          item.subItems.push({ subId: `${item.itemId}-${padding(i)}`, status: "available", condition: item.condition || "good", assignedTo: null });
        }
        next = existingUnits + 1;
      } else {
        // Continue after the highest number ever used, so a sub ID is never reused.
        for (const sub of subItems) {
          const n = Number(String(sub.subId).split("-").pop());
          if (Number.isInteger(n) && n >= next) next = n + 1;
        }
      }
      for (let i = 0; i < quantity; i++) {
        const subId = `${item.itemId}-${padding(next + i)}`;
        newSubIds.push(subId);
        item.subItems.push({ subId, status: "available", condition: "good", assignedTo: null });
      }
    }

    item.quantity += quantity;
    if (item.status === "issued" && item.quantity > 0) item.status = "available";
    item.lastUpdatedBy = req.user.uid;
    await item.save();
    await syncLowStockAlert(item);

    logAuditForActor(req, {
      action: `Restocked ${item.itemId} (${item.itemName}) +${quantity} — now ${item.quantity}${newSubIds.length ? ` [new sub IDs ${newSubIds[0]}${newSubIds.length > 1 ? ` – ${newSubIds[newSubIds.length - 1]}` : ""}]` : ""}${req.body.remarks ? ` (${req.body.remarks})` : ""}`,
      module: "Inventory",
    });
    return res.json({ ...item.toJSON(), newSubIds });
  } catch (err) {
    console.error("restock inventory error:", err);
    return res.status(500).json({ error: "Could not restock this item" });
  }
}

// Units of each item this officer still holds: issues minus
// return/damaged records the Inventory Officer has CONFIRMED. A return that
// is still awaiting inventory check (pending) or was rejected does not
// release the officer — the weapon is formally still theirs until the
// Inventory Officer has physically checked it in. Keyed by item id, with
// the most recent issue transaction kept for its expectedReturnDate.
async function getOutstandingIssues(officerId) {
  const txs = await InventoryTransaction.find({ officerId })
    .sort({ dateTime: 1 })
    .populate("itemId", "itemId itemName category");
  const byItem = new Map();
  for (const tx of txs) {
    if (!tx.itemId) continue;
    // Voided after the officer rejected it — never counts either way.
    if (tx.confirmationStatus === "cancelled") continue;
    const key = tx.itemId._id.toString();
    const entry = byItem.get(key) || { item: tx.itemId, net: 0, lastIssue: null };
    if (tx.type === "issue") {
      entry.net += tx.quantity || 1;
      entry.lastIssue = tx;
    } else if (!["pending", "rejected"].includes(tx.confirmationStatus)) {
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
  const { officerId, dutyType, expectedReturnDate, ammoIssued, ammoItemId, accessories, subId } = req.body;

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

    // Handle sub ID allocation if item has subItems
    let resolvedSubId = subId || null;
    let chosenSubItem = null;
    if (item.subItems && item.subItems.length > 0) {
      if (resolvedSubId) {
        chosenSubItem = item.subItems.find((s) => s.subId === resolvedSubId);
        if (!chosenSubItem) {
          return res.status(400).json({ error: `Sub ID ${resolvedSubId} does not belong to this item` });
        }
        if (chosenSubItem.status !== "available") {
          return res.status(400).json({ error: `Unit ${resolvedSubId} is currently ${chosenSubItem.status} and cannot be issued` });
        }
      } else {
        chosenSubItem = item.subItems.find((s) => s.status === "available");
        if (chosenSubItem) resolvedSubId = chosenSubItem.subId;
      }
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

    const issueDateTime = new Date();
    item.quantity -= quantity;
    item.status = item.quantity === 0 ? "issued" : item.status;
    item.assignedTo = officerId;
    if (chosenSubItem) {
      chosenSubItem.status = "issued";
      chosenSubItem.assignedTo = officerId;
      chosenSubItem.lastIssuedDate = issueDateTime;
    }
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
      subId: resolvedSubId,
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
      message: `${item.itemId}${resolvedSubId ? ` (${resolvedSubId})` : ""} issued${rounds > 0 ? ` with ${rounds} round(s)` : ""}, pending the officer's receipt confirmation.`,
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

// POST /api/inventory/my-weapons/return — the OFFICER holding the weapon
// (any operational role). They report the return from their My Weapons
// page: condition (Good/Faulty, reason required if Faulty), rounds handed
// back and rounds fired (only when the weapon was issued with ammunition),
// and whether every accessory came back (note required if not).
//
// This deliberately changes NOTHING in stock. It creates a return/damaged
// record in confirmationStatus "pending" ("Awaiting inventory check"); the
// stock update only happens when the Inventory Officer physically checks
// the weapon and confirms it (confirmTransaction). One open report per
// weapon: while one is pending the officer can't submit another; if the
// Inventory Officer rejected it, submitting again REPLACES that record
// (same document, reset to pending) rather than creating a second one.
async function submitMyReturn(req, res) {
  const { itemId, subId, condition, remarks, ammoReturned, ammoDeclaredUsed, accessoriesComplete, accessoriesRemarks } =
    req.body;
  const officerId = req.user.uid;

  if (["admin", "oic"].includes(req.user.role)) {
    return res.status(403).json({ error: "Your role does not hold weapons" });
  }
  if (!itemId) return res.status(400).json({ error: "Choose the weapon you are returning" });

  const conditionNorm = typeof condition === "string" ? condition.trim().toLowerCase() : "";
  if (!["good", "faulty"].includes(conditionNorm)) {
    return res.status(400).json({ error: "Condition must be Good or Faulty" });
  }
  const isFaulty = conditionNorm === "faulty";
  const faultReason = typeof remarks === "string" ? remarks.trim() : "";
  // The reason becomes the maintenance record's issue description once the
  // Inventory Officer confirms (see confirmTransaction), so it's mandatory.
  if (isFaulty && !faultReason) {
    return res.status(400).json({ error: "Give the reason the weapon is faulty" });
  }

  if (accessoriesComplete !== true && accessoriesComplete !== false && accessoriesComplete !== "true" && accessoriesComplete !== "false") {
    return res.status(400).json({ error: "Say whether all accessories were returned" });
  }
  const accessoriesAllBack = accessoriesComplete === true || accessoriesComplete === "true";
  const accessoriesNote = typeof accessoriesRemarks === "string" ? accessoriesRemarks.trim() : "";
  if (!accessoriesAllBack && !accessoriesNote) {
    return res.status(400).json({ error: "Note which accessories are missing" });
  }

  try {
    const item = await Inventory.findById(itemId);
    if (!item || item.stationId !== req.user.stationId) return res.status(404).json({ error: "Item not found" });

    // The weapon must actually be in this officer's custody. Its issue
    // record fixes the sub ID, the rounds issued and the ammo stock line —
    // none of which the officer can re-type here.
    const outstanding = await getOutstandingIssues(officerId);
    const open = outstanding.find((e) => String(e.item._id) === String(item._id));
    if (!open) return res.status(400).json({ error: "This weapon is not in your custody" });
    const sourceIssue = open.lastIssue;
    const resolvedSubId = sourceIssue?.subId || null;
    if (subId && resolvedSubId && subId !== resolvedSubId) {
      return res.status(400).json({ error: "That sub ID is not the one issued to you" });
    }

    const existing = await InventoryTransaction.findOne({
      officerId,
      itemId: item._id,
      subId: resolvedSubId,
      type: { $in: ["return", "damaged"] },
      confirmationStatus: { $in: ["pending", "rejected"] },
      dateTime: { $gte: sourceIssue?.dateTime || new Date(0) },
    }).sort({ dateTime: -1 });
    if (existing?.confirmationStatus === "pending") {
      return res.status(409).json({ error: "Awaiting inventory check — you have already submitted a return for this weapon" });
    }

    const issuedRounds = hasValue(sourceIssue?.ammoIssued) && sourceIssue.ammoIssued > 0 ? sourceIssue.ammoIssued : null;
    const returnedRounds = hasValue(ammoReturned) ? Number(ammoReturned) : null;
    const declaredUsed = hasValue(ammoDeclaredUsed) ? Number(ammoDeclaredUsed) : null;
    if (issuedRounds === null && ((returnedRounds ?? 0) > 0 || (declaredUsed ?? 0) > 0)) {
      return res.status(400).json({ error: "No ammunition was issued with this weapon" });
    }
    if (issuedRounds !== null && (returnedRounds === null || declaredUsed === null)) {
      return res.status(400).json({ error: "Enter the rounds you are handing back and the rounds you fired" });
    }
    if ([returnedRounds, declaredUsed].some((n) => n !== null && (!Number.isInteger(n) || n < 0))) {
      return res.status(400).json({ error: "Ammunition counts must be whole numbers" });
    }
    if (issuedRounds !== null && returnedRounds > issuedRounds) {
      return res.status(400).json({ error: "Rounds returned cannot exceed rounds issued" });
    }
    if (issuedRounds !== null && declaredUsed > issuedRounds) {
      return res.status(400).json({ error: "Rounds fired cannot exceed rounds issued" });
    }

    const ammoUsed = issuedRounds !== null ? issuedRounds - returnedRounds : null;
    const ammoDiscrepancy = ammoUsed !== null ? ammoUsed - declaredUsed : null;

    const fields = {
      type: isFaulty ? "damaged" : "return",
      dutyType: sourceIssue?.dutyType || "",
      quantity: open.net,
      dateTime: new Date(),
      condition: isFaulty ? "Faulty" : "Good",
      remarks: isFaulty ? faultReason.slice(0, 500) : null,
      ammoIssued: issuedRounds,
      ammoReturned: issuedRounds !== null ? returnedRounds : null,
      ammoUsed,
      ammoDeclaredUsed: issuedRounds !== null ? declaredUsed : null,
      ammoDiscrepancy,
      ammoItemId: sourceIssue?.ammoItemId || null,
      accessories: sourceIssue?.accessories || "",
      accessoriesComplete: accessoriesAllBack,
      accessoriesRemarks: accessoriesAllBack ? "" : accessoriesNote.slice(0, 500),
      confirmationStatus: "pending",
      confirmedAt: null,
      confirmationRemarks: null,
      confirmationReminderGenerated: false,
      rejectionReason: null,
      rejectedAt: null,
      processedBy: null, // set to the Inventory Officer who checks it
      reviewedBy: null,
      reviewedAt: null,
    };

    let transaction;
    let resubmitted = false;
    if (existing) {
      // Rejected earlier — the correction replaces it.
      resubmitted = true;
      existing.set(fields);
      existing.resubmitCount = (existing.resubmitCount || 0) + 1;
      transaction = await existing.save();
    } else {
      transaction = await InventoryTransaction.create({
        ...fields,
        itemId: item._id,
        subId: resolvedSubId,
        officerId,
        initiatedBy: "officer",
        stationId: req.user.stationId,
      });
    }

    const officer = await User.findById(officerId).select("fullName rankAndNumber");
    const unitLabel = `${item.itemId}${resolvedSubId ? ` (${resolvedSubId})` : ""}`;
    await generateAlert({
      alertType: "return_awaiting_confirmation",
      title: resubmitted ? "Corrected Weapon Return Awaiting Your Check" : "Weapon Return Awaiting Your Check",
      message: `${officer?.fullName || "An officer"} reports ${unitLabel} returned${isFaulty ? " as FAULTY" : ""}. Check the weapon and confirm or reject it in Return Records.`,
      itemId: item._id,
      transactionId: transaction._id,
      recipientId: null, // armory-side: shows for the Inventory Officer
      stationId: req.user.stationId,
    });

    logAuditForActor(req, {
      action: `${resubmitted ? "Resubmitted" : "Submitted"} return of ${unitLabel}${isFaulty ? " (faulty)" : ""} — awaiting inventory check`,
      module: "Inventory",
    });

    return res.status(201).json(transaction.toJSON());
  } catch (err) {
    console.error("submitMyReturn error:", err);
    return res.status(500).json({ error: "Could not submit your return" });
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
      .sort({ dateTime: -1, createdAt: -1, _id: -1 })
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
    // Only ISSUES are confirmed by the officer. A return/damaged report that
    // is "pending" is waiting on the Inventory Officer instead, so it is not
    // an action item for the officer — it shows as "Awaiting inventory check".
    const pendingConfirmation = firearmsTx.filter((tx) => tx.confirmationStatus === "pending" && tx.type === "issue");

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
      .sort({ dateTime: 1 })
      .populate("itemId", "itemId itemName category")
      .populate("ammoItemId", "itemId itemName");
    const netByItem = new Map(); // item's Mongo id -> { item, net }
    for (const tx of allFirearmsTx) {
      if (!WEAPON_CATEGORIES.includes(tx.itemId?.category)) continue;
      if (tx.confirmationStatus === "cancelled") continue;
      const key = tx.itemId._id.toString();
      const entry = netByItem.get(key) || { item: tx.itemId, net: 0 };
      if (tx.type === "issue") entry.net += tx.quantity || 1;
      else if (tx.confirmationStatus === "secured") entry.net -= tx.quantity || 1;
      netByItem.set(key, entry);
    }
    const assignedItemIds = [...netByItem.values()].filter((e) => e.net > 0).map((e) => e.item._id);
    const assigned = assignedItemIds.length
      ? await Inventory.find({ _id: { $in: assignedItemIds } }).sort({ createdAt: -1, _id: -1 })
      : [];

    // One row per physical weapon in custody (so a unit shows by its exact
    // sub ID, e.g. 10016-02), with the state of any return report for it.
    // Walk the history oldest-first: every issue opens a holding; only a
    // CONFIRMED return/damaged record closes one (matching on sub ID).
    const liveTx = allFirearmsTx.filter((tx) => WEAPON_CATEGORIES.includes(tx.itemId?.category) && tx.confirmationStatus !== "cancelled");
    const sameItem = (a, b) => String(a.itemId._id) === String(b.itemId._id);
    const sameUnit = (a, b) => sameItem(a, b) && (a.subId || null) === (b.subId || null);
    const lastIndexWhere = (arr, fn) => {
      for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i;
      return -1;
    };
    const openIssues = [];
    for (const tx of liveTx) {
      if (tx.type === "issue") {
        openIssues.push(tx);
      } else if (!["pending", "rejected"].includes(tx.confirmationStatus)) {
        let idx = lastIndexWhere(openIssues, (o) => sameUnit(o, tx));
        if (idx === -1) idx = lastIndexWhere(openIssues, (o) => sameItem(o, tx));
        if (idx !== -1) openIssues.splice(idx, 1);
      }
    }
    const holdingItems = openIssues.length
      ? await Inventory.find({ _id: { $in: openIssues.map((o) => o.itemId._id) } })
      : [];
    const holdings = openIssues.map((issueTx) => {
      const item = holdingItems.find((i) => String(i._id) === String(issueTx.itemId._id));
      const sub = issueTx.subId && item ? item.subItems.find((s) => s.subId === issueTx.subId) : null;
      const returnTx = liveTx
        .filter(
          (tx) =>
            tx.type !== "issue" &&
            ["pending", "rejected"].includes(tx.confirmationStatus) &&
            sameUnit(tx, issueTx) &&
            tx.dateTime >= issueTx.dateTime
        )
        .pop();
      return {
        itemId: issueTx.itemId._id.toString(),
        itemCode: issueTx.itemId.itemId,
        itemName: issueTx.itemId.itemName,
        category: issueTx.itemId.category,
        subId: issueTx.subId || null,
        quantity: issueTx.quantity || 1,
        condition: sub?.condition || item?.condition || "good",
        issuedAt: issueTx.dateTime,
        dutyType: issueTx.dutyType || "",
        expectedReturnDate: issueTx.expectedReturnDate || null,
        ammoIssued: issueTx.ammoIssued > 0 ? issueTx.ammoIssued : null,
        ammoItemName: issueTx.ammoItemId?.itemName || "",
        accessories: issueTx.accessories || "",
        returnStatus: returnTx ? returnTx.confirmationStatus : null, // null | "pending" | "rejected"
        returnTx: returnTx ? returnTx.toJSON() : null,
      };
    });

    return res.json({
      assigned: assigned.map((i) => i.toJSON()),
      holdings,
      history: history.map((tx) => tx.toJSON()),
      pendingConfirmation: pendingConfirmation.map((tx) => tx.toJSON()),
    });
  } catch (err) {
    console.error("getMyWeapons error:", err);
    return res.status(500).json({ error: "Could not load your weapon custody" });
  }
}

// PATCH /api/inventory/transactions/:id/confirm — the only place
// confirmationStatus can move from "pending" to "secured". Who may call it
// depends on the type, and in both cases it can never be the person who
// is on the other side of the handover:
//   - issue: the officer named on it ONLY (they acknowledge receiving the
//     weapon). Stock/status already updated at issue time (see issue()),
//     so confirming only records the acknowledgment.
//   - return / damaged: an INVENTORY OFFICER ONLY, and never the officer
//     who is returning it. The Inventory Officer is the one physically
//     holding the weapon after the handover, so they check it against the
//     officer's report (condition, rounds, accessories) and confirm. THIS
//     is what applies the stock update (quantity restored, status ->
//     available/damaged, unused rounds back to ammo stock, a Maintenance
//     record for a faulty weapon) — deliberately deferred until now rather
//     than at submission (see submitMyReturn).
async function confirmTransaction(req, res) {
  try {
    const tx = await InventoryTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    if (!["issue", "return", "damaged"].includes(tx.type)) {
      return res.status(400).json({ error: "This transaction type cannot be confirmed" });
    }
    const returnLike = tx.type === "return" || tx.type === "damaged";
    if (returnLike) {
      // The Inventory Officer is the one physically holding the weapon at
      // this point, so only they can confirm a return — never the officer
      // who is returning it (even if that officer is also an Inventory
      // Officer: someone else has to check their return).
      if (req.user.role !== "inventory_officer" || tx.stationId !== req.user.stationId) {
        return res.status(403).json({ error: "Only the Inventory Officer can confirm a return" });
      }
      if (String(tx.officerId) === String(req.user.uid)) {
        return res.status(403).json({ error: "You cannot confirm your own return — another Inventory Officer must check it" });
      }
    } else if (String(tx.officerId) !== String(req.user.uid)) {
      return res.status(403).json({ error: "Only the officer on this transaction can confirm it" });
    }
    if (tx.confirmationStatus === "secured") {
      return res.status(400).json({ error: "This transaction has already been confirmed" });
    }
    if (tx.confirmationStatus === "rejected") {
      return res.status(400).json({
        error: returnLike
          ? "This return was rejected. The officer must correct it and resubmit"
          : "You rejected this transaction. It is waiting for the Inventory Officer's review",
      });
    }
    if (tx.confirmationStatus === "cancelled") {
      return res.status(400).json({ error: "This transaction was cancelled" });
    }

    if (tx.type === "return" || tx.type === "damaged") {
      const item = await Inventory.findById(tx.itemId);
      if (item) {
        item.quantity += tx.quantity;
        item.status = tx.type === "damaged" ? "damaged" : "available";
        item.condition = tx.condition;
        item.assignedTo = null; // nobody's assigned to stock that's back in the armory
        item.lastUpdatedBy = returnLike ? req.user.uid : tx.processedBy || req.user.uid;

        // If transaction has a specific subId, update that subItem's status and condition
        if (tx.subId && item.subItems && item.subItems.length > 0) {
          const sub = item.subItems.find((s) => s.subId === tx.subId);
          if (sub) {
            sub.status = tx.type === "damaged" ? "damaged" : "available";
            sub.condition = tx.condition || "good";
            sub.assignedTo = null;
          }
        }
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
            subId: tx.subId || null,
            issueDescription: `${tx.remarks || "Reported damaged on return"}${tx.subId ? ` (Unit: ${tx.subId})` : ""}`,
            reportedBy: tx.officerId, // the officer who reported the fault
            reportedDate: new Date(),
            sourceTransactionId: tx._id,
            stationId: tx.stationId,
          });

          await generateAlert({
            alertType: "weapon_damage",
            title: "Serious Weapon Damage",
            message: `${item.itemId} return confirmed and secured. It was reported faulty, so a maintenance record has been opened.`,
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
            ammoItem.lastUpdatedBy = returnLike ? req.user.uid : tx.processedBy || req.user.uid;
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
    if (returnLike) tx.processedBy = req.user.uid; // the Inventory Officer who checked it in
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

// PATCH /api/inventory/transactions/:id/reject — same who-may-call rule as
// confirmTransaction (issue: the officer named on it; return/damaged: an
// Inventory Officer, never on their own return). The alternative to
// confirming when something's wrong (issue: didn't receive it, wrong
// weapon; return: what the officer reported doesn't match the weapon). A reason is required so the Inventory Officer
// knows what to check. Rejecting changes NO stock or custody by itself —
// it just stops the transaction being confirmable and raises an alert for
// the Inventory Officer, who decides what happens next (reviewTransaction).
async function rejectTransaction(req, res) {
  try {
    const reason = typeof req.body.remarks === "string" ? req.body.remarks.trim() : "";
    if (reason.length < 3) {
      return res.status(400).json({ error: "Please give a reason for rejecting this" });
    }

    const tx = await InventoryTransaction.findById(req.params.id).populate("itemId", "itemId itemName");
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    if (!["issue", "return", "damaged"].includes(tx.type)) {
      return res.status(400).json({ error: "This transaction type cannot be rejected" });
    }
    const returnLike = tx.type === "return" || tx.type === "damaged";
    if (returnLike) {
      // Same rule as confirming a return: only an Inventory Officer, and
      // never on their own return.
      if (req.user.role !== "inventory_officer" || tx.stationId !== req.user.stationId) {
        return res.status(403).json({ error: "Only the Inventory Officer can reject a return" });
      }
      if (String(tx.officerId) === String(req.user.uid)) {
        return res.status(403).json({ error: "You cannot reject your own return — another Inventory Officer must check it" });
      }
    } else if (String(tx.officerId) !== String(req.user.uid)) {
      return res.status(403).json({ error: "Only the officer on this transaction can reject it" });
    }
    if (tx.confirmationStatus !== "pending") {
      return res.status(400).json({ error: "Only a transaction that is waiting for confirmation can be rejected" });
    }

    tx.confirmationStatus = "rejected";
    tx.rejectionReason = reason.slice(0, 500);
    tx.rejectedAt = new Date();
    if (returnLike) tx.processedBy = req.user.uid; // the Inventory Officer who checked and rejected it
    await tx.save();

    const what = tx.type === "issue" ? "issue" : "return";

    if (returnLike) {
      // Tell the officer straight away (live push via generateAlert), with
      // the reason. Nothing in stock changes; the weapon stays in their
      // custody until they correct the report and resubmit it.
      await generateAlert({
        alertType: "confirmation_rejected",
        title: "Weapon Return Rejected — Please Correct",
        message: `Your return of ${tx.itemId?.itemId || "a weapon"}${tx.subId ? ` (${tx.subId})` : ""} was rejected by the Inventory Officer: "${tx.rejectionReason}". Correct it on My Weapons and resubmit.`,
        itemId: tx.itemId?._id || null,
        transactionId: tx._id,
        recipientId: tx.officerId,
        stationId: tx.stationId,
      });
      logAuditForActor(req, {
        action: `Rejected return of ${tx.itemId?.itemId || "a weapon"}${tx.subId ? ` (${tx.subId})` : ""}: ${tx.rejectionReason}`,
        module: "Inventory",
      });
      return res.json({ id: tx._id.toString(), confirmationStatus: "rejected" });
    }

    const officer = await User.findById(tx.officerId).select("fullName");
    await generateAlert({
      alertType: "confirmation_rejected",
      title: tx.type === "issue" ? "Weapon Issue Rejected by Officer" : "Weapon Return Rejected by Officer",
      message: `${officer?.fullName || "The officer"} rejected the ${what} of ${tx.itemId?.itemId || "a weapon"}: "${tx.rejectionReason}". Review it in the Inventory records.`,
      itemId: tx.itemId?._id || null,
      transactionId: tx._id,
      recipientId: null, // armory-side: shows for the Inventory Officer, Duty Officer and OIC
      stationId: tx.stationId,
    });

    logAuditForActor(req, {
      action: `Rejected ${what} of ${tx.itemId?.itemId || "a weapon"}: ${tx.rejectionReason}`,
      module: "Inventory",
    });

    return res.json({ id: tx._id.toString(), confirmationStatus: "rejected" });
  } catch (err) {
    console.error("rejectTransaction error:", err);
    return res.status(500).json({ error: "Could not reject this transaction" });
  }
}

// PATCH /api/inventory/transactions/:id/review — inventory_officer only.
// Resolves a transaction the officer rejected:
//   - resend: back to "pending" so the officer can confirm (or reject) it
//     again — e.g. the officer was mistaken, or the record was corrected.
//   - cancel: voids it. For an ISSUE that undoes what issue() did (the
//     weapon, and any rounds drawn with it, go back into stock and the
//     officer no longer holds it). A return/damaged only applies stock
//     when confirmed, so cancelling one just voids the record and the
//     weapon stays with the officer.
async function reviewTransaction(req, res) {
  try {
    const { action } = req.body;
    if (!["resend", "cancel"].includes(action)) {
      return res.status(400).json({ error: "Action must be resend or cancel" });
    }

    const tx = await InventoryTransaction.findById(req.params.id).populate("itemId", "itemId itemName");
    if (!tx || tx.stationId !== req.user.stationId) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    if (tx.confirmationStatus !== "rejected") {
      return res.status(400).json({ error: "Only a rejected transaction can be reviewed" });
    }
    if (tx.type !== "issue") {
      // A rejected return goes back to the officer, who corrects and
      // resubmits it (submitMyReturn replaces this record).
      return res.status(400).json({ error: "A rejected return is corrected and resubmitted by the officer" });
    }

    const itemLabel = tx.itemId?.itemId || "a weapon";

    if (action === "resend") {
      tx.confirmationStatus = "pending";
      tx.confirmationReminderGenerated = false; // let the overdue reminder fire again
    } else {
      if (tx.type === "issue") {
        const laterReturn = await InventoryTransaction.exists({
          itemId: tx.itemId?._id,
          officerId: tx.officerId,
          type: { $in: ["return", "damaged"] },
          confirmationStatus: { $ne: "cancelled" },
          dateTime: { $gte: tx.dateTime },
        });
        if (laterReturn) {
          return res.status(400).json({
            error: "A return was recorded for this weapon after this issue. Cancel that return first.",
          });
        }

        const item = await Inventory.findById(tx.itemId?._id);
        if (item) {
          item.quantity += tx.quantity || 1;
          if (item.status === "issued") item.status = "available";
          if (String(item.assignedTo) === String(tx.officerId)) item.assignedTo = null;
          if (tx.subId && item.subItems && item.subItems.length > 0) {
            const sub = item.subItems.find((s) => s.subId === tx.subId);
            if (sub) {
              sub.status = "available";
              sub.assignedTo = null;
            }
          }
          item.lastUpdatedBy = req.user.uid;
          await item.save();
        }
        if (tx.ammoItemId && tx.ammoIssued > 0) {
          const ammoItem = await Inventory.findById(tx.ammoItemId);
          if (ammoItem) {
            ammoItem.quantity += tx.ammoIssued;
            ammoItem.lastUpdatedBy = req.user.uid;
            await ammoItem.save();
            await syncLowStockAlert(ammoItem);
          }
        }
      }
      tx.confirmationStatus = "cancelled";
    }

    tx.reviewedBy = req.user.uid;
    tx.reviewedAt = new Date();
    await tx.save();

    logAuditForActor(req, {
      action: `${action === "resend" ? "Sent back for confirmation" : "Cancelled"} rejected ${tx.type} of ${itemLabel}`,
      module: "Inventory",
    });

    return res.json({ id: tx._id.toString(), confirmationStatus: tx.confirmationStatus });
  } catch (err) {
    console.error("reviewTransaction error:", err);
    return res.status(500).json({ error: "Could not review this transaction" });
  }
}

module.exports = {
  list,
  create,
  update,
  restock,
  issue,
  submitMyReturn,
  listTransactions,
  getMyWeapons,
  getStats,
  getNextItemId,
  confirmTransaction,
  rejectTransaction,
  reviewTransaction,
  reportMissing,
};