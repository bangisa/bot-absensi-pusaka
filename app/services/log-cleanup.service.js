import { schedule } from "node-cron";

import { deleteAuditLogsOlderThan, deleteLogsOlderThan } from "../models/index.js";
import { nowLocalISO } from "../helpers/time.helper.js";
import { cleanupStructuredLogs, logger } from "../helpers/index.js";
import { env } from "../config/env.config.js";
import { timeConfig } from "../config/time.config.js";

const LOG_RETENTION_DAYS = 3;
const AUDIT_RETENTION_DAYS = env.AUDIT_LOG_RETENTION_DAYS;
const STRUCTURED_RETENTION_DAYS = env.STRUCTURED_LOG_RETENTION_DAYS;

let cleanupJob = null;
let isCleanupRunning = false;
let lastRunAt = null;
let lastDeleted = 0;
let lastError = null;

function runLogCleanup() {
  lastRunAt = nowLocalISO();

  try {
    const result = deleteLogsOlderThan(LOG_RETENTION_DAYS);
    const auditResult = deleteAuditLogsOlderThan(AUDIT_RETENTION_DAYS);
    const structuredDeleted = cleanupStructuredLogs(STRUCTURED_RETENTION_DAYS);

    lastDeleted = result.changes ?? 0;
    lastError = null;

    logger.info("logs.cleanup", "Log cleanup selesai", {
      operationLogsDeleted: lastDeleted,
      auditLogsDeleted: auditResult.changes ?? 0,
      structuredFilesDeleted: structuredDeleted,
      operationRetentionDays: LOG_RETENTION_DAYS,
      auditRetentionDays: AUDIT_RETENTION_DAYS,
      structuredRetentionDays: STRUCTURED_RETENTION_DAYS,
    });

    return {
      deleted: lastDeleted,
      retentionDays: LOG_RETENTION_DAYS,
      auditDeleted: auditResult.changes ?? 0,
      auditRetentionDays: AUDIT_RETENTION_DAYS,
      structuredFilesDeleted: structuredDeleted,
      structuredRetentionDays: STRUCTURED_RETENTION_DAYS,
    };
  } catch (err) {
    lastError = err.message;

    console.log("[X] Log cleanup error:", err.message);

    return {
      deleted: 0,
      retentionDays: LOG_RETENTION_DAYS,
      error: err.message,
    };
  }
}

function startLogCleanup() {
  if (isCleanupRunning) {
    console.log("[i] Log cleanup already running");

    return getLogCleanupStatus();
  }

  runLogCleanup();

  cleanupJob = schedule(
    "10 5 0 * * *",
    () => {
      runLogCleanup();
    },
    {
      timezone: timeConfig.timeZone,
    },
  );

  isCleanupRunning = true;

  console.log("Log cleanup started");

  return getLogCleanupStatus();
}

function stopLogCleanup() {
  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
  }

  isCleanupRunning = false;

  console.log("Log cleanup stopped");
}

function getLogCleanupStatus() {
  return {
    running: isCleanupRunning,
    hasJob: cleanupJob !== null,
    retentionDays: LOG_RETENTION_DAYS,
    lastRunAt,
    lastDeleted,
    lastError,
  };
}

export {
  runLogCleanup,
  startLogCleanup,
  stopLogCleanup,
  getLogCleanupStatus,
};
