import {
  getStatus,
  getHealth,
  getLogs,
  startScheduler,
  stopScheduler,
} from "./api.js";

const schedulerStatus = document.getElementById("scheduler-status");

const queueStatus = document.getElementById("queue-status");

const browserStatus = document.getElementById("browser-status");

const memoryStatus = document.getElementById("memory-status");

const uptimeStatus = document.getElementById("uptime-status");

const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");

function setLoading(button, loading) {
  button.disabled = loading;

  if (loading) {
    button.dataset.original = button.innerText;
    button.innerText = "Loading...";
  } else {
    button.innerText = button.dataset.original;
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours} jam ${minutes % 60} menit`;
}

async function loadStatus() {
  try {
    const status = await getStatus();

    schedulerStatus.innerText = status.running ? "🟢 RUNNING" : "🔴 STOPPED";

    schedulerStatus.className = status.running
      ? "status online"
      : "status offline";
  } catch (err) {
    console.error(err);
  }
}

async function loadHealth() {
  try {
    const health = await getHealth();

    queueStatus.innerText =
      `Running: ${health.queue.running} | ` +
      `Pending: ${health.queue.pending}`;

    browserStatus.innerText = `Active Contexts: ${health.browser.activeContexts}`;

    memoryStatus.innerText = formatBytes(health.memory.heapUsed);

    uptimeStatus.innerText = formatUptime(health.uptime);
  } catch (err) {
    console.error(err);
  }
}

async function refreshDashboard() {
  await Promise.all([loadStatus(), loadHealth()]);
}

startBtn.addEventListener("click", async () => {
  try {
    setLoading(startBtn, true);

    await startScheduler();

    await refreshDashboard();
  } catch (err) {
    alert(err.message);
  } finally {
    setLoading(startBtn, false);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    setLoading(stopBtn, true);

    await stopScheduler();

    await refreshDashboard();
  } catch (err) {
    alert(err.message);
  } finally {
    setLoading(stopBtn, false);
  }
});

refreshDashboard();

setInterval(refreshDashboard, 5000);
