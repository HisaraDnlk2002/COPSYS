const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, create } = require("../controllers/inspectionsController");

const router = express.Router();

router.use(verifyToken);
router.use(requireRole("duty_officer", "inventory_officer"));

router.get("/", list);
router.post("/", requireRole("inventory_officer"), create);

module.exports = router;
