const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  list,
  create,
  update,
  issue,
  submitReturn,
  listTransactions,
  getMyWeapons,
  getStats,
  confirmTransaction,
  rejectTransaction,
  reviewTransaction,
  reportMissing,
  restock,
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
// The officer writing their own return report. Any role can hold a weapon,
// so this sits above the role gate; submitReturn always uses the caller's
// own id as the officer.
router.post("/:id/submit-return", submitReturn);
router.patch("/transactions/:id/confirm", confirmTransaction);
// Same reasoning as confirm: only the officer named on the transaction can
// reject it, and rejectTransaction itself enforces that.
router.patch("/transactions/:id/reject", rejectTransaction);

// OIC gets read-only access to review exceptions (workflow section 8);
// every write below stays inventory_officer-only.
router.use(requireRole("duty_officer", "inventory_officer", "oic"));

// Read access — both roles
router.get("/stats", getStats);
router.get("/transactions", listTransactions);
router.get("/", list);

// Write access — inventory_officer only (Duty Officer is view-only per
// ARCHITECTURE.md Section 1)
// The Inventory Officer reviews a transaction the officer rejected: send it
// back for confirmation again, or cancel it.
router.patch("/transactions/:id/review", requireRole("inventory_officer"), reviewTransaction);
router.post("/", requireRole("inventory_officer"), create);
router.patch("/:id", requireRole("inventory_officer"), update);
router.post("/:id/issue", requireRole("inventory_officer"), issue);
router.post("/:id/report-missing", requireRole("inventory_officer"), reportMissing);
router.post("/:id/restock", requireRole("inventory_officer"), restock);

module.exports = router;