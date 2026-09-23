const { generateAlert } = require("./alerts");

// Call after anything changes an Ammunition line's quantity (issue,
// confirmed return, restock). Raises one "Low Ammunition Stock" alert
// per dip to/below lowStockThreshold, and re-arms once stock climbs back
// above it. Saves the item only when the flag actually changes.
async function syncLowStockAlert(item) {
  if (item.lowStockThreshold === null || item.lowStockThreshold === undefined) return;

  const isLow = item.quantity <= item.lowStockThreshold;
  if (isLow && !item.lowStockAlertGenerated) {
    await generateAlert({
      alertType: "low_ammo_stock",
      title: "Low Ammunition Stock",
      message: `${item.itemName} (${item.itemId}) is down to ${item.quantity} round(s) — threshold is ${item.lowStockThreshold}.`,
      itemId: item._id,
      stationId: item.stationId,
    });
    item.lowStockAlertGenerated = true;
    await item.save();
  } else if (!isLow && item.lowStockAlertGenerated) {
    item.lowStockAlertGenerated = false;
    await item.save();
  }
}

module.exports = { syncLowStockAlert };
