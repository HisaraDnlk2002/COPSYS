// Single source of truth for the Sri Lanka Police rank hierarchy shown
// on the "Register new Personnel" form, mirrored from the VALID_RANKS
// list in server/src/controllers/usersController.js (and the RANKS enum
// on server/src/models/User.js). Keep both in sync.
//
// Official rank titles — left untranslated in both locales, same
// convention as the Complaint Book register names in Complaints.jsx.
// Ordered senior to junior, matching how the ranks are actually laid out
// in the force's hierarchy.
export const RANKS = [
  { value: "IGP", label: "IGP — Inspector General of Police" },
  { value: "SDIG", label: "SDIG — Senior Deputy Inspector General" },
  { value: "DIG", label: "DIG — Deputy Inspector General" },
  { value: "SSP", label: "SSP — Senior Superintendent of Police" },
  { value: "SP", label: "SP — Superintendent of Police" },
  { value: "ASP", label: "ASP — Assistant Superintendent of Police" },
  { value: "Chief Inspector", label: "Chief Inspector" },
  { value: "Inspector", label: "Inspector" },
  { value: "Sub-Inspector", label: "Sub-Inspector" },
  { value: "Sergeant Major", label: "Sergeant Major" },
  { value: "Sergeant", label: "Sergeant" },
  { value: "Constable", label: "Constable" },
];
