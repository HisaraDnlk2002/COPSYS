// Usage: router.get("/users", verifyToken, requireRole("admin"), handler)
// Must run AFTER verifyToken, since it reads req.user.role set there.

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: "No role assigned to this account" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
  };
}

module.exports = { requireRole };
