import { getCsrfToken } from "./auth-ui.js";

const API_BASE = "/api/system";
const USER_API = "/api/users";

async function request(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
  });

  if (response.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
    throw new Error("Authentication required");
  }

  if (!response.ok) {
    const text = await response.text();

    throw new Error(text || "Request failed");
  }

  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function getStatus() {
  return request(`${API_BASE}/status`);
}

async function getHealth() {
  return request(`${API_BASE}/health`);
}

async function getDiagnostics() {
  return request(`${API_BASE}/diagnostics`);
}

async function getAuditLogs() {
  return request(`${API_BASE}/audit-logs`);
}

async function getLogs() {
  return request(`${API_BASE}/logs`);
}

async function startScheduler() {
  return request(`${API_BASE}/scheduler/start`, {
    method: "POST",
  });
}

async function stopScheduler() {
  return request(`${API_BASE}/scheduler/stop`, {
    method: "POST",
  });
}

async function getMaxConcurrentSetting() {
  return request(`${API_BASE}/settings/max-concurrent`);
}

async function updateMaxConcurrent(value) {
  return request(`${API_BASE}/settings/max-concurrent`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

async function getUsers() {
  return request(USER_API);
}

async function getHolidayCalendarSetting() {
  return request(`${API_BASE}/settings/holiday-calendar`);
}

async function changeHolidayCalendar(method, url) {
  return request(`${API_BASE}/settings/holiday-calendar${method === "POST" ? "/test" : ""}`, {
    method,
    body: method === "DELETE" ? undefined : JSON.stringify({ url }),
  });
}

async function getTimezoneSetting() {
  return request(`${API_BASE}/settings/timezone`);
}

async function updateTimezone(value) {
  return request(`${API_BASE}/settings/timezone`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

async function createUser(data) {
  return request(USER_API, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function deleteUser(id) {
  return request(`${USER_API}/${id}`, {
    method: "DELETE",
  });
}

async function updateUser(id, data) {
  return request(`${USER_API}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

async function backupNow() {
  return request(`${API_BASE}/backup`, { method: "POST" });
}

export {
  backupNow,
  updateUser,
  getHolidayCalendarSetting,
  changeHolidayCalendar,
  getTimezoneSetting,
  updateTimezone,
  getStatus,
  getHealth,
  getDiagnostics,
  getAuditLogs,
  getLogs,
  startScheduler,
  stopScheduler,
  getMaxConcurrentSetting,
  updateMaxConcurrent,
  getUsers,
  createUser,
  deleteUser,
};
