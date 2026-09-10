import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import {
  dummyReportsSummary,
  dummyCrimeDistribution,
  dummyForceStrength,
  dummyActivityLog,
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

// params: { page?, limit?, type? } — type scopes paging to one category
// (used by the workbench); omit it for the hub's all-categories view.
export async function getActivityLog(params = {}) {
  if (USE_DUMMY_DATA) {
    const page = params.page || 1;
    const limit = params.limit || 10;
    const filtered = params.type ? dummyActivityLog.filter((l) => l.type === params.type) : dummyActivityLog;
    const start = (page - 1) * limit;
    return Promise.resolve({
      data: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      totalPages: Math.max(Math.ceil(filtered.length / limit), 1),
    });
  }
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page);
  if (params.limit) query.set("limit", params.limit);
  if (params.type) query.set("type", params.type);
  const qs = query.toString();
  return api.get(`/reports/activity-log${qs ? `?${qs}` : ""}`);
}

// POST /api/reports/preview — runs the same query as generateReport but
// doesn't persist a log entry. Lets the workbench show what a report will
// contain (summary + a capped table) before the officer commits to it.
// payload: { type, dateFrom, dateTo, filters? }
export async function previewReport(payload) {
  if (USE_DUMMY_DATA) {
    return Promise.resolve({ columns: [], rows: [], total: 0, truncated: false, summary: {} });
  }
  return api.post("/reports/preview", payload);
}

// POST /api/reports/generate — creates a new report export record.
// payload: { type, format, dateFrom, dateTo, title?, filters? }
export async function generateReport(payload) {
  if (USE_DUMMY_DATA) {
    const newLog = {
      id: `log${dummyActivityLog.length + 1}`,
      reportTitle: payload.title || payload.type,
      type: payload.type,
      generatedBy: "You",
      date: new Date().toISOString().slice(0, 10),
      status: "Complete",
    };
    dummyActivityLog.unshift(newLog);
    return Promise.resolve(newLog);
  }
  return api.post("/reports/generate", payload);
}

// Downloads and saves the file for a given report export record, using
// the browser's normal save-file flow (no page navigation needed).
export async function downloadReport(id, fallbackFilename = "report") {
  if (USE_DUMMY_DATA) {
    const blob = new Blob(["Dummy data mode has no underlying rows to export.\n"], { type: "text/csv" });
    triggerBrowserDownload(blob, `${fallbackFilename}.csv`);
    return;
  }
  const { blob, filename } = await api.getFile(`/reports/${id}/download`);
  triggerBrowserDownload(blob, filename);
}

function triggerBrowserDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// PATCH /api/reports/:id/archive
export async function archiveReport(id) {
  if (USE_DUMMY_DATA) {
    const log = dummyActivityLog.find((l) => l.id === id);
    if (log) log.status = "Archived";
    return Promise.resolve(log);
  }
  return api.patch(`/reports/${id}/archive`);
}

// DELETE /api/reports/:id
export async function deleteReport(id) {
  if (USE_DUMMY_DATA) {
    const idx = dummyActivityLog.findIndex((l) => l.id === id);
    if (idx !== -1) dummyActivityLog.splice(idx, 1);
    return Promise.resolve({ success: true });
  }
  return api.delete(`/reports/${id}`);
}