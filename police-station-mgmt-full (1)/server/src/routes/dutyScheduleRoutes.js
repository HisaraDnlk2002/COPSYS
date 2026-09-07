const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  listMine,
  listWeeks,
  getWeek,
  createWeek,
  updateRequirements,
  getStaffingOverview,
  generateRoster,
  getReplacementSuggestions,
  createDailyChange,
  listDailyChanges,
  create,
  update,
  submitWeek,
  approveWeek,
  sendBackWeek,
  publishWeek,
  deleteWeek,
  getTodaysDuty,
  getBriefing,
} = require("../controllers/dutyScheduleController");

const router = express.Router();

router.use(verifyToken);

router.get("/mine", listMine);

router.get("/weeks", requireRole("oic", "duty_officer"), listWeeks);
router.post("/weeks", requireRole("duty_officer"), createWeek);
router.get("/weeks/:weekId", requireRole("oic", "duty_officer"), getWeek);
router.patch("/weeks/:weekId/requirements", requireRole("duty_officer"), updateRequirements);
router.get("/weeks/:weekId/staffing-overview", requireRole("duty_officer", "oic"), getStaffingOverview);
router.post("/weeks/:weekId/generate", requireRole("duty_officer"), generateRoster);
router.patch("/weeks/:weekId/submit", requireRole("duty_officer"), submitWeek);
router.patch("/weeks/:weekId/approve", requireRole("oic"), approveWeek);
router.patch("/weeks/:weekId/send-back", requireRole("oic"), sendBackWeek);
router.patch("/weeks/:weekId/publish", requireRole("duty_officer"), publishWeek);
router.delete("/weeks/:weekId", requireRole("duty_officer"), deleteWeek);

router.get("/replacement-suggestions", requireRole("duty_officer"), getReplacementSuggestions);

router.get("/today", requireRole("duty_officer", "oic"), getTodaysDuty);
router.get("/briefing", requireRole("duty_officer", "oic"), getBriefing);
router.get("/daily-changes", requireRole("duty_officer", "oic"), listDailyChanges);
router.post("/daily-changes", requireRole("duty_officer"), createDailyChange);

router.post("/", requireRole("duty_officer"), create);
router.patch("/:id", requireRole("duty_officer", "oic"), update);

module.exports = router;