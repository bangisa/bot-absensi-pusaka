import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import db from "../../database/db.js";
import { env } from "../config/env.config.js";
import { timeConfig } from "../config/time.config.js";
import {
  getZonedDate,
  getZonedDateTime,
} from "../helpers/time.helper.js";
import { getBrowserDiagnostics } from "./browser.service.js";
import { getDailyScheduleGeneratorStatus } from "./daily-schedule-generator.service.js";
import { getQueueStatus } from "./queue.service.js";
import { getSchedulerStatus } from "./scheduler.service.js";
import { getLifecycleStatus } from "./lifecycle.service.js";
import { getDrainSnapshot } from "./graceful-shutdown.service.js";
import { getDatabaseBackupStatus } from "./database-backup.service.js";

const MB = 1024 * 1024;
const GB = 1024 * MB;

function levelRank(status) {
  return { HEALTHY: 0, DEGRADED: 1, UNHEALTHY: 2 }[status] ?? 2;
}

function aggregateStatus(checks) {
  let result = "HEALTHY";

  for (const check of Object.values(checks)) {
    if (!check?.status) continue;
    if (levelRank(check.status) > levelRank(result)) result = check.status;
  }

  return result;
}

function checkDatabase() {
  const start = performance.now();

  try {
    const row = db.prepare("SELECT 1 AS ok").get();
    const latencyMs = Number((performance.now() - start).toFixed(2));

    return {
      status: row?.ok === 1 ? "HEALTHY" : "UNHEALTHY",
      latencyMs,
    };
  } catch (err) {
    return {
      status: "UNHEALTHY",
      latencyMs: Number((performance.now() - start).toFixed(2)),
      error: err.message,
    };
  }
}

function checkCredentialVault() {
  const configured = Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY);
  const keyPath = path.resolve(process.cwd(), ".secrets", "credential.key");
  const keyFileExists = fs.existsSync(keyPath);

  return {
    status: configured || keyFileExists ? "HEALTHY" : "UNHEALTHY",
    source: configured ? "environment" : keyFileExists ? "local-key-file" : "missing",
    keyAvailable: configured || keyFileExists,
  };
}

function checkLogging() {
  const configuredDir = path.resolve(
    process.cwd(),
    env.STRUCTURED_LOG_DIR || "logs",
  );

  const target = fs.existsSync(configuredDir)
    ? configuredDir
    : path.dirname(configuredDir);

  try {
    fs.accessSync(target, fs.constants.W_OK);
    return {
      status: "HEALTHY",
      writable: true,
      directory: path.relative(process.cwd(), configuredDir) || ".",
    };
  } catch (err) {
    return {
      status: "DEGRADED",
      writable: false,
      directory: path.relative(process.cwd(), configuredDir) || ".",
      error: err.message,
    };
  }
}

function checkMemory() {
  const processMemory = process.memoryUsage();
  const systemTotal = os.totalmem();
  const systemFree = os.freemem();
  const systemUsedRatio = systemTotal > 0 ? (systemTotal - systemFree) / systemTotal : 0;

  let status = "HEALTHY";
  if (systemUsedRatio >= 0.95) status = "UNHEALTHY";
  else if (systemUsedRatio >= 0.85) status = "DEGRADED";

  return {
    status,
    rssMb: Number((processMemory.rss / MB).toFixed(1)),
    heapUsedMb: Number((processMemory.heapUsed / MB).toFixed(1)),
    heapTotalMb: Number((processMemory.heapTotal / MB).toFixed(1)),
    systemFreeMb: Number((systemFree / MB).toFixed(1)),
    systemTotalMb: Number((systemTotal / MB).toFixed(1)),
    systemUsedPercent: Number((systemUsedRatio * 100).toFixed(1)),
  };
}

function checkDisk() {
  try {
    if (typeof fs.statfsSync !== "function") {
      return { status: "HEALTHY", available: false, reason: "statfs_not_supported" };
    }

    const stats = fs.statfsSync(process.cwd());
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);

    let status = "HEALTHY";
    if (freeBytes < 256 * MB) status = "UNHEALTHY";
    else if (freeBytes < 1 * GB) status = "DEGRADED";

    return {
      status,
      available: true,
      freeMb: Number((freeBytes / MB).toFixed(1)),
      totalMb: Number((totalBytes / MB).toFixed(1)),
    };
  } catch (err) {
    return { status: "DEGRADED", available: false, error: err.message };
  }
}

function getScheduleDiagnostics(scheduleDate = getZonedDate()) {
  const rows = db.prepare(`
    SELECT status, COUNT(1) AS total
    FROM daily_schedules
    WHERE schedule_date = ?
    GROUP BY status
  `).all(scheduleDate);

  const counts = {
    pending: 0,
    processing: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    if (row.status in counts) counts[row.status] = row.total;
  }

  const retry = db.prepare(`
    SELECT COUNT(1) AS waiting, MIN(next_retry_at) AS next_retry_at
    FROM daily_schedules
    WHERE schedule_date = ?
      AND status = 'pending'
      AND next_retry_at IS NOT NULL
  `).get(scheduleDate);

  return {
    scheduleDate,
    ...counts,
    retry: {
      waiting: retry?.waiting ?? 0,
      nextRetryAt: retry?.next_retry_at ?? null,
    },
  };
}

