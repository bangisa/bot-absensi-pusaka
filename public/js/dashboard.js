import {
  getStatus,
  getHealth,
  getDiagnostics,
  getAuditLogs,
  startScheduler,
  stopScheduler,
  getMaxConcurrentSetting,
  updateMaxConcurrent,
  getHolidayCalendarSetting,
  changeHolidayCalendar,
  getTimezoneSetting,
  updateTimezone,
  backupNow,
} from "./api.js";

const $ = (id) => document.getElementById(id);

const schedulerStatus = $("scheduler-status");
const schedulerDetail = $("scheduler-detail");
const dashboardMessage = $("dashboard-message");
const startBtn = $("start-btn");
const stopBtn = $("stop-btn");
const refreshBtn = $("refresh-dashboard");
const refreshAuditBtn = $("refresh-audit");
const maxConcurrentInput = $("max-concurrent-input");
const saveMaxConcurrentBtn = $("save-max-concurrent");
const maxConcurrentSource = $("max-concurrent-source");

let refreshInFlight = false;
let maxConcurrentDirty = false;
let dashboardTimeZone = null;

function showCalendarSetting(setting) {
  $("holiday-calendar-url").value = setting.url;
  $("holiday-setting-status").textContent = setting.enabled
    ? `Tersimpan: ${setting.year}, ${setting.count} tanggal (termasuk cuti bersama).`
    : "Menggunakan provider dari .env.";
}

function showTimezoneSetting(setting) {
  $("timezone-input").value = setting.value;
  $("timezone-setting-status").textContent = setting.restartRequired
    ? `Menunggu restart aplikasi: ${setting.value}. Aktif: ${setting.active}.`
    : `Aktif: ${setting.active}`;
}

