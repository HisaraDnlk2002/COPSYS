const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  getSummary,
  getCrimeDistribution,
  getForceStrength,
  getActivityLog,
  previewReport,
  generateReport,
  downloadReport,
  archiveReport,
  deleteReport,
} = require("../controllers/reportsController");

const router = express.Router();

router.use(verifyToken);
// Reports is shared across roles now (each sees only its own categories,
// enforced per-request in the controller via CATEGORY_ROLES) — duty_officer
// gets Duty, inventory_officer gets Weapons/Ammunition, admin/oic get
// everything. The station-wide overview (stats + charts) below stays
// admin/oic only regardless of role.
router.use(requireRole("admin", "oic", "duty_officer", "inventory_officer"));

router.get("/summary", requireRole("admin", "oic"), getSummary);
router.get("/crime-distribution", requireRole("admin", "oic"), getCrimeDistribution);
router.get("/force-strength", requireRole("admin", "oic"), getForceStrength);
router.get("/activity-log", getActivityLog);

// Report Management module: preview, generate, download, archive, delete.
router.post("/preview", previewReport);
router.post("/generate", generateReport);
router.get("/:id/download", downloadReport);
router.patch("/:id/archive", archiveReport);
router.delete("/:id", deleteReport);

module.exports = router;
