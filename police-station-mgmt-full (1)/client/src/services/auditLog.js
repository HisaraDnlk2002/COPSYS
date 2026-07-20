import { api } from "./client";

export async function getAuditLogs() {
  return api.get("/audit-logs");
}
