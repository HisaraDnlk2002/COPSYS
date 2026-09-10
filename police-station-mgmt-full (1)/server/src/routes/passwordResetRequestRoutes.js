const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { submitRequest, listRequests, approveRequest, rejectRequest } = require("../controllers/passwordResetRequestsController");

const router = express.Router();

// Public — this is exactly the flow an officer hits when they can't log
// in, so it can't require a token. Registered above the auth gate below.
router.post("/", submitRequest);

router.use(verifyToken);
router.use(requireRole("admin"));
router.get("/", listRequests);
router.patch("/:id/approve", approveRequest);
router.patch("/:id/reject", rejectRequest);

module.exports = router;
