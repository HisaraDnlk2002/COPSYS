// Startup check that every Inventory item has its own unique Item ID.
//
// The schema declares itemId unique, but MongoDB only builds a unique index
// if the collection has no duplicates at that moment. If duplicates already
// existed (e.g. data from before IDs were auto-generated), the index build
// fails silently and nothing stops new duplicates afterwards. This runs once
// at boot: it reports any duplicates loudly and, once there are none, makes
// sure the unique index really exists.
//
// It never edits data. To renumber existing duplicates, run
//   node fix-duplicate-item-ids.js          (dry run — shows what it would do)
//   node fix-duplicate-item-ids.js --apply  (does it)

const Inventory = require("../models/Inventory");

async function findDuplicateItemIds() {
  return Inventory.aggregate([
    { $group: { _id: "$itemId", count: { $sum: 1 }, names: { $addToSet: "$itemName" } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ]);
}

async function ensureInventoryIdIntegrity() {
  try {
    const dupes = await findDuplicateItemIds();
    if (dupes.length > 0) {
      console.error("\n⚠️  DUPLICATE INVENTORY ITEM IDs FOUND — the unique index on itemId cannot be built until fixed:");
      for (const d of dupes) console.error(`   ${d._id}  ×${d.count}  (${d.names.join(" / ")})`);
      console.error("   Run `node fix-duplicate-item-ids.js` (dry run) then `node fix-duplicate-item-ids.js --apply`.\n");
      return { duplicates: dupes };
    }
    await Inventory.createIndexes(); // no-op if the unique index is already there
    return { duplicates: [] };
  } catch (err) {
    console.error("Inventory ID integrity check failed:", err.message);
    return { duplicates: [], error: err };
  }
}

module.exports = { ensureInventoryIdIntegrity, findDuplicateItemIds };