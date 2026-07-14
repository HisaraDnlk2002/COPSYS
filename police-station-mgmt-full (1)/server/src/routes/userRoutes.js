const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  getMe,
  listUsers,
  getStats,
  createUser,
  updateUser,
  updateUserStatus,
  resetPassword,
} = require("../controllers/usersController");

const router = express.Router();

router.use(verifyToken);

router.get("/me", getMe);
router.get("/stats", requireRole("admin"), getStats);
router.get("/", requireRole("admin", "oic"), listUsers);
router.post("/", requireRole("admin"), createUser);
router.patch("/:id", requireRole("admin"), updateUser);
router.patch("/:id/status", requireRole("admin"), updateUserStatus);
router.patch("/:id/password", requireRole("admin"), resetPassword);

module.exports = router;
