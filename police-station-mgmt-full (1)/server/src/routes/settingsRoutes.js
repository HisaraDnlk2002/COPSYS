const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { getSettings, updateSettings } = require("../controllers/settingsController");

const router = express.Router();

router.use(verifyToken);
router.use(requireRole("oic"));

router.get("/", getSettings);
router.patch("/", updateSettings);

module.exports = router;
