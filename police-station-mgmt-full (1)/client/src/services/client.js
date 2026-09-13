// Every call to our Node API goes through here so the auth token and
// base URL are handled in exactly one place.

// Exported (not just used internally) so notificationStream.js can build
// the SSE URL against the same base without duplicating the env lookup.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

function getToken() {
  return localStorage.getItem("token");
}

async function request(path, { method = "GET", body, skipAuth = false } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (!skipAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

// For multipart/form-data submissions (file uploads, e.g. a complaint's
// case-note attachments) — deliberately doesn't set a Content-Type
// header at all, unlike request() above: the browser fills that in
// itself with the correct multipart boundary once it sees the body is a
// FormData, and setting it manually breaks the upload.
async function requestFormData(path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

// For endpoints that return a file (PDF/CSV) instead of JSON — e.g. report
// downloads. Reads the filename off Content-Disposition so callers don't
// have to know the extension, and throws with a JSON error message when
// the server responds with a JSON error body instead of a file.
async function requestFile(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { headers });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not download file");
  }

  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "download";

  const blob = await response.blob();
  return { blob, filename };
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts = {}) => request(path, { method: "POST", body, ...opts }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
  getFile: (path) => requestFile(path),
  postForm: (path, formData) => requestFormData(path, formData),
};