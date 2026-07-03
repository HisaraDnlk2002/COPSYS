const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, listLog, getOne, create, update, assign } = require("../controllers/complaintsController");

const router = express.Router();

router.use(verifyToken);

router.get("/log", requireRole("oic"), listLog);

router.use(requireRole("oic", "duty_officer", "officer"));
router.get("/", list);
router.get("/:id", getOne);
router.post("/", create);
router.patch("/:id", requireRole("oic", "duty_officer"), update);
router.patch("/:id/assign", requireRole("oic"), assign);

module.exports = router;
