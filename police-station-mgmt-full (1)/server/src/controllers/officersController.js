const User = require("../models/User");

// GET /api/officers/search?q=... — any authenticated user. Powers the
// "Acting Officer" search on the leave application form, so it's
// deliberately not restricted to admin/oic like /api/users is — every
// officer needs to be able to look up a colleague here.
async function search(req, res) {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.json([]);
  }

  try {
    const officers = await User.find({
      stationId: req.user.stationId,
      status: "active",
      fullName: { $regex: q, $options: "i" },
    })
      .select("fullName phoneNumber role department")
      .limit(15);

    return res.json(officers.map((o) => o.toJSON()));
  } catch (err) {
    console.error("search officers error:", err);
    return res.status(500).json({ error: "Could not search officers" });
  }
}

module.exports = { search };
