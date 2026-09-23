const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, update, returnToStock } = require("../controllers/maintenanceController");

const router = express.Router();

router.use(verifyToken);
router.use(requireRole("duty_officer", "inventory_officer", "oic"));

router.get("/", list);
router.patch("/:id", requireRole("inventory_officer"), update);
router.post("/:id/return-to-stock", requireRole("inventory_officer"), returnToStock);

module.exports = router;
