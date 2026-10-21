// One-off repair for Inventory items that share an Item ID.
//
// For each duplicated Item ID the OLDEST item keeps it; every other item is
// given the next free 5-digit weapon ID, and its sub IDs (10004-01 ...) are
// renamed to match — including the copies of those sub IDs stored on
// transactions, maintenance records and inspections. Items are linked by
// their database _id everywhere else, so nothing else needs to change.
//
// Ammunition IDs are typed by hand (batch/lot numbers), so duplicates there
// are only reported — rename those yourself.
//
// Usage:
//   node fix-duplicate-item-ids.js            dry run, changes nothing
//   node fix-duplicate-item-ids.js --apply    renumber for real
// Back up the database first when using --apply.

require("dotenv").config();
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const Inventory = require("./src/models/Inventory");
const InventoryTransaction = require("./src/models/InventoryTransaction");
const Maintenance = require("./src/models/Maintenance");
const Inspection = require("./src/models/Inspection");
const { findDuplicateItemIds } = require("./src/utils/inventoryIdIntegrity");
const { WEAPON_CATEGORIES } = require("./src/config/weaponCatalog");

const APPLY = process.argv.includes("--apply");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const dupes = await findDuplicateItemIds();
  if (dupes.length === 0) {
    console.log("No duplicate Item IDs. Making sure the unique index exists…");
    await Inventory.createIndexes();
    console.log("Done.");
    return;
  }

  // Highest 5-digit weapon ID in use, so new IDs never collide.
  const all = await Inventory.find({}).select("itemId");
  const used = new Set(all.map((i) => i.itemId));
  let maxId = 10000;
  for (const id of used) if (/^\d{5}$/.test(id) && Number(id) > maxId) maxId = Number(id);
  const takeNextId = () => {
    do maxId += 1; while (used.has(String(maxId)));
    used.add(String(maxId));
    return String(maxId);
  };

  console.log(APPLY ? "APPLYING changes\n" : "DRY RUN — nothing will be changed (add --apply to do it)\n");

  for (const d of dupes) {
    const items = await Inventory.find({ itemId: d._id }).sort({ createdAt: 1, _id: 1 });
    const [keeper, ...others] = items;
    console.log(`Item ID ${d._id}: kept by "${keeper.itemName}"`);
    for (const item of others) {
      if (!WEAPON_CATEGORIES.includes(item.category)) {
        console.log(`   SKIPPED "${item.itemName}" (${item.category}) — ammunition IDs must be renamed by hand`);
        continue;
      }
      const newId = takeNextId();
      const renames = (item.subItems || []).map((s) => [s.subId, s.subId.replace(/^.*(-\d+)$/, `${newId}$1`)]);
      console.log(`   "${item.itemName}" -> ${newId}${renames.length ? `  (sub IDs ${renames[0][1]} … ${renames[renames.length - 1][1]})` : ""}`);
      if (!APPLY) continue;

      for (const sub of item.subItems || []) sub.subId = sub.subId.replace(/^.*(-\d+)$/, `${newId}$1`);
      item.itemId = newId;
      await item.save();
      for (const [from, to] of renames) {
        await InventoryTransaction.updateMany({ itemId: item._id, subId: from }, { $set: { subId: to } });
        await Maintenance.updateMany({ itemId: item._id, subId: from }, { $set: { subId: to } });
        await Inspection.updateMany({ itemId: item._id, subId: from }, { $set: { subId: to } });
      }
    }
  }

  if (APPLY) {
    const left = await findDuplicateItemIds();
    if (left.length === 0) {
      await Inventory.createIndexes();
      console.log("\nAll duplicates fixed and the unique index on itemId is in place.");
    } else {
      console.log(`\n${left.length} duplicate ID(s) remain (ammunition?) — rename them by hand, then run this again.`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());