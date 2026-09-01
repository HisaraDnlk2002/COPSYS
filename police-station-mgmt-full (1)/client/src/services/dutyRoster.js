import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import {
  dummyRosterWeeks,
  dummyRosterShifts,
  dummyRosterOfficers,
} from "./dummyData";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export async function getRosterWeeks() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyRosterWeeks);
  }
  return api.get("/duty-schedule/weeks");
}

export async function getRosterWeek(weekId) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    const shifts = dummyRosterShifts.filter((s) => s.weekId === weekId);
    return Promise.resolve({ week, shifts });
  }
  return api.get(`/duty-schedule/weeks/${weekId}`);
}
export async function createRosterWeek(payload) {
  if (USE_DUMMY_DATA) {
    const newWeek = {
      id: `w${dummyRosterWeeks.length + 1}`,
      status: "draft",
      requirements: [],
      scheduledUnits: 0,
      offDuty: 0,
      leaveCoverage: 0,
      ...payload,
    };
    dummyRosterWeeks.unshift(newWeek);
    return Promise.resolve(newWeek);
  }
  return api.post("/duty-schedule/weeks", payload);
}

// Step 2 of the Create Roster wizard — saves the Day/Night headcount
// per branch for this week (replaces the whole list each save).
export async function updateWeekRequirements(weekId, requirements) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    if (week) week.requirements = requirements;
    return Promise.resolve(week);
  }
  return api.patch(`/duty-schedule/weeks/${weekId}/requirements`, { requirements });
}

// Pure headcount preview (Required / Perm Available / Shortage) shown
// in the wizard before anything is actually generated.
export async function getStaffingOverview(weekId) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    const overview = (week?.requirements || []).map((r) => ({
      branch: r.branch,
      day: { required: r.dayRequired, permAvailable: 3, shortage: Math.max(0, r.dayRequired - 3) },
      night: { required: r.nightRequired, permAvailable: 3, shortage: Math.max(0, r.nightRequired - 3) },
    }));
    return Promise.resolve({ overview, generalPoolAvailable: 5 });
  }
  return api.get(`/duty-schedule/weeks/${weekId}/staffing-overview`);
}

// Runs the rule-based allocation engine on the server. Pass { branch,
// shiftType } to run "Smart Allocation" on just one row of the wizard
// table, or call with no args to generate everything at once.
export async function generateRoster(weekId, target) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    const generated = dummyRosterOfficers.slice(0, 5).map((officer, i) => ({
      id: `gen-${weekId}-${i}`,
      weekId,
      officerId: officer.id,
      date: week?.weekStarting,
      day: "Monday",
      shiftType: target?.shiftType || "day",
      shiftStart: "08:00",
      shiftEnd: "20:00",
      department: target?.branch || week?.requirements?.[0]?.branch,
      status: "pending",
    }));
    dummyRosterShifts.push(...generated);
    return Promise.resolve({ shifts: generated, unfilledDays: [], excludedOfficerIds: [] });
  }
  return api.post(`/duty-schedule/weeks/${weekId}/generate`, target || {});
}
export async function deleteRosterWeek(weekId) {
  if (USE_DUMMY_DATA) {
    const idx = dummyRosterWeeks.findIndex((w) => w.id === weekId);
    if (idx !== -1) dummyRosterWeeks.splice(idx, 1);
    return Promise.resolve();
  }
  return api.delete(`/duty-schedule/weeks/${weekId}`);
}


export async function submitRosterWeek(weekId) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    if (week) week.status = "submitted";
    return Promise.resolve(week);
  }
  return api.patch(`/duty-schedule/weeks/${weekId}/submit`);
}

export async function approveRosterWeek(weekId) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    if (week) week.status = "approved";
    return Promise.resolve(week);
  }
  return api.patch(`/duty-schedule/weeks/${weekId}/approve`);
}

export async function sendBackRosterWeek(weekId, reason) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    if (week) {
      week.status = "sent_back";
      week.sendBackReason = reason;
    }
    return Promise.resolve(week);
  }
  return api.patch(`/duty-schedule/weeks/${weekId}/send-back`, { reason });
}

export async function getReplacementSuggestions(officerId, date) {
  if (USE_DUMMY_DATA) {
    const candidates = dummyRosterOfficers.filter((o) => o.id !== officerId);
    return Promise.resolve(
      candidates.slice(0, 3).map((o, i) => ({
        officer: o,
        reasonCode: i === 0 ? "same_rank_available" : i === 1 ? "same_division_available" : "available_station_wide",
        reasonLabel: i === 0 ? "Available, Same Rank" : i === 1 ? "Available, Same Division" : "Available, Overtime Required",
      }))
    );
  }
  return api.get(`/duty-schedule/replacement-suggestions?officerId=${officerId}&date=${date}`);
}

// Manually place one officer into one day's grid cell — used when the
// Duty Officer edits a draft/sent-back week by hand instead of relying
// solely on the auto-generator.
export async function createDutyShift(payload) {
  if (USE_DUMMY_DATA) {
    const newShift = { id: `manual-${Date.now()}`, status: "pending", ...payload };
    dummyRosterShifts.push(newShift);
    return Promise.resolve(newShift);
  }
  // payload: { weekId, officerId, date, shiftStart, shiftEnd, department }
  return api.post("/duty-schedule", payload);
}

// Edits an existing grid cell — used both for manual corrections and to
// actually apply a chosen replacement suggestion.
export async function updateDutyShift(shiftId, payload) {
  if (USE_DUMMY_DATA) {
    const shift = dummyRosterShifts.find((s) => s.id === shiftId);
    if (shift) Object.assign(shift, payload);
    return Promise.resolve(shift);
  }
  return api.patch(`/duty-schedule/${shiftId}`, payload);
}

export async function publishRosterWeek(weekId) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    if (week) week.status = "published";
    return Promise.resolve(week);
  }
  return api.patch(`/duty-schedule/weeks/${weekId}/publish`);
}

export async function listDailyChanges(date) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve([]);
  }
  return api.get(`/duty-schedule/daily-changes${date ? `?date=${date}` : ""}`);
}

// payload: { scheduleEntryId, reason, replacementOfficerId, notifyOfficer }
export async function createDailyChange(payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ id: `dc-${Date.now()}`, ...payload });
  }
  return api.post("/duty-schedule/daily-changes", payload);
}

// The live picture for one date, from published weeks only.
export async function getTodaysDuty(date) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve([]);
  }
  return api.get(`/duty-schedule/today${date ? `?date=${date}` : ""}`);
}
export { DAYS_OF_WEEK };