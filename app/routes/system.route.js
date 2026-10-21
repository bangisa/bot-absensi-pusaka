import { Router } from "express";
import db from "../../database/db.js";
import { getScheduleRanges, saveScheduleRanges } from "../services/schedule-setting.service.js";
import { reschedulePendingToday } from "../services/daily-schedule.service.js";
import { executeBackup, getDatabaseBackupStatus, startDatabaseBackup, stopDatabaseBackup } from "../services/database-backup.service.js";
import { getOperationalSettings, saveOperationalSettings } from "../services/operational-setting.service.js";
import { getTimezoneSetting } from "../services/timezone-setting.service.js";
import { requestTimezoneRestart } from "../services/timezone-restart.service.js";
import { recordTimezoneChangeAttempt } from "../services/timezone-protection.service.js";
import { getHolidayCalendarSetting, testHolidayCalendar, saveHolidayCalendar, resetHolidayCalendar } from "../services/holiday-calendar.service.js";
import { getZonedDateTime } from "../helpers/time.helper.js";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  buildHealthSnapshot,
  buildReadinessSnapshot,
  startDailyScheduleGenerator,
  stopDailyScheduleGenerator,
  getDailyScheduleGeneratorStatus,
  getLifecycleStatus,
  getMaxConcurrentSetting,
  setMaxConcurrent,
} from "../services/index.js";

import {
  getLogs,
  getAuditLogs,
  createAuditLog,
} from "../models/index.js";

const router = Router();

router.get("/settings/schedule-ranges", (req, res) => res.json(getScheduleRanges()));
router.put("/settings/schedule-ranges", (req, res) => {
  if (getLifecycleStatus().state !== "RUNNING" || getDatabaseBackupStatus().backupRunning ||
      getDailyScheduleGeneratorStatus().generationRunning) {
    return res.status(409).json({ error: "Tunggu generator, backup, atau penghentian aplikasi selesai." });
  }
  const body = req.body;
  if (!body || Object.keys(body).length !== 2 || typeof body.applyPendingToday !== "boolean") {
    return res.status(400).json({ error: "Pengaturan rentang jadwal tidak valid." });
  }
  try {
    const result = db.transaction(() => {
      const previous = getScheduleRanges();
      const ranges = saveScheduleRanges(body.ranges);
      const pending = body.applyPendingToday ? reschedulePendingToday() : null;
      createAuditLog({ action: "settings.schedule_ranges_changed", actor: "admin",
        target_type: "system_setting", target_id: "schedule_ranges",
        metadata: { previous, current: ranges, applyPendingToday: body.applyPendingToday, pending } });
      return { ranges, pending };
    })();
    return res.json(result);
  } catch (error) {
    if (error.code === "INVALID_SCHEDULE_RANGES") return res.status(400).json({ error: error.message });
    throw error;
  }
});

router.get("/settings/operational", (req, res) => res.json(getOperationalSettings()));
router.put("/settings/operational", (req, res) => {
  if (getLifecycleStatus().state !== "RUNNING" || getDatabaseBackupStatus().backupRunning) {
    return res.status(409).json({ error: "Tunggu backup atau penghentian aplikasi selesai." });
  }
  const previous = getOperationalSettings();
  let result;
  try {
    result = saveOperationalSettings(req.body);
  } catch (error) {
    if (error.code === "INVALID_OPERATIONAL_SETTING") return res.status(400).json({ error: error.message });
    throw error;
  }
  if (result.backupEnabled !== previous.backupEnabled) {
    if (result.backupEnabled) startDatabaseBackup();
    else stopDatabaseBackup();
  }
  createAuditLog({ action: "settings.operational_changed", actor: "admin", target_type: "system_setting", target_id: "operational_settings", metadata: { previous, current: result } });
  return res.json(result);
});

