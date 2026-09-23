const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireRole } = require("../middleware/requireRole");
const { list, create, update } = require("../controllers/branchController");

const router = express.Router();

router.use(verifyToken);

// Every role can read the list (populates branch dropdowns app-wide);
// only admin/oic can actually change the catalog.
router.get("/", list);
router.post("/", requireRole("admin", "oic"), create);
router.patch("/:id", requireRole("admin", "oic"), update);

module.exports = router;
