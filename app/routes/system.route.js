import { Router } from "express";
import { executeBackup, getDatabaseBackupStatus } from "../services/database-backup.service.js";
import { getTimezoneSetting, saveTimezoneSetting } from "../services/timezone-setting.service.js";
import { getQueueStatus } from "../services/queue.service.js";
import { getBrowserStatus } from "../services/browser.service.js";
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
router.put("/settings/timezone", (req, res) => {
  const queue = getQueueStatus();
  const generator = getDailyScheduleGeneratorStatus();
  const browser = getBrowserStatus();
  if (getLifecycleStatus().state !== "RUNNING" || getSchedulerStatus().running ||
      generator.running || generator.generationRunning || queue.running || queue.pending || browser.connected || browser.activeContexts) {
    return res.status(409).json({ error: "Hentikan scheduler dan tunggu seluruh pekerjaan/browser selesai." });
  }
  try {
    const previous = getTimezoneSetting();
    const result = saveTimezoneSetting(req.body?.value);
    createAuditLog({ action: "settings.timezone_changed", actor: "admin", target_type: "system_setting", target_id: "timezone", metadata: { oldValue: previous.value, newValue: result.value } });
    return res.json(result);
  } catch (error) {
    if (["INVALID_TIMEZONE", "TIMEZONE_BUSY"].includes(error.code)) {
      return res.status(error.code === "TIMEZONE_BUSY" ? 409 : 400).json({ error: error.message });
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
