import {
  getStatus,
  getApiErrorMessage,
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
  restartForTimezone,
  getOperationalSettings,
  updateOperationalSettings,
  backupNow,
  getScheduleRanges,
  updateScheduleRanges,
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
let restartInProgress = false;
let timezoneRestartWaiting = false;
let timezoneChangeLocked = false;
let timezoneDirty = false;
let timezoneSaving = false;

$("timezone-input").addEventListener("change", () => { timezoneDirty = true; });

const scheduleRangeKeys = ["masuk", "pulang", "friday", "saturday"];
const scheduleRangeFields = $("schedule-ranges-fields");
let scheduleRangesSaving = false;

function showScheduleRanges(ranges) {
  for (const key of scheduleRangeKeys) {
    for (const boundary of ["start", "end"]) {
      $(`range-${key}-${boundary}`).value = ranges[key][boundary];
    }
  }
}

getScheduleRanges().then(ranges => {
  showScheduleRanges(ranges);
  scheduleRangeFields.disabled = false;
  $("schedule-ranges-status").textContent = "";
}).catch(error => {
  $("schedule-ranges-status").textContent = readableError(error);
});

$("schedule-ranges-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (scheduleRangesSaving || scheduleRangeFields.disabled) return;
  const ranges = {};
  for (const key of scheduleRangeKeys) {
    const start = $(`range-${key}-start`).value;
    const end = $(`range-${key}-end`).value;
    if (!start || !end || start >= end) {
      $("schedule-ranges-status").textContent = "Waktu mulai harus lebih awal daripada waktu akhir.";
      return;
    }
    ranges[key] = { start, end };
  }
  const applyPendingToday = $("schedule-apply-pending").checked;
  if (applyPendingToday && !window.confirm("Sesuaikan jadwal pending hari ini yang berada di luar rentang baru? Task yang sudah mulai, retry, dan rentang yang sudah lewat tidak diubah.")) return;
  scheduleRangesSaving = true;
  scheduleRangeFields.disabled = true;
  $("schedule-ranges-status").textContent = "Menyimpan...";
  try {
    const result = await updateScheduleRanges(ranges, applyPendingToday);
    showScheduleRanges(result.ranges);
    $("schedule-apply-pending").checked = false;
    $("schedule-ranges-status").textContent = result.pending
      ? `Tersimpan. ${result.pending.updated} jadwal diperbarui, ${result.pending.unchanged} sudah sesuai, ${result.pending.elapsed} melewati rentang. Tanpa restart.`
      : "Tersimpan. Berlaku untuk jadwal baru, tanpa restart.";
  } catch (error) {
    $("schedule-ranges-status").textContent = readableError(error);
  } finally {
    scheduleRangesSaving = false;
    scheduleRangeFields.disabled = false;
  }
});

function showOperationalSettings(setting) {
  $("geo-radius-input").value = setting.geoRadiusMeters;
  $("backup-enabled-input").checked = setting.backupEnabled;
  $("backup-retention-input").value = setting.backupRetentionCount;
  const retention = $("log-retention-input");
  retention.querySelector('[data-legacy]')?.remove();
  if (![3, 7].includes(setting.logRetentionDays)) {
    const option = new Option(`${setting.logRetentionDays} Hari (tersimpan)`, String(setting.logRetentionDays));
    option.dataset.legacy = "true";
    option.disabled = true;
    retention.add(option);
  }
  retention.value = String(setting.logRetentionDays);
}

getOperationalSettings().then((setting) => {
  showOperationalSettings(setting);
  $("save-operational").disabled = false;
  $("operational-setting-status").textContent = "";
}).catch((error) => {
  $("operational-setting-status").textContent = readableError(error);
});

