const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { getMyBalance, getBalanceForOfficer } = require("../controllers/leaveController");

const router = express.Router();

router.use(verifyToken);
router.get("/me", getMyBalance);
router.get("/:officerId", requireRole("admin", "oic"), getBalanceForOfficer);

module.exports = router;
