// Rule-based duty roster allocation engine. Deterministic, no ML/AI —
// every decision here is a named, explainable rule. Kept as pure
// functions (no DB calls) so the allocation logic can be unit tested
// without a database, and so the controller stays a thin wrapper that
// just fetches inputs, calls this, and saves outputs.

const { isGeneralPoolBranch } = require("../config/branches");
const { SHIFTS } = require("../config/shifts");

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Rule: an officer with an approved leave request overlapping a given
// date is unavailable that day.
function isOnLeave(officer, date, approvedLeaveRequests) {
  return approvedLeaveRequests.some((leave) => {
    if (String(leave.officerId) !== String(officer.id)) return false;
    const day = new Date(date).setHours(0, 0, 0, 0);
    const start = new Date(leave.startDate).setHours(0, 0, 0, 0);
    const end = new Date(leave.endDate).setHours(0, 0, 0, 0);
    return day >= start && day <= end;
  });
}

// Rule: no officer should be scheduled 7 consecutive days without a
// day off. Tracks how many days in a row each officer has already been
// assigned within the week being generated, and skips them once they
// hit the cap (defaults to 6, i.e. at least 1 day off in 7).
function buildConsecutiveDayTracker(maxConsecutiveDays = 6) {
  const streaks = new Map(); // officerId -> current streak length

  return {
    canAssign(officerId) {
      return (streaks.get(officerId) || 0) < maxConsecutiveDays;
    },
    recordAssigned(officerId) {
      streaks.set(officerId, (streaks.get(officerId) || 0) + 1);
    },
    recordDayOff(officerId) {
      streaks.set(officerId, 0);
    },
  };
}

// Rule: when distributing officers across shift slots, balance rank
// composition rather than dumping all of one rank onto one shift —
// rotates through officers grouped by rank in round-robin order.
function roundRobinByRank(officers) {
  const byRank = new Map();
  for (const officer of officers) {
    const key = officer.rankAndNumber?.split(" ")[0] || "unranked";
    if (!byRank.has(key)) byRank.set(key, []);
    byRank.get(key).push(officer);
  }
  const groups = Array.from(byRank.values());
  const ordered = [];
  let exhausted = false;
  let i = 0;
  while (!exhausted) {
    exhausted = true;
    for (const group of groups) {
      if (i < group.length) {
        ordered.push(group[i]);
        exhausted = false;
      }
    }
    i++;
  }
  return ordered;
}

/**
 * Generates a draft week of duty assignments for ONE branch's ONE shift
 * (day or night). Called once per (branch, shift) pair by the controller
 * to cover the whole week's plan.
 *
 * Rule (spec §6/§9/§10): permanent officers of the target branch are
 * used first. Any remaining shortfall is filled from the General Pool
 * branch, round-robinned by rank. Officers who belong to neither the
 * target branch nor the General Pool are not touched.
 *
 * @param {Object} params
 * @param {Date|string} params.weekStarting - Monday of the target week
 * @param {string} params.department - target branch for this roster
 * @param {"day"|"night"} params.shiftType
 * @param {number} params.requiredStaffing - officers needed per day for this shift
 * @param {Array} params.officers - ALL candidate officers station-wide [{ id, fullName, rankAndNumber, department }]
 * @param {Array} params.approvedLeaveRequests - [{ officerId, startDate, endDate }]
 * @param {Map<string, Set<string>>} [params.excludeByDate] - dateISO -> officerIds already
 *   committed elsewhere this week (another branch, or the other shift on the same day)
 * @returns {{ assignments: Array, unfilledDays: Array, excludedOfficerIds: Array }}
 */
function generateWeeklyRoster({
  weekStarting,
  department,
  shiftType = "day",
  requiredStaffing,
  officers,
  approvedLeaveRequests,
  excludeByDate = new Map(),
}) {
  const { start: shiftStart, end: shiftEnd } = SHIFTS[shiftType] || SHIFTS.day;
  const tracker = buildConsecutiveDayTracker();
  const assignments = [];
  const unfilledDays = [];
  const excludedOfficerIdsSet = new Set();

  const startDate = new Date(weekStarting);

  // Rule: eligible pool for this branch's roster is its own permanent
  // officers plus the General Pool branch — nobody else.
  const permanentOfficers = officers.filter((o) => o.department === department);
  const generalPoolOfficers = officers.filter((o) => isGeneralPoolBranch(o.department));

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayIndex);
    const dayName = DAYS_OF_WEEK[dayIndex];
    const dateKey = isoDate(date);
    const takenToday = excludeByDate.get(dateKey) || new Set();

    // Rule: leave officers, and officers already committed to another
    // branch/shift that same date, are excluded outright.
    const filterAvailable = (list) =>
      list.filter((officer) => {
        if (takenToday.has(officer.id)) return false;
        const onLeave = isOnLeave(officer, date, approvedLeaveRequests);
        if (onLeave) excludedOfficerIdsSet.add(officer.id);
        return !onLeave && tracker.canAssign(officer.id);
      });

    const availablePermanent = filterAvailable(permanentOfficers);
    const availableGeneralPool = filterAvailable(generalPoolOfficers);

    // Rule: fill from permanent branch officers first, balancing rank
    // via round-robin, then draw only the shortfall from the General Pool
    const orderedPermanent = roundRobinByRank(availablePermanent);
    const chosenPermanent = orderedPermanent.slice(0, requiredStaffing);

    const shortfall = requiredStaffing - chosenPermanent.length;
    const orderedGeneralPool = roundRobinByRank(availableGeneralPool);
    const chosenGeneralPool = shortfall > 0 ? orderedGeneralPool.slice(0, shortfall) : [];

    const chosenToday = [...chosenPermanent, ...chosenGeneralPool];

    if (chosenToday.length < requiredStaffing) {
      unfilledDays.push({ day: dayName, date, shiftType, shortfall: requiredStaffing - chosenToday.length });
    }

    const assignedIds = new Set(chosenToday.map((o) => o.id));
    for (const officer of [...permanentOfficers, ...generalPoolOfficers]) {
      if (assignedIds.has(officer.id)) {
        tracker.recordAssigned(officer.id);
        takenToday.add(officer.id);
      } else if (!takenToday.has(officer.id)) {
        tracker.recordDayOff(officer.id);
      }
    }
    excludeByDate.set(dateKey, takenToday);

    for (const officer of chosenPermanent) {
      assignments.push({
        officerId: officer.id,
        date,
        day: dayName,
        shiftType,
        shiftStart,
        shiftEnd,
        department,
        assignmentType: "PERMANENT",
        status: "pending", // Duty Officer reviews before submitting
      });
    }
    for (const officer of chosenGeneralPool) {
      assignments.push({
        officerId: officer.id,
        date,
        day: dayName,
        shiftType,
        shiftStart,
        shiftEnd,
        department,
        assignmentType: "GENERAL_POOL",
        status: "pending",
      });
    }
  }

  return {
    assignments,
    unfilledDays,
    excludedOfficerIds: Array.from(excludedOfficerIdsSet),
  };
}

