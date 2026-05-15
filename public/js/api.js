const API_BASE = "/api/system";
const USER_API = "/api/users";

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

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

async function getUsers() {
  return request(USER_API);
}

async function createUser(data) {
  return request(USER_API, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function updateUser(id, data) {
  return request(`${USER_API}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async function deleteUser(id) {
  return request(`${USER_API}/${id}`, {
    method: "DELETE",
  });
}

export {
  getStatus,
  getHealth,
  getLogs,
  startScheduler,
  stopScheduler,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
};
