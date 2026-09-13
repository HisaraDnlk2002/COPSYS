const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { uploadDoctorNote } = require("../middleware/leaveDoctorNoteUpload");
const {
  listMine,
  listAll,
  create,
  approve,
  reject,
  downloadDoctorNote,
} = require("../controllers/leaveController");

const router = express.Router();

router.use(verifyToken);

router.get("/mine", listMine);
router.get("/", requireRole("oic", "duty_officer"), listAll);
router.get("/:id/doctor-note/:attachmentId", downloadDoctorNote);
router.post("/", uploadDoctorNote, create);
router.patch("/:id/approve", requireRole("oic"), approve);
router.patch("/:id/reject", requireRole("oic"), reject);

module.exports = router;
