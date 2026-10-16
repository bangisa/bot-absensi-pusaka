import db from "../../database/db.js";
import { setSystemSetting, deleteSystemSetting } from "../models/system-setting.model.js";
import { getTimezoneSetting, validateTimezone, hasUnfinishedSchedules, saveTimezoneSetting } from "./timezone-setting.service.js";
import { getLifecycleStatus } from "./lifecycle.service.js";
import { getSchedulerStatus, startScheduler, stopScheduler } from "./scheduler.service.js";
import { stopDailyScheduleGenerator, getDailyScheduleGeneratorStatus } from "./daily-schedule-generator.service.js";
import { getQueueStatus } from "./queue.service.js";
import { getBrowserStatus } from "./browser.service.js";
import { getDatabaseBackupStatus } from "./database-backup.service.js";
import { logger } from "../helpers/structured-log.helper.js";
import { checkTimezoneChangeCooldown, TIMEZONE_CHANGE_COOLDOWN_MS } from "./timezone-protection.service.js";

let timer = null;

function checkTimezoneRestart() {
  if (getLifecycleStatus().state !== "RUNNING") {
    clearInterval(timer);
    timer = null;
    return;
  }
  const queue = getQueueStatus();
  const unfinished = hasUnfinishedSchedules();
  if (unfinished && !getSchedulerStatus().running && !queue.running && !queue.pending &&
      !getBrowserStatus().activeContexts) startScheduler();
  if (unfinished || queue.running || queue.pending ||
      getSchedulerStatus().tickRunning || getBrowserStatus().activeContexts ||
      getDailyScheduleGeneratorStatus().generationRunning || getDatabaseBackupStatus().backupRunning) return;

  const setting = getTimezoneSetting();
  stopScheduler();
  db.transaction(() => {
    saveTimezoneSetting(setting.value);
    deleteSystemSetting("timezone_restart_pending");
  })();
  clearInterval(timer);
  timer = null;
  // The existing signal handler performs full drain, closes resources and exits for PM2.
  process.emit("SIGTERM");
}

export function initializeTimezoneRestart() {
  const setting = getTimezoneSetting();
  if (!setting.pendingRestart) return false;
  validateTimezone(setting.value);
  stopDailyScheduleGenerator();
  const queue = getQueueStatus();
  if (hasUnfinishedSchedules() && !getSchedulerStatus().running && !queue.running && !queue.pending &&
      !getBrowserStatus().activeContexts) startScheduler();
  if (!timer) {
    timer = setInterval(() => {
      try { checkTimezoneRestart(); }
      catch (error) { logger.error("timezone.restart_failed", "Gagal menyelesaikan persiapan restart timezone", { error }); }
    }, 1000);
    timer.unref();
  }
  return true;
}

export function requestTimezoneRestart(value) {
  validateTimezone(value);
  if (process.env.pm_id === undefined) {
    throw Object.assign(new Error("Restart otomatis memerlukan PM2. Hubungi administrator server."), { code: "TIMEZONE_RESTART_UNAVAILABLE" });
  }
  if (getLifecycleStatus().state !== "RUNNING") {
    throw Object.assign(new Error("Aplikasi sedang berhenti. Tunggu proses selesai."), { code: "TIMEZONE_BUSY" });
  }
  const previous = getTimezoneSetting();
  if (previous.pendingRestart || value === previous.active) return previous;
  checkTimezoneChangeCooldown();
  db.transaction(() => {
    setSystemSetting("timezone_restart_pending", value);
    setSystemSetting("timezone_change_allowed_after", Date.now() + TIMEZONE_CHANGE_COOLDOWN_MS);
  })();
  initializeTimezoneRestart();
  return getTimezoneSetting();
}
