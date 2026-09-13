import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyDashboardStats, dummyLeaveBalances } from "./dummyData";

// Combines stats (today's duty, next shift, active complaints) with the
// leave balance total, matching the 4 stat cards on the Officer Dashboard.
export async function getDashboardSummary() {
  if (USE_DUMMY_DATA) {
    const uid = localStorage.getItem("dummyUserId");
    const stats = dummyDashboardStats[uid] || {};
    const balance = dummyLeaveBalances[uid] || { personal: 0, medical: null, casual: 0 };
    // Medical has no cap, so it's excluded from this finite total —
    // same convention as Dashboard.jsx's real (non-dummy) calculation.
    const totalLeaveDays = balance.personal + balance.casual;
    return Promise.resolve({ ...stats, leaveBalanceDays: totalLeaveDays });
  }
  return api.get("/dashboard/summary");
}
