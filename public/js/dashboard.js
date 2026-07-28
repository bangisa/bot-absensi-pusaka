import { getStatus, getHealth, startScheduler, stopScheduler } from "./api.js";

const schedulerStatus = document.getElementById("scheduler-status");
const schedulerDetail = document.getElementById("scheduler-detail");
const generatorStatus = document.getElementById("generator-status");
const generatorDetail = document.getElementById("generator-detail");
const queueStatus = document.getElementById("queue-status");
const queueDetail = document.getElementById("queue-detail");
const browserStatus = document.getElementById("browser-status");
const browserDetail = document.getElementById("browser-detail");
const memoryStatus = document.getElementById("memory-status");
const memoryDetail = document.getElementById("memory-detail");
const totalUsersStatus = document.getElementById("total-users-status");
const totalUsersDetail = document.getElementById("total-users-detail");
const masukSchedulesStatus = document.getElementById("masuk-schedules-status");
const masukSchedulesDetail = document.getElementById("masuk-schedules-detail");
const pulangSchedulesStatus = document.getElementById("pulang-schedules-status");
const pulangSchedulesDetail = document.getElementById("pulang-schedules-detail");
const uptimeStatus = document.getElementById("uptime-status");
const uptimeDetail = document.getElementById("uptime-detail");
const dashboardMessage = document.getElementById("dashboard-message");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");

function setLoading(button, loading, label) {
  button.disabled = loading;
  button.textContent = loading ? "Memproses..." : label;
}

function showMessage(message, type = "info") {
  dashboardMessage.textContent = message;
  dashboardMessage.hidden = false;
  dashboardMessage.style.background = type === "error" ? "rgba(239, 68, 68, 0.14)" : "rgba(59, 130, 246, 0.14)";
  dashboardMessage.style.color = type === "error" ? "#f87171" : "#60a5fa";
}

function hideMessage() {
  dashboardMessage.hidden = true;
  dashboardMessage.textContent = "";
}

function formatBytes(bytes = 0) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} hari ${hours} jam`;
  }

  if (hours > 0) {
    return `${hours} jam ${minutes} menit`;
  }

  return `${minutes} menit`;
}

function formatDateTime(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderScheduler(status) {
  const running = Boolean(status.running);

  schedulerStatus.textContent = running ? "RUNNING" : "STOPPED";
  schedulerStatus.className = running ? "status-pill online" : "status-pill offline";
  schedulerDetail.textContent = running ? `${status.totalJobs ?? 0} job` : "Berhenti";
}

function renderScheduleCard(summary, statusElement, detailElement) {
  const processing = summary?.processing ?? 0;
  const pending = summary?.pending ?? 0;

  statusElement.textContent = processing;
  detailElement.textContent = `Diproses ${processing}, pending ${pending}`;
}

function renderHealth(health) {
  const generator = health.generator ?? {};
  const queue = health.queue ?? {};
  const browser = health.browser ?? {};
  const memory = health.memory ?? {};
  const botMemory = health.botMemory ?? {};
  const scheduleSummary = health.dailySchedules?.summary ?? {};

  generatorStatus.textContent = generator.healthy ? "Sehat" : "Perlu cek";
  generatorDetail.textContent = `Terakhir: ${formatDateTime(generator.lastRunAt)}`;

  queueStatus.textContent = `${queue.running ?? 0}/${queue.maxConcurrent ?? 0} aktif`;
  queueDetail.textContent = `Antrean ${queue.pending ?? 0}`;

  browserStatus.textContent = browser.connected ? "Connected" : "Idle";
  browserDetail.textContent = `Context aktif ${browser.activeContexts ?? 0}`;

  memoryStatus.textContent = formatBytes(botMemory.totalRss ?? memory.rss ?? 0);
  memoryDetail.textContent = `Node ${formatBytes(botMemory.nodeRss ?? memory.rss ?? 0)}, browser ${formatBytes(botMemory.browserRss ?? 0)}, lain ${formatBytes(botMemory.otherRss ?? 0)}`;

  totalUsersStatus.textContent = health.users?.total ?? 0;
  totalUsersDetail.textContent = "Terdaftar";

  renderScheduleCard(scheduleSummary.masuk, masukSchedulesStatus, masukSchedulesDetail);
  renderScheduleCard(scheduleSummary.pulang, pulangSchedulesStatus, pulangSchedulesDetail);

  uptimeStatus.textContent = formatDuration(health.uptime);
  uptimeDetail.textContent = browser.launchedAt
    ? `Browser aktif ${formatDuration((browser.uptime ?? 0) / 1000)}`
    : "Browser idle";
}

async function refreshDashboard() {
  try {
    const [status, health] = await Promise.all([getStatus(), getHealth()]);

    renderScheduler(status);
    renderHealth(health);
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Gagal memuat dashboard", "error");
  }
}

startBtn.addEventListener("click", async () => {
  try {
    hideMessage();
    setLoading(startBtn, true, "Start");
    await startScheduler();
    showMessage("Scheduler aktif.");
    await refreshDashboard();
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Scheduler gagal dijalankan", "error");
  } finally {
    setLoading(startBtn, false, "Start");
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    hideMessage();
    setLoading(stopBtn, true, "Stop");
    await stopScheduler();
    showMessage("Scheduler berhenti.");
    await refreshDashboard();
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Scheduler gagal dihentikan", "error");
  } finally {
    setLoading(stopBtn, false, "Stop");
  }
});

refreshDashboard();
setInterval(refreshDashboard, 5000);