router.post("/backup", async (req, res) => {
  const status = getDatabaseBackupStatus();
  if (getLifecycleStatus().state !== "RUNNING" || status.backupRunning) {
    return res.status(409).json({ error: "Backup sedang berjalan atau aplikasi sedang berhenti." });
  }
  if (!status.enabled) return res.status(409).json({ error: "Backup database dinonaktifkan pada konfigurasi." });
  try {
    const result = await executeBackup("manual-admin");
    createAuditLog({ action: "database.backup_manual", actor: "admin", target_type: "system", metadata: { sizeBytes: result.sizeBytes } });
    return res.json({ success: true, sizeBytes: result.sizeBytes, durationMs: result.durationMs });
  } catch {
    return res.status(500).json({ error: "Backup gagal. Periksa status backup atau hubungi administrator." });
  }
});

router.get("/settings/timezone", (req, res) => res.json(getTimezoneSetting()));
function protectTimezoneChanges(req, res, next) {
  try {
    recordTimezoneChangeAttempt();
    return next();
  } catch (error) {
    if (error.code !== "TIMEZONE_RATE_LIMIT") return next(error);
    if (error.audit) createAuditLog({ action: "settings.timezone_rate_limited", actor: "admin", target_type: "system_setting", target_id: "timezone", status: "denied" });
    res.set("Retry-After", String(error.retryAfterSeconds));
    return res.status(429).json({ error: error.message });
  }
}
function handleTimezoneProtectionError(error, res) {
  if (error.code !== "TIMEZONE_CHANGE_COOLDOWN") return false;
  createAuditLog({ action: "settings.timezone_cooldown_denied", actor: "admin", target_type: "system_setting", target_id: "timezone", status: "denied" });
  res.set("Retry-After", String(error.retryAfterSeconds));
  res.status(429).json({ error: error.message });
  return true;
}
router.post("/settings/timezone/restart", protectTimezoneChanges, (req, res) => {
  const setting = getTimezoneSetting();
  if (!setting.restartRequired) return res.status(409).json({ error: "Tidak ada perubahan timezone yang perlu diterapkan." });
  try {
    const result = requestTimezoneRestart(setting.value);
    createAuditLog({ action: "system.restart_requested", actor: "admin", target_type: "system", metadata: { reason: "timezone_change" } });
    return res.status(202).json(result);
  } catch (error) {
    if (handleTimezoneProtectionError(error, res)) return;
    if (["TIMEZONE_BUSY", "TIMEZONE_RESTART_UNAVAILABLE"].includes(error.code)) return res.status(409).json({ error: error.message });
    throw error;
  }
});
router.put("/settings/timezone", protectTimezoneChanges, (req, res) => {
  try {
    const previous = getTimezoneSetting();
    const result = requestTimezoneRestart(req.body?.value);
    createAuditLog({ action: "settings.timezone_changed", actor: "admin", target_type: "system_setting", target_id: "timezone", metadata: { oldValue: previous.value, newValue: result.value } });
    return res.status(result.pendingRestart ? 202 : 200).json(result);
  } catch (error) {
    if (handleTimezoneProtectionError(error, res)) return;
    if (["INVALID_TIMEZONE", "TIMEZONE_BUSY", "TIMEZONE_RESTART_UNAVAILABLE"].includes(error.code)) {
      return res.status(error.code === "INVALID_TIMEZONE" ? 400 : 409).json({ error: error.message });
    }
    throw error;
  }
});

router.get("/settings/holiday-calendar", (req, res) => res.json(getHolidayCalendarSetting()));

