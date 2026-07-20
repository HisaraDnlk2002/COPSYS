import { api } from "./client";

// Officer directory lookup, used to power the "Acting Officer" search on
// the leave application form. Any authenticated user can search — see
// GET /api/officers/search on the server.

// Returns options in the shape SearchableSelect expects:
// [{ value, label, subtitle, phone }]
export async function searchOfficers(query) {
  const officers = await api.get(`/officers/search?q=${encodeURIComponent(query)}`);

  return officers.map((officer) => ({
    value: officer.id,
    label: `${officer.fullName} — ${officer.phoneNumber}`,
    subtitle: [officer.role, officer.department].filter(Boolean).join(", "),
    phone: officer.phoneNumber,
  }));
}
