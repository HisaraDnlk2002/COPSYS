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
} = require("../controllers/inventoryController");

const router = express.Router();

router.use(verifyToken);
router.use(requireRole("duty_officer", "inventory_officer"));

// Read access — both roles
router.get("/transactions", listTransactions);
router.get("/", list);

// Write access — inventory_officer only (Duty Officer is view-only per
// ARCHITECTURE.md Section 1)
router.post("/", requireRole("inventory_officer"), create);
router.patch("/:id", requireRole("inventory_officer"), update);
router.post("/:id/issue", requireRole("inventory_officer"), issue);
router.post("/:id/return", requireRole("inventory_officer"), returnItem);

module.exports = router;
