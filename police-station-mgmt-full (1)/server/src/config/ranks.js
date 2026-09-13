// Sri Lanka Police rank hierarchy, senior to junior — single source of
// truth for rank validation (User.js, usersController.js) and rank-based
// leave entitlement (leaveController.js/usersController.js). Mirrored on
// the client at client/src/config/ranks.js — keep both in sync.
const RANKS = [
  "IGP",
  "SDIG",
  "DIG",
  "SSP",
  "SP",
  "ASP",
  "Chief Inspector",
  "Inspector",
  "Sub-Inspector",
  "Sergeant Major",
  "Sergeant",
  "Constable",
];

// Casual/Personal leave entitlement: 28 days/year for Sergeant and below
// (Sergeant, Constable); 21 days/year for every rank above that
// (Sergeant Major up through IGP). Medical leave has no cap at all —
// see LeaveBalance's `medical` field, always null, never checked or
// decremented in leaveController.js.
const RANKS_WITH_28_DAYS = ["Sergeant", "Constable"];

function casualPersonalAllowance(rank) {
  return RANKS_WITH_28_DAYS.includes(rank) ? 28 : 21;
}

module.exports = { RANKS, casualPersonalAllowance };
