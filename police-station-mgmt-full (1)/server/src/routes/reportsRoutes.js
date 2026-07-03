const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  getSummary,
  getCrimeDistribution,
  getForceStrength,
  getActivityLog,
} = require("../controllers/reportsController");

const router = express.Router();

router.use(verifyToken);
router.use(requireRole("oic"));

router.get("/summary", getSummary);
router.get("/crime-distribution", getCrimeDistribution);
router.get("/force-strength", getForceStrength);
router.get("/activity-log", getActivityLog);

module.exports = router;
