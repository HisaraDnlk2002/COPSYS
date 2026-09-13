const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, listLog, getOne, create, update, assign, downloadReceipt } = require("../controllers/complaintsController");

const router = express.Router();

router.use(verifyToken);

router.get("/log", requireRole("oic"), listLog);

router.get("/", requireRole("oic", "duty_officer", "officer", "admin"), list);
router.get("/:id/receipt", requireRole("oic", "duty_officer", "officer", "admin"), downloadReceipt);
router.get("/:id", requireRole("oic", "duty_officer", "officer", "admin"), getOne);
router.post("/", requireRole("oic", "duty_officer", "officer", "admin"), create);
router.patch("/:id", requireRole("oic", "duty_officer", "admin"), update);
router.patch("/:id/assign", requireRole("oic"), assign);

module.exports = router;
