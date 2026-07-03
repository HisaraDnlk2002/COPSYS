const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { getMyBalance } = require("../controllers/leaveController");

const router = express.Router();

router.use(verifyToken);
router.get("/me", getMyBalance);

module.exports = router;
