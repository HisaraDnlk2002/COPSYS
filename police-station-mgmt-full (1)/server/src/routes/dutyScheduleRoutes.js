const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  listMine,
  listWeeks,
  getWeek,
  createWeek,
  generateRoster,
  getReplacementSuggestions,
  createDailyChange,
  listDailyChanges,
  create,
  update,
  submitWeek,
  approveWeek,
  sendBackWeek,
} = require("../controllers/dutyScheduleController");

const router = express.Router();

router.use(verifyToken);

router.get("/mine", listMine);

router.get("/weeks", requireRole("oic", "duty_officer"), listWeeks);
router.post("/weeks", requireRole("duty_officer"), createWeek);
router.get("/weeks/:weekId", requireRole("oic", "duty_officer"), getWeek);
router.post("/weeks/:weekId/generate", requireRole("duty_officer"), generateRoster);
router.patch("/weeks/:weekId/submit", requireRole("duty_officer"), submitWeek);
router.patch("/weeks/:weekId/approve", requireRole("oic"), approveWeek);
router.patch("/weeks/:weekId/send-back", requireRole("oic"), sendBackWeek);

router.get("/replacement-suggestions", requireRole("duty_officer"), getReplacementSuggestions);

router.get("/daily-changes", requireRole("duty_officer", "oic"), listDailyChanges);
router.post("/daily-changes", requireRole("duty_officer"), createDailyChange);

router.post("/", requireRole("duty_officer"), create);
router.patch("/:id", requireRole("duty_officer", "oic"), update);

module.exports = router;
