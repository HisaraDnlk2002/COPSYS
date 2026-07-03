const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  getMe,
  listUsers,
  createUser,
  updateUserStatus,
  resetPassword,
} = require("../controllers/usersController");

const router = express.Router();

router.use(verifyToken);

router.get("/me", getMe);
router.get("/", requireRole("admin"), listUsers);
router.post("/", requireRole("admin"), createUser);
router.patch("/:id/status", requireRole("admin"), updateUserStatus);
router.patch("/:id/password", requireRole("admin"), resetPassword);

module.exports = router;