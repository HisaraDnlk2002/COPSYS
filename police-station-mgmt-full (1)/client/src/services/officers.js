import { api } from "./client";

// Officer directory lookup, used to power the "Acting Officer" search on
// the leave application form. Any authenticated user can search — see
// GET /api/officers/search on the server.

// Returns options in the shape SearchableSelect expects:
// [{ value, label, subtitle, phone, fullName, rankAndNumber }]
// The server matches on fullName OR rankAndNumber, so typing a rank
// number finds the officer too, even though the default label below
// still leads with name + phone. fullName/rankAndNumber are carried as
// separate fields (not just baked into `label`) so a caller that wants
// a different display — e.g. rank & number instead of phone, see
// searchOfficersByRank in Inventory.jsx — can build its own label
// without having to re-parse one back out of ours.
export async function searchOfficers(query) {
  const officers = await api.get(`/officers/search?q=${encodeURIComponent(query)}`);

  return officers.map((officer) => ({
    value: officer.id,
    label: `${officer.fullName} — ${officer.phoneNumber}`,
    subtitle: [officer.role, officer.department].filter(Boolean).join(", "),
    phone: officer.phoneNumber,
    fullName: officer.fullName,
    rankAndNumber: officer.rankAndNumber,
  }));
}
