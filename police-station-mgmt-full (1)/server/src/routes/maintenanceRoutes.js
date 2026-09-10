const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, update } = require("../controllers/maintenanceController");

const router = express.Router();

router.use(verifyToken);
router.use(requireRole("duty_officer", "inventory_officer"));

router.get("/", list);
router.patch("/:id", requireRole("inventory_officer"), update);

module.exports = router;
