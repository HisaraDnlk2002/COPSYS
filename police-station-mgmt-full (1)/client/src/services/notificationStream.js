import { API_BASE_URL } from "./client";
import { USE_DUMMY_DATA } from "./config";

// Opens the live-push half of the notification bell (see
// server/src/routes/notificationStreamRoutes.js and utils/sseHub.js).
// Returns null in dummy-data mode (no real server to connect to) or if
// there's no token yet — callers must handle that.
//
// EventSource reconnects on its own after a drop (with the browser's
// default backoff) — callers don't need to hand-roll retry logic, only
// call .close() on cleanup (e.g. NotificationBell.jsx's effect teardown).
export function openNotificationStream() {
  if (USE_DUMMY_DATA) return null;
  const token = localStorage.getItem("token");
  if (!token) return null;
  return new EventSource(`${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`);
}
