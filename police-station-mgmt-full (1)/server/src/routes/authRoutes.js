const express = require("express");
const { login } = require("../controllers/authController");

const router = express.Router();

// Public — no token required, this IS how you get a token
router.post("/login", login);

module.exports = router;
