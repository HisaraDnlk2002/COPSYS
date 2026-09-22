const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, update } = require("../controllers/shiftController");

const router = express.Router();

router.use(verifyToken);

router.get("/", list);
router.patch("/:id", requireRole("admin", "oic"), update);

module.exports = router;
