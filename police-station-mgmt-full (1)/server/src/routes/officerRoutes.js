const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { search } = require("../controllers/officersController");

const router = express.Router();

router.use(verifyToken);
router.get("/search", search);

module.exports = router;