async function calendarAction(method) {
  const buttons = [
    $("test-holiday-calendar"),
    $("save-holiday-calendar"),
    $("reset-holiday-calendar"),
  ];
  if (buttons.some((button) => button.disabled)) return;
  if (method !== "DELETE" && !$("holiday-calendar-url").reportValidity())
    return;
  if (
    method === "DELETE" &&
    !window.confirm(
      "Hapus kalender tersimpan dan kembali ke provider .env? Jadwal yang sudah ada tidak berubah.",
    )
  )
    return;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  $("holiday-setting-status").textContent = "Memeriksa...";
  try {
    const result = await changeHolidayCalendar(
      method,
      $("holiday-calendar-url").value,
    );
    if (method === "POST") {
      $("holiday-setting-status").textContent =
        `Valid: ${result.year}, ${result.count} tanggal. ${result.preview.map((item) => `${item.date}: ${item.name}`).join("; ")}`;
    } else {
      showCalendarSetting(result);
    }
  } catch (error) {
    $("holiday-setting-status").textContent = readableError(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function readableError(error) {
  try {
    return JSON.parse(error.message).error || error.message;
  } catch {
    return error.message;
  }
}

$("holiday-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  calendarAction("PUT");
});
$("test-holiday-calendar").addEventListener("click", () =>
  calendarAction("POST"),
);
$("reset-holiday-calendar").addEventListener("click", () =>
  calendarAction("DELETE"),
);
$("timezone-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("save-timezone");
  if (
    button.disabled ||
    !window.confirm(
      "Simpan timezone untuk restart berikutnya? Jadwal dan log lama tidak akan dikonversi.",
    )
  )
    return;
  button.disabled = true;
  try {
    showTimezoneSetting(await updateTimezone($("timezone-input").value));
  } catch (error) {
    $("timezone-setting-status").textContent = readableError(error);
  } finally {
    button.disabled = false;
  }
});

getHolidayCalendarSetting()
  .then(showCalendarSetting)
  .catch((error) => {
    $("holiday-setting-status").textContent = readableError(error);
  });
getTimezoneSetting()
  .then(showTimezoneSetting)
  .catch((error) => {
    $("timezone-setting-status").textContent = readableError(error);
  });

function setLoading(button, loading, label) {
  button.disabled = loading;
  button.textContent = loading ? "Memproses..." : label;
}

function showMessage(message, type = "info") {
  dashboardMessage.textContent = message;
  dashboardMessage.hidden = false;
  dashboardMessage.className = `notice ${type === "error" ? "notice-error" : "notice-info"}`;
}

function hideMessage() {
  dashboardMessage.hidden = true;
  dashboardMessage.textContent = "";
}

function formatDuration(seconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
}

function formatDateTime(value) {
  if (!value) return "-";

  const normalized =
    typeof value === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(value)
      ? value.replace(" ", "T") + "+07:00"
      : value;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTimeOnly(value) {
  if (!value) return "-";
  const normalized =
    typeof value === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(value)
      ? value.replace(" ", "T") + "+07:00"
      : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMb(value) {
  if (value == null) return "-";
  return `${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
}

function formatMs(value) {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} dtk`;
}

function statusClass(status) {
  const value = String(status || "").toUpperCase();
  if (value === "HEALTHY" || value === "RUNNING") return "status-healthy";
  if (value === "DEGRADED" || value === "DRAINING") return "status-degraded";
  if (value === "UNHEALTHY" || value === "FAILED" || value === "STOPPED")
    return "status-unhealthy";
  return "status-neutral";
}

function setMiniStatus(element, status, label = status) {
  element.textContent = label || "-";
  element.className = `mini-status ${statusClass(status)}`;
}

function renderScheduler(status, health) {
  const running = Boolean(status.running);
  const schedulerCheck = health.checks?.scheduler ?? {};

  setMiniStatus(schedulerStatus, running ? "RUNNING" : "STOPPED");
  schedulerDetail.textContent = running
    ? `${status.totalJobs ?? 0} job aktif`
    : "Scheduler berhenti";
  $("generator-status").textContent = schedulerCheck.generator?.running
    ? "Running"
    : "Stopped";
  $("scheduler-last-tick").textContent = formatDateTime(
    schedulerCheck.lastTickAt,
  );
  $("uptime-status").textContent = formatDuration(health.uptimeSeconds);

  startBtn.hidden = running;
  stopBtn.hidden = !running;
}

function renderToday(diagnostics) {
  const today = diagnostics.dailySchedules ?? {};
  $("today-success").textContent = today.success ?? 0;
  $("today-pending").textContent = today.pending ?? 0;
  $("today-processing").textContent = today.processing ?? 0;
  $("today-retry").textContent = today.retry?.waiting ?? 0;
  $("today-failed").textContent = today.failed ?? 0;
  $("today-skipped").textContent = today.skipped ?? 0;
  $("retry-next").textContent = today.retry?.nextRetryAt
    ? `Next ${formatTimeOnly(today.retry.nextRetryAt)}`
    : "Tidak ada retry";
}

function renderLifecycle(health, diagnostics) {
  const lifecycle = health.lifecycle ?? {};
  const draining = lifecycle.state === "DRAINING";
  const banner = $("lifecycle-banner");
  banner.hidden = !draining;

  if (!draining) return;

  const drain = diagnostics.drain ?? {};
  $("lifecycle-title").textContent = "Full-drain shutdown sedang berlangsung";
  $("lifecycle-detail").textContent =
    "Sistem akan mati setelah seluruh queue, retry, dan browser context benar-benar kosong.";
  $("drain-running").textContent = drain.queue?.running ?? 0;
  $("drain-pending").textContent = drain.queue?.pending ?? 0;
  $("drain-retry").textContent = drain.database?.retryPending ?? 0;
  $("drain-contexts").textContent = drain.browser?.activeContexts ?? 0;
}

function renderMaxConcurrentSetting(setting) {
  if (!setting || !maxConcurrentInput) return;

  if (!maxConcurrentDirty) {
    maxConcurrentInput.value = String(setting.value);
  }

  const sourceLabel =
    setting.source === "runtime"
      ? "Runtime setting tersimpan"
      : `Default .env (${setting.envDefault ?? setting.value})`;

  maxConcurrentSource.textContent = sourceLabel;
}

function renderExecution(health) {
  const queue = health.checks?.queue ?? {};
  const browser = health.checks?.browser ?? {};

  $("queue-running").textContent = queue.running ?? 0;
  $("queue-pending").textContent = queue.pending ?? 0;
  $("queue-capacity").textContent =
    `${queue.running ?? 0}/${queue.maxConcurrent ?? 0}`;
  $("browser-status").textContent = browser.connected
    ? "Connected"
    : "Idle / Closed";
  $("browser-contexts").textContent = browser.activeContexts ?? 0;
  $("browser-pages").textContent = browser.pageCount ?? 0;
  setMiniStatus(
    $("execution-health"),
    queue.status === "DEGRADED" || browser.status === "DEGRADED"
      ? "DEGRADED"
      : "HEALTHY",
  );
}

function renderBackup(health) {
  const backup = health.checks?.databaseBackup ?? {};
  setMiniStatus($("backup-health"), backup.status);
  $("backup-last").textContent = formatDateTime(backup.lastSuccessAt);
  $("backup-duration").textContent = formatMs(backup.lastDurationMs);
  $("backup-retention").textContent = `${backup.retentionCount ?? "-"} backup`;
  $("backup-running").textContent = backup.backupRunning
    ? "Backup berjalan"
    : backup.enabled
      ? "Terjadwal"
      : "Disabled";
}

function renderHoliday(health) {
  const holiday = health.checks?.holidayProvider ?? {};
  const hasHolidayCheck = holiday.available != null;

  setMiniStatus($("holiday-health"), holiday.status);
  $("holiday-source").textContent = holiday.source ?? "Belum ada";
  $("holiday-available").textContent = hasHolidayCheck
    ? holiday.available
      ? "Ya"
      : "Tidak"
    : "Belum dicek";

  if (!hasHolidayCheck) {
    $("holiday-status").textContent = "Belum dicek";
    $("holiday-name").textContent =
      holiday.note ?? "Belum ada hasil holiday check pada generator terakhir";
    return;
  }

  $("holiday-status").textContent =
    holiday.isHoliday === true
      ? "Hari Libur"
      : holiday.isHoliday === false
        ? "Hari kerja"
        : "Tidak diketahui";
  $("holiday-name").textContent = holiday.name ?? holiday.note ?? "-";
}

function renderCore(health) {
  const checks = health.checks ?? {};
  const coreStatuses = [
    checks.database?.status,
    checks.credentialVault?.status,
    checks.logging?.status,
  ];
  const worst = coreStatuses.includes("UNHEALTHY")
    ? "UNHEALTHY"
    : coreStatuses.includes("DEGRADED")
      ? "DEGRADED"
      : "HEALTHY";

  setMiniStatus($("core-health"), worst);
  $("database-status").textContent =
    `${checks.database?.status ?? "-"} · ${checks.database?.latencyMs ?? "-"} ms`;
  $("vault-status").textContent = checks.credentialVault?.keyAvailable
    ? "Ready"
    : "Missing";
  $("logging-status").textContent = checks.logging?.writable
    ? "Writable"
    : "Read only";
  $("memory-status").textContent = checks.memory
    ? `${checks.memory.systemUsedPercent}% · RSS ${checks.memory.rssMb} MB`
    : "-";
  $("disk-status").textContent = checks.disk?.available
    ? formatMb(checks.disk.freeMb)
    : "Unavailable";
  $("timezone-status").textContent = health.timezone ?? "-";
}

function renderAutomation(health) {
  const automation = health.checks?.automation ?? {};
  $("last-success-type").textContent = automation.lastSuccessType ?? "-";
  $("last-success-at").textContent = automation.lastSuccessAt
    ? formatDateTime(automation.lastSuccessAt)
    : "Belum ada data";
  $("last-failure-type").textContent = automation.lastFailureType ?? "-";
  $("last-failure-at").textContent = automation.lastFailureAt
    ? formatDateTime(automation.lastFailureAt)
    : "Belum ada data";
  $("recent-failures").textContent =
    automation.recentFailuresLast60Minutes ?? 0;
}

function renderAudit(logs = []) {
  const container = $("audit-list");
  container.replaceChildren();

  const items = Array.isArray(logs) ? logs.slice(0, 6) : [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Belum ada aktivitas audit.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "activity-item";

    const marker = document.createElement("span");
    marker.className = `activity-marker ${item.status === "failed" ? "failed" : "success"}`;

    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.action ?? "activity";
    const meta = document.createElement("small");
    meta.textContent = `${formatDateTime(item.created_at)} · ${item.actor ?? "local-api"}`;
    body.append(title, meta);

    row.append(marker, body);
    container.appendChild(row);
  }
}

function updateClock() {
  if (!dashboardTimeZone) return;
  const now = new Date();
  $("current-date").textContent = now.toLocaleDateString("id-ID", {
    timeZone: dashboardTimeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const labels = {
    "Asia/Jakarta": "WIB",
    "Asia/Pontianak": "WIB",
    "Asia/Makassar": "WITA",
    "Asia/Ujung_Pandang": "WITA",
    "Asia/Jayapura": "WIT",
  };
  $("current-timezone").textContent =
    labels[dashboardTimeZone] ?? dashboardTimeZone;
  $("current-time").textContent = now.toLocaleTimeString("id-ID", {
    timeZone: dashboardTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

$("backup-now").addEventListener("click", async () => {
  const button = $("backup-now");
  if (button.disabled) return;
  setLoading(button, true, "Backup Sekarang");
  $("backup-now-status").textContent = "Membuat backup...";
  try {
    await backupNow();
    $("backup-now-status").textContent = "Backup berhasil.";
    await refreshDashboard();
  } catch (error) {
    $("backup-now-status").textContent = readableError(error);
  } finally {
    setLoading(button, false, "Backup Sekarang");
  }
});

async function refreshDashboard({ includeAudit = false } = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  refreshBtn.disabled = true;
  $("refresh-status").textContent = "Memperbarui...";

  try {
    const requests = [
      getStatus(),
      getHealth(),
      getDiagnostics(),
      getMaxConcurrentSetting(),
    ];
    if (includeAudit) requests.push(getAuditLogs());

    const [status, health, diagnostics, maxConcurrentSetting, auditLogs] =
      await Promise.all(requests);

    if (health.timezone) {
      new Intl.DateTimeFormat("id-ID", { timeZone: health.timezone });
      dashboardTimeZone = health.timezone;
      updateClock();
    }
    renderScheduler(status, health);
    renderToday(diagnostics);
    renderLifecycle(health, diagnostics);
    renderExecution(health);
    renderMaxConcurrentSetting(maxConcurrentSetting);
    renderBackup(health);
    renderHoliday(health);
    renderCore(health);
    renderAutomation(health);
    if (includeAudit) renderAudit(auditLogs);

    $("refresh-status").textContent = dashboardTimeZone
      ? `Terakhir diperbarui ${new Date().toLocaleTimeString("id-ID", { timeZone: dashboardTimeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
      : "Terakhir diperbarui; timezone belum tersedia";
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Gagal memuat dashboard", "error");
    $("refresh-status").textContent = "Gagal memperbarui";
  } finally {
    refreshInFlight = false;
    refreshBtn.disabled = false;
  }
}

startBtn.addEventListener("click", async () => {
  try {
    hideMessage();
    setLoading(startBtn, true, "Start Scheduler");
    await startScheduler();
    showMessage("Scheduler aktif.");
    await refreshDashboard();
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Scheduler gagal dijalankan", "error");
  } finally {
    setLoading(startBtn, false, "Start Scheduler");
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    hideMessage();
    setLoading(stopBtn, true, "Stop Scheduler");
    await stopScheduler();
    showMessage("Scheduler berhenti.");
    await refreshDashboard();
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Scheduler gagal dihentikan", "error");
  } finally {
    setLoading(stopBtn, false, "Stop Scheduler");
  }
});

refreshBtn.addEventListener("click", () =>
  refreshDashboard({ includeAudit: true }),
);
refreshAuditBtn.addEventListener("click", async () => {
  try {
    refreshAuditBtn.disabled = true;
    renderAudit(await getAuditLogs());
  } catch (err) {
    console.error(err);
  } finally {
    refreshAuditBtn.disabled = false;
  }
});

maxConcurrentInput?.addEventListener("change", () => {
  maxConcurrentDirty = true;
});

saveMaxConcurrentBtn?.addEventListener("click", async () => {
  try {
    hideMessage();
    setLoading(saveMaxConcurrentBtn, true, "Simpan");

    const value = Number(maxConcurrentInput.value);
    const result = await updateMaxConcurrent(value);

    maxConcurrentDirty = false;
    renderMaxConcurrentSetting({
      ...result,
      source: "runtime",
    });

    showMessage(
      `MAX_CONCURRENT diperbarui menjadi ${result.value}. Job aktif tidak dibatalkan; perubahan berlaku untuk pengambilan job berikutnya.`,
    );

    await refreshDashboard({ includeAudit: true });
  } catch (err) {
    console.error(err);
    showMessage(err.message || "Gagal memperbarui MAX_CONCURRENT", "error");
  } finally {
    setLoading(saveMaxConcurrentBtn, false, "Simpan");
  }
});

updateClock();
setInterval(updateClock, 1000);
refreshDashboard({ includeAudit: true });
setInterval(() => refreshDashboard(), 5000);
setInterval(async () => {
  try {
    renderAudit(await getAuditLogs());
  } catch (err) {
    console.error(err);
  }
}, 30000);