function getAutomationDiagnostics() {
  const lastSuccess = db.prepare(`
    SELECT created_at, type, user_id
    FROM logs
    WHERE status = 'success'
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  const lastFailure = db.prepare(`
    SELECT created_at, type, user_id, message
    FROM logs
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  const oneHourAgo = getZonedDateTime(new Date(Date.now() - 60 * 60 * 1000));
  const recentFailureRow = db.prepare(`
    SELECT COUNT(1) AS total
    FROM logs
    WHERE status = 'failed'
      AND created_at >= ?
  `).get(oneHourAgo);

  const recentFailures = recentFailureRow?.total ?? 0;

  return {
    status: recentFailures >= 3 ? "DEGRADED" : "HEALTHY",
    lastSuccessAt: lastSuccess?.created_at ?? null,
    lastSuccessType: lastSuccess?.type ?? null,
    lastFailureAt: lastFailure?.created_at ?? null,
    lastFailureType: lastFailure?.type ?? null,
    recentFailuresLast60Minutes: recentFailures,
  };
}

function checkScheduler() {
  const scheduler = getSchedulerStatus();
  const generator = getDailyScheduleGeneratorStatus();

  let status = "HEALTHY";
  if (!scheduler.running || !generator.running) status = "DEGRADED";
  if (scheduler.lastTickError || generator.lastError) status = "DEGRADED";

  return {
    status,
    ...scheduler,
    generator,
  };
}

function checkQueue() {
  const queue = getQueueStatus();
  const saturated = queue.running >= queue.maxConcurrent && queue.pending > 0;

  return {
    status: queue.pending >= 20 ? "DEGRADED" : "HEALTHY",
    saturated,
    ...queue,
  };
}


function checkDatabaseBackup() {
  const backup = getDatabaseBackupStatus();

  let status = "HEALTHY";
  if (backup.lastError) status = "DEGRADED";
  if (backup.enabled && !backup.schedulerRunning && !backup.backupRunning) {
    status = "DEGRADED";
  }

  return {
    status,
    ...backup,
  };
}

function checkHolidayProvider() {
  const generator = getDailyScheduleGeneratorStatus();
  const holiday = generator?.lastResult?.holiday ?? null;

  if (!holiday) {
    return {
      status: "HEALTHY",
      source: null,
      available: null,
      note: "Belum ada hasil holiday check pada generator terakhir",
    };
  }

  return {
    status: holiday.available === false ? "DEGRADED" : "HEALTHY",
    source: holiday.source ?? null,
    available: holiday.available !== false,
    isHoliday: Boolean(holiday.isHoliday),
    name: holiday.name ?? null,
  };
}

async function buildHealthSnapshot({ detailed = false } = {}) {
  const database = checkDatabase();
  const browser = await getBrowserDiagnostics();

  const checks = {
    database,
    scheduler: checkScheduler(),
    queue: checkQueue(),
    browser: {
      status: browser.connected || browser.activeContexts === 0 ? "HEALTHY" : "DEGRADED",
      ...browser,
    },
    memory: checkMemory(),
    disk: checkDisk(),
    credentialVault: checkCredentialVault(),
    logging: checkLogging(),
    automation: getAutomationDiagnostics(),
    holidayProvider: checkHolidayProvider(),
    databaseBackup: checkDatabaseBackup(),
  };

  const lifecycle = getLifecycleStatus();

  const snapshot = {
    status: lifecycle.state === "DRAINING"
      ? "DEGRADED"
      : aggregateStatus(checks),
    timestamp: getZonedDateTime(),
    timezone: timeConfig.timeZone,
    uptimeSeconds: Math.floor(process.uptime()),
    lifecycle,
    checks,
  };

  if (detailed) {
    snapshot.runtime = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      nodeEnv: env.NODE_ENV,
    };
    snapshot.dailySchedules = getScheduleDiagnostics();
    snapshot.drain = getDrainSnapshot();
  }

  return snapshot;
}

async function buildReadinessSnapshot() {
  const database = checkDatabase();
  const credentialVault = checkCredentialVault();
  const scheduler = getSchedulerStatus();
  const generator = getDailyScheduleGeneratorStatus();

  const lifecycle = getLifecycleStatus();

  const ready = Boolean(
    lifecycle.state === "RUNNING" &&
      database.status === "HEALTHY" &&
      credentialVault.status === "HEALTHY" &&
      scheduler.running &&
      generator.running,
  );

  return {
    ready,
    timestamp: getZonedDateTime(),
    timezone: timeConfig.timeZone,
    lifecycle,
    reason: lifecycle.state === "DRAINING" ? "shutting_down" : null,
    database: database.status === "HEALTHY",
    credentialVault: credentialVault.status === "HEALTHY",
    scheduler: scheduler.running,
    generator: generator.running,
  };
}

export {
  buildHealthSnapshot,
  buildReadinessSnapshot,
  getAutomationDiagnostics,
  getScheduleDiagnostics,
};
