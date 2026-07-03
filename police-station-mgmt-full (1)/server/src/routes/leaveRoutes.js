const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const {
  listMine,
  listAll,
  create,
  approve,
  reject,
} = require("../controllers/leaveController");

const router = express.Router();

router.use(verifyToken);

router.get("/mine", listMine);
router.get("/", requireRole("oic"), listAll);
router.post("/", create);
router.patch("/:id/approve", requireRole("oic"), approve);
router.patch("/:id/reject", requireRole("oic"), reject);

module.exports = router;
