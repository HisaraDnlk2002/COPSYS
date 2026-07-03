const Inventory = require("../models/Inventory");
const InventoryTransaction = require("../models/InventoryTransaction");

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

    const item = await Inventory.create({
      itemId,
      itemName,
      category,
      quantity,
      condition,
      status: "available",
      lastUpdatedBy: req.user.uid,
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
  const { officerId, quantity, dutyType, dateTime } = req.body;

  if (!officerId || !quantity) {
    return res.status(400).json({ error: "Officer ID and quantity are required" });
  }

  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
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
      type: "issue",
      dutyType,
      quantity,
      dateTime: dateTime || new Date(),
      stationId: req.user.stationId,
    });

    return res.status(201).json(transaction.toJSON());
  } catch (err) {
    console.error("issue inventory error:", err);
    return res.status(500).json({ error: "Could not process issue transaction" });
  }
}

// POST /api/inventory/:id/return — duty_officer, inventory_officer
// Matches the "Return Item" modal: Officer ID, Weapon Serial ID, Return Date, Weapon Condition
async function returnItem(req, res) {
  const { officerId, quantity, condition, remarks, dateTime } = req.body;

  if (!officerId || !quantity || !condition) {
    return res.status(400).json({ error: "Officer ID, quantity and condition are required" });
  }

  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    item.quantity += quantity;
    item.status = condition.toLowerCase() === "faulty" ? "damaged" : "available";
    item.condition = condition;
    item.lastUpdatedBy = req.user.uid;
    await item.save();

    const transactionType = condition.toLowerCase() === "faulty" ? "damaged" : "return";

    const transaction = await InventoryTransaction.create({
      itemId: item._id,
      officerId,
      type: transactionType,
      quantity,
      dateTime: dateTime || new Date(),
      condition,
      remarks,
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
      .populate("officerId", "fullName rankAndNumber");

    return res.json(transactions.map((t) => t.toJSON()));
  } catch (err) {
    console.error("listTransactions error:", err);
    return res.status(500).json({ error: "Could not load transaction log" });
  }
}

module.exports = { list, create, update, issue, returnItem, listTransactions };
