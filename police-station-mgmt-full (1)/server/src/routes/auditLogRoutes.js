const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list } = require("../controllers/auditLogController");

const router = express.Router();

router.use(verifyToken);
router.get("/", requireRole("admin"), list);

module.exports = router;
