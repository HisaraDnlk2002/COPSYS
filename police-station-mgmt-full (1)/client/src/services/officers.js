// Officer directory lookup, used to power the Emergency Contact search.
//
// ASSUMPTION: I don't have your services/leave.js file, so I don't know
// whether you call your API via plain fetch, axios, or a shared client
// wrapper. This uses plain fetch against a REST endpoint as a placeholder.
// If your other services use something else (e.g. an `apiClient` instance,
// a different base URL, or auth headers/tokens), swap those in here to
// match — the rest of the app (SearchableSelect, LeaveRequests) doesn't
// care how this function is implemented, only that it returns the shape
// documented below.

const BASE_URL = "/api/officers";

// Returns options in the shape SearchableSelect expects:
// [{ value, label, subtitle, phone }]
export async function searchOfficers(query) {
  const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`, {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("Failed to search officers");
  }

  const data = await res.json();

  // ASSUMPTION: each officer record looks like
  // { id, name, phone, rank, station }. Adjust the mapping below if your
  // API returns different field names.
  return data.map((officer) => ({
    value: officer.id,
    label: `${officer.name} — ${officer.phone}`,
    subtitle: [officer.rank, officer.station].filter(Boolean).join(", "),
    phone: officer.phone,
  }));
}
