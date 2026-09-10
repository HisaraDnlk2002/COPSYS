const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, listMine, updateStatus } = require("../controllers/alertsController");

const router = express.Router();

router.use(verifyToken);

// Any authenticated role — scoped server-side (listMine to
// req.user.uid; updateStatus enforces inventory_officer OR the alert's
// own recipient internally) — so both sit above the
// duty_officer/inventory_officer gate below rather than behind it.
router.get("/mine", listMine);
router.patch("/:id", updateStatus);

router.use(requireRole("duty_officer", "inventory_officer"));
router.get("/", list);

module.exports = router;
