const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { search } = require("../controllers/searchController");

const router = express.Router();

router.use(verifyToken);
router.get("/", search);

module.exports = router;