for (const [method, path, operation, action] of [
  ["post", "/settings/holiday-calendar/test", testHolidayCalendar, null],
  ["put", "/settings/holiday-calendar", saveHolidayCalendar, "settings.holiday_calendar_changed"],
  ["delete", "/settings/holiday-calendar", resetHolidayCalendar, "settings.holiday_calendar_reset"],
]) {
  router[method](path, async (req, res) => {
    try {
      const result = await operation(req.body?.url);
      if (action) createAuditLog({ action, actor: "admin", target_type: "system_setting", target_id: "holiday_calendar", metadata: { year: result.year, count: result.count } });
      res.json(result);
    } catch (error) {
      if (["INVALID_HOLIDAY_CALENDAR", "CALENDAR_DRAINING"].includes(error.code)) {
        return res.status(error.code === "CALENDAR_DRAINING" ? 409 : 400).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  });
}

// STATUS
router.get("/status", (req, res) => {
  res.json({
    ...getSchedulerStatus(),
    generator: getDailyScheduleGeneratorStatus(),
    lifecycle: getLifecycleStatus(),
  });
});

// START SCHEDULER
router.post("/scheduler/start", async (req, res) => {
  if (getTimezoneSetting().restartRequired) {
    return res.status(409).json({ error: "Restart aplikasi untuk menerapkan timezone sebelum memulai scheduler." });
  }
  const status = getSchedulerStatus();

  if (status.running) {
    return res.send("Scheduler sudah berjalan");
  }

  const generatorStatus = await startDailyScheduleGenerator();

  if (generatorStatus.lastError) {
    return res.status(500).json({
      error: "Daily schedule generator gagal dijalankan",
      generator: generatorStatus,
    });
  }

  startScheduler();
  createAuditLog({
    action: "scheduler.start",
    actor: "local-api",
    target_type: "system",
  });

  res.send("Scheduler started");
});

// STOP SCHEDULER
router.post("/scheduler/stop", (req, res) => {
  const status = getSchedulerStatus();
  const generatorStatus = getDailyScheduleGeneratorStatus();

  if (!status.running && !generatorStatus.running) {
    return res.send("Scheduler sudah berhenti");
  }

  stopScheduler();
  stopDailyScheduleGenerator();
  createAuditLog({
    action: "scheduler.stop",
    actor: "local-api",
    target_type: "system",
  });

  res.send("Scheduler stopped");
});


// RUNTIME SETTING: MAX CONCURRENT
router.get("/settings/max-concurrent", (req, res) => {
  res.json(getMaxConcurrentSetting());
});

router.put("/settings/max-concurrent", (req, res) => {
  try {
    const previous = getMaxConcurrentSetting();
    const result = setMaxConcurrent(req.body?.value);

    createAuditLog({
      action: "settings.max_concurrent_changed",
      actor: "admin",
      target_type: "system_setting",
      target_id: "max_concurrent",
      metadata: {
        oldValue: previous.value,
        newValue: result.value,
      },
    });

    return res.json({
      ...result,
      warning:
        "Nilai concurrency yang lebih tinggi membutuhkan resource CPU/RAM lebih besar dan menjalankan lebih banyak browser automation secara paralel.",
    });
  } catch (err) {
    if (err?.code === "INVALID_MAX_CONCURRENT") {
      return res.status(400).json({
        error: err.message,
        code: err.code,
      });
    }

    throw err;
  }
});

// LIVENESS
router.get("/live", (req, res) => {
  res.json({
    status: "ok",
    timestamp: getZonedDateTime(),
  });
});

// READINESS
router.get("/ready", async (req, res) => {
  const readiness = await buildReadinessSnapshot();
  res.status(readiness.ready ? 200 : 503).json(readiness);
});

// HEALTHCHECK
router.get("/health", async (req, res) => {
  const health = await buildHealthSnapshot();
  res.status(health.status === "UNHEALTHY" ? 503 : 200).json(health);
});

// DEEP DIAGNOSTICS (read-only, no external network/browser launch)
router.get("/diagnostics", async (req, res) => {
  const diagnostics = await buildHealthSnapshot({ detailed: true });
  res.status(diagnostics.status === "UNHEALTHY" ? 503 : 200).json(diagnostics);
});

// LOGS
router.get("/logs", (req, res) => {
  res.json(getLogs(100));
});

router.get("/audit-logs", (req, res) => {
  res.json(getAuditLogs(100));
});

export default router;
