const mongoose = require("mongoose");

// Spec §23 — a real, admin-editable collection replacing the old
// hardcoded config/branches.js list (kept as the seed source and as an
// in-memory cache the rest of the app still reads through — see
// refreshBranchCache in config/branches.js — so no other file that
// already calls isGeneralPoolBranch()/reads BRANCHES needed to change).
//
// `name` doubles as both the value stored on User.department/
// DutySchedule.department and the display label — this station's
// existing convention (see the old config/branches.js) already
// combined English+Sinhala into one string rather than splitting
// value/label, so this keeps that instead of introducing a second
// naming scheme partway through the app.
const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    // Marks the floating officer pool branch (spec §3/§4) — officers
    // here aren't tied to one branch and are the first candidates
    // considered when another branch is short-staffed. At most one
    // branch should have this true at a time; not enforced at the
    // schema level since a brief two-true window during an edit isn't
    // actually harmful (whichever is queried first "wins" for pool
    // purposes) and a hard constraint here would complicate the common
    // "rename the pool branch" edit for no real benefit.
    isGeneralPool: { type: Boolean, default: false },

    // "inactive" hides a branch from new assignments without deleting
    // its history — same convention as User.status/Inventory.status
    // elsewhere in this app.
    status: { type: String, enum: ["active", "inactive"], default: "active" },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

branchSchema.index({ stationId: 1, name: 1 }, { unique: true });

branchSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

module.exports = mongoose.model("Branch", branchSchema);
