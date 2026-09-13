const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  getMe,
  updateMe,
  changeMyPassword,
  listUsers,
  getStats,
  createUser,
  updateUser,
  updateUserStatus,
  resetPassword,
} = require("../controllers/usersController");

const router = express.Router();

router.use(verifyToken);

// "/me" routes must come before the "/:id" ones below — otherwise
// Express would match "me" as an :id param and route these into the
// admin-only handlers instead.
router.get("/me", getMe);
router.patch("/me", updateMe);
router.patch("/me/password", changeMyPassword);
router.get("/stats", requireRole("admin"), getStats);
router.get("/", requireRole("admin", "oic", "duty_officer"), listUsers);
router.post("/", requireRole("admin"), createUser);
router.patch("/:id", requireRole("admin"), updateUser);
router.patch("/:id/status", requireRole("admin"), updateUserStatus);
router.patch("/:id/password", requireRole("admin"), resetPassword);

module.exports = router;
