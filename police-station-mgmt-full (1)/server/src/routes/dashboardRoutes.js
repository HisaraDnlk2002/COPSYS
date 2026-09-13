const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { getSummary, getOicSummary } = require("../controllers/dashboardController");

const router = express.Router();

router.use(verifyToken);
router.get("/summary", getSummary);
router.get("/oic-summary", requireRole("oic", "admin"), getOicSummary);

module.exports = router;
