const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  list,
  create,
  update,
  issue,
  returnItem,
  listTransactions,
  getMyWeapons,
  getStats,
  confirmTransaction,
  reportMissing,
} = require("../controllers/inventoryController");

const router = express.Router();

router.use(verifyToken);

// Any authenticated role — scoped server-side to req.user.uid, so these
// sit above the duty_officer/inventory_officer gate below rather than
// behind it. See getMyWeapons/confirmTransaction in
// inventoryController.js — confirmTransaction in particular MUST stay
// reachable by every role, since the officer confirming could be an
// Officer, Duty Officer, or Inventory Officer, and confirmTransaction
// itself is the thing enforcing that only that actual officer can use it.
router.get("/my-weapons", getMyWeapons);
router.patch("/transactions/:id/confirm", confirmTransaction);

router.use(requireRole("duty_officer", "inventory_officer"));

// Read access — both roles
router.get("/stats", getStats);
router.get("/transactions", listTransactions);
router.get("/", list);

// Write access — inventory_officer only (Duty Officer is view-only per
// ARCHITECTURE.md Section 1)
router.post("/", requireRole("inventory_officer"), create);
router.patch("/:id", requireRole("inventory_officer"), update);
router.post("/:id/issue", requireRole("inventory_officer"), issue);
router.post("/:id/return", requireRole("inventory_officer"), returnItem);
router.post("/:id/report-missing", requireRole("inventory_officer"), reportMissing);

module.exports = router;