/**
 * Suggests replacement officers when someone scheduled for a given day
 * becomes unavailable (e.g. reports sick).
 *
 * Ranking, in order:
 *   1. Same rank + same department + available + not already working that day
 *   2. Same department, any rank, available
 *   3. General Pool officers, available, not already working that day
 *      (spec §19 — the pool is the intended first fallback, ahead of
 *      pulling someone from an unrelated branch)
 *   4. Anyone available station-wide (flagged "overtime required" if
 *      they're already assigned a different shift that same day)
 *
 * @param {Object} params
 * @param {Object} params.unavailableOfficer - { id, rankAndNumber, department }
 * @param {Date|string} params.date
 * @param {Array} params.allOfficers
 * @param {Array} params.todaysAssignments - DutySchedule entries already on this date
 * @param {Array} params.approvedLeaveRequests
 * @param {number} [params.maxSuggestions=3]
 * @returns {Array<{ officer: Object, reasonCode: string, reasonLabel: string }>}
 */
function suggestReplacements({
  unavailableOfficer,
  date,
  allOfficers,
  todaysAssignments,
  approvedLeaveRequests,
  maxSuggestions = 3,
}) {
  const alreadyWorkingTodayIds = new Set(todaysAssignments.map((a) => String(a.officerId)));
  const sameRank = (o) => o.rankAndNumber?.split(" ")[0] === unavailableOfficer.rankAndNumber?.split(" ")[0];

  const candidates = allOfficers.filter((o) => {
    if (o.id === unavailableOfficer.id) return false;
    if (isOnLeave(o, date, approvedLeaveRequests)) return false;
    return true;
  });

  const tier1 = candidates.filter(
    (o) => sameRank(o) && o.department === unavailableOfficer.department && !alreadyWorkingTodayIds.has(String(o.id))
  );
  const tier2 = candidates.filter(
    (o) =>
      o.department === unavailableOfficer.department &&
      !alreadyWorkingTodayIds.has(String(o.id)) &&
      !tier1.includes(o)
  );
  const tier3 = candidates.filter(
    (o) =>
      isGeneralPoolBranch(o.department) &&
      !alreadyWorkingTodayIds.has(String(o.id)) &&
      !tier1.includes(o) &&
      !tier2.includes(o)
  );
  const tier4 = candidates.filter((o) => !tier1.includes(o) && !tier2.includes(o) && !tier3.includes(o));

  const suggestions = [];

  for (const officer of tier1) {
    if (suggestions.length >= maxSuggestions) break;
    suggestions.push({ officer, reasonCode: "same_rank_available", reasonLabel: "Available, Same Rank" });
  }
  for (const officer of tier2) {
    if (suggestions.length >= maxSuggestions) break;
    suggestions.push({ officer, reasonCode: "same_division_available", reasonLabel: "Available, Same Division" });
  }
  for (const officer of tier3) {
    if (suggestions.length >= maxSuggestions) break;
    suggestions.push({ officer, reasonCode: "general_pool_available", reasonLabel: "Available, General Pool" });
  }
  for (const officer of tier4) {
    if (suggestions.length >= maxSuggestions) break;
    const alreadyOnShift = alreadyWorkingTodayIds.has(String(officer.id));
    suggestions.push({
      officer,
      reasonCode: alreadyOnShift ? "overtime_required" : "available_station_wide",
      reasonLabel: alreadyOnShift ? "Available, Overtime Required" : "Available",
    });
  }

  return suggestions;
}

module.exports = {
  DAYS_OF_WEEK,
  generateWeeklyRoster,
  suggestReplacements,
  // exported for unit testing individual rules in isolation
  isOnLeave,
  buildConsecutiveDayTracker,
  roundRobinByRank,
};