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

// Runs the rule-based allocation engine on the server (or, in dummy
// mode, a tiny local stand-in so the button is clickable during design
// review — NOT the real algorithm, just enough to show shifts appear).
export async function generateRoster(weekId) {
  if (USE_DUMMY_DATA) {
    const week = dummyRosterWeeks.find((w) => w.id === weekId);
    const generated = dummyRosterOfficers.slice(0, week?.requiredStaffing || 5).map((officer, i) => ({
      id: `gen-${weekId}-${i}`,
      weekId,
      officerId: officer.id,
      date: week?.weekStarting,
      day: "Monday",
      shiftStart: "08:00",
      shiftEnd: "16:00",
      department: week?.department,
      status: "pending",
    }));
    dummyRosterShifts.push(...generated);
    return Promise.resolve({ shifts: generated, unfilledDays: [], excludedOfficerIds: [] });
  }
  return api.post(`/duty-schedule/weeks/${weekId}/generate`);
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

export { DAYS_OF_WEEK };
