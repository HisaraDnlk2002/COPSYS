import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyUsers, dummyComplaints } from "./dummyData";

const EMPTY_RESULTS = { personnel: [], complaints: [], inventory: [], duty: [] };

// A light simulation for dummy-data mode — only Personnel/Complaints
// have meaningful dummy fixtures to search (dummyData.js has no
// Inventory items), so those are the only two categories that ever
// return anything here. Real mode's role-based category gating (see
// searchController.js) is not replicated client-side — dummy mode is
// just for demoing the UI, not exercising access rules.
export async function globalSearch(query) {
  if (USE_DUMMY_DATA) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return Promise.resolve(EMPTY_RESULTS);
    return Promise.resolve({
      ...EMPTY_RESULTS,
      personnel: dummyUsers
        .filter((u) => u.fullName?.toLowerCase().includes(q) || u.rankAndNumber?.toLowerCase().includes(q))
        .slice(0, 6),
      complaints: dummyComplaints
        .filter((c) => c.refId?.toLowerCase().includes(q) || c.title?.toLowerCase().includes(q))
        .slice(0, 6),
    });
  }
  return api.get(`/search?q=${encodeURIComponent(query)}`);
}