$("operational-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("save-operational");
  if (button.disabled) return;
  if (!window.confirm("Simpan pengaturan? Retensi yang lebih pendek akan menghapus data lama pada proses cleanup atau backup berikutnya.")) return;
  button.disabled = true;
  try {
    showOperationalSettings(await updateOperationalSettings({
      geoRadiusMeters: $("geo-radius-input").valueAsNumber,
      backupEnabled: $("backup-enabled-input").checked,
      backupRetentionCount: $("backup-retention-input").valueAsNumber,
      logRetentionDays: Number($("log-retention-input").value),
    }));
    $("operational-setting-status").textContent = "Tersimpan. Berlaku untuk proses berikutnya, tanpa restart.";
    await refreshDashboard();
  } catch (error) {
    $("operational-setting-status").textContent = readableError(error);
  } finally {
    button.disabled = false;
  }
});

function showCalendarSetting(setting) {
  $("holiday-calendar-url").value = setting.url;
  $("holiday-setting-status").textContent = setting.enabled
    ? `Tersimpan: ${setting.year}, ${setting.count} tanggal (termasuk cuti bersama).`
    : "Gunakan tautan data JSON, misalnya https://domain/api/holidays/2026.json.";
}

function showTimezoneSetting(setting) {
  timezoneChangeLocked = Boolean(setting.pendingRestart || setting.retryAfterSeconds > 0);
  if (timezoneChangeLocked || (!timezoneDirty && !timezoneSaving)) {
    $("timezone-input").value = setting.value;
    if (timezoneChangeLocked) timezoneDirty = false;
  }
  $("restart-timezone").hidden = !setting.restartRequired || setting.pendingRestart;
  $("timezone-input").disabled = timezoneChangeLocked || timezoneSaving;
  $("save-timezone").disabled = timezoneChangeLocked || timezoneSaving;
  $("restart-timezone").disabled = timezoneChangeLocked;
  $("timezone-restart-banner").hidden = !setting.pendingRestart;
  if (setting.pendingRestart) {
    timezoneRestartWaiting = true;
    $("dashboard-message").hidden = true;
    $("timezone-restart-detail").textContent = `Aplikasi akan restart ke ${setting.value} setelah pekerjaan selesai. Generator berhenti; ${setting.remainingSchedules ?? 0} jadwal tersisa diproses dengan timezone ${setting.active}, termasuk jadwal yang belum jatuh tempo dan retry.`;
    startBtn.disabled = true;
    stopBtn.disabled = true;
  }
  $("timezone-setting-status").textContent = setting.restartRequired
    ? `Menunggu pekerjaan selesai dan restart ke ${setting.value}. Aktif: ${setting.active}.`
    : setting.retryAfterSeconds > 0
      ? `Aktif: ${setting.active}. Dapat diubah lagi setelah ${new Date(setting.cooldownUntil).toLocaleString("id-ID", { timeZone: setting.active })}.`
      : `Aktif: ${setting.active}`;
}

async function confirmTimezoneRestart() {
  if (!window.confirm("Hentikan generator dan restart otomatis setelah jadwal serta retry selesai? Timezone lama tetap aktif hingga pekerjaan selesai.")) return;
  const button = $("restart-timezone");
  if (button.disabled) return;
  button.disabled = true;
  try {
    showTimezoneSetting(await restartForTimezone());
  } catch (error) {
    restartInProgress = false;
    $("restart-screen").hidden = true;
    document.querySelector('.dashboard-v2').inert = false;
    $("timezone-setting-status").textContent = readableError(error);
    button.disabled = false;
  }
}

function showRestartWaitingScreen() {
  if (restartInProgress) return;
  restartInProgress = true;
  $("restart-screen").hidden = false;
  document.querySelector('.dashboard-v2').inert = true;
  $("restart-screen").focus();
  void waitForRestart();
}

