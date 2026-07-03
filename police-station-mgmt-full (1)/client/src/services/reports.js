import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import {
  dummyReportsSummary,
  dummyCrimeDistribution,
  dummyForceStrength,
  dummyActivityLog,
  dummyReportEngineSections,
} from "./dummyData";

export async function getReportsSummary() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyReportsSummary);
  }
  return api.get("/reports/summary");
}

export async function getCrimeDistribution() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyCrimeDistribution);
  }
  return api.get("/reports/crime-distribution");
}

export async function getForceStrength() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyForceStrength);
  }
  return api.get("/reports/force-strength");
}

export async function getActivityLog() {
  if (USE_DUMMY_DATA) {
    return Promise.resolve(dummyActivityLog);
  }
  return api.get("/reports/activity-log");
}

// Sidebar report shortcuts — purely a UI grouping, not backed by a real
// endpoint yet (no per-report generation built server-side).
export function getReportEngineSections() {
  return dummyReportEngineSections;
}