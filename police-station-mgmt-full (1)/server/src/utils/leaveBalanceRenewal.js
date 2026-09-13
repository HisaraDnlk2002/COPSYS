const LeaveBalance = require("../models/LeaveBalance");
const User = require("../models/User");
const { casualPersonalAllowance } = require("../config/ranks");

// LeaveBalance is already modeled one-document-per-officer-per-year (see
// its officerId+year unique index) — this is what actually makes that
// mean something. Every balance lookup/mutation in leaveController.js
// goes through here instead of querying LeaveBalance directly, so a new
// calendar year's allowance is granted automatically the first time
// anyone touches that officer's balance after it rolls over, rather than
// OIC having to remember to manually top everyone up every January.
// Casual/Personal both use the rank-based allowance (28 days for
// Sergeant and below, 21 above that); Medical is always unlimited (null).
async function ensureYearBalance(officerId, year) {
  let balance = await LeaveBalance.findOne({ officerId, year });
  if (balance) return balance;

  const officer = await User.findById(officerId).select("rank");
  const allowance = casualPersonalAllowance(officer?.rank);
  return LeaveBalance.create({ officerId, year, personal: allowance, casual: allowance, medical: null });
}

module.exports = { ensureYearBalance };