async function waitForRestart() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      const response = await fetch('/api/system/settings/timezone', {
        cache: 'no-store', signal: AbortSignal.timeout(2500),
      });
      if (response.status === 401) {
        window.location.replace('/login?next=%2Fdashboard.html');
        return;
      }
      if (response.ok && !(await response.json()).restartRequired) {
        window.location.replace('/dashboard.html');
        return;
      }
    } catch {
      // Connection failures are expected while PM2 restarts the process.
    }
  }
  $("restart-progress").textContent = "Aplikasi belum siap. Coba muat ulang atau hubungi administrator.";
  $("restart-reload").hidden = false;
}

$("restart-timezone").addEventListener("click", confirmTimezoneRestart);

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
  return getApiErrorMessage(error);
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
  const selectedTimezone = $("timezone-input").value;
  if (
    button.disabled ||
    !window.confirm(
      `Ubah timezone ke ${selectedTimezone} dan restart otomatis setelah seluruh jadwal serta retry selesai? Setelah diterima, timezone tidak dapat diubah lagi selama 24 jam. Generator akan berhenti; timezone lama tetap dipakai sampai pekerjaan selesai. Setelah restart, scheduler mengikuti AUTO_START.`,
    )
  )
    return;
  timezoneSaving = true;
  button.disabled = true;
  $("timezone-input").disabled = true;
  try {
    const setting = await updateTimezone(selectedTimezone);
    timezoneDirty = false;
    showTimezoneSetting(setting);
  } catch (error) {
    $("timezone-setting-status").textContent = readableError(error);
  } finally {
    timezoneSaving = false;
    $("timezone-input").disabled = timezoneChangeLocked;
    button.disabled = timezoneRestartWaiting || timezoneChangeLocked;
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
  if (type === "error") message = getApiErrorMessage({ message });
  if (!message) { dashboardMessage.hidden = true; return; }
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
  if (draining && timezoneRestartWaiting) showRestartWaitingScreen();
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
  $("last-success-type").textContent = automation.lastSuccessType
    ? `${automation.lastSuccessType} - ${automation.lastSuccessNickname || "-"}`
    : "-";
  $("last-success-at").textContent = automation.lastSuccessAt
    ? formatDateTime(automation.lastSuccessAt)
    : "Belum ada data";
  $("last-failure-type").textContent = automation.lastFailureType
    ? `${automation.lastFailureType} - ${automation.lastFailureNickname || "-"}`
    : "-";
  $("last-failure-at").textContent = automation.lastFailureAt
    ? formatDateTime(automation.lastFailureAt)
    : "Belum ada data";
  $("recent-failures").textContent =
    automation.failuresToday ?? 0;
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
  if (refreshInFlight || restartInProgress) return;
  refreshInFlight = true;
  refreshBtn.disabled = true;
  $("refresh-status").textContent = "Memperbarui...";

  try {
    const requests = [
      getStatus(),
      getHealth(),
      getDiagnostics(),
      getMaxConcurrentSetting(),
      getTimezoneSetting(),
    ];
    if (includeAudit) requests.push(getAuditLogs());

    const [status, health, diagnostics, maxConcurrentSetting, timezoneSetting, auditLogs] =
      await Promise.all(requests);

    if (health.timezone) {
      new Intl.DateTimeFormat("id-ID", { timeZone: health.timezone });
      dashboardTimeZone = health.timezone;
      updateClock();
    }
    renderScheduler(status, health);
    showTimezoneSetting(timezoneSetting);
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
    if (timezoneRestartWaiting && !err.silent) {
      showRestartWaitingScreen();
      return;
    }
    showMessage(readableError(err), "error");
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
    showMessage(readableError(err), "error");
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
    showMessage(readableError(err), "error");
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
    showMessage(readableError(err), "error");
  } finally {
    setLoading(saveMaxConcurrentBtn, false, "Simpan");
  }
});

updateClock();
setInterval(updateClock, 1000);
refreshDashboard({ includeAudit: true });
setInterval(() => refreshDashboard(), 5000);
setInterval(async () => {
  if (restartInProgress) return;
  try {
    renderAudit(await getAuditLogs());
  } catch (err) {
    console.error(err);
  }
}, 30000);
