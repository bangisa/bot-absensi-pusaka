import { schedule } from "node-cron";

import { deleteLogsOlderThan } from "../models/index.js";

const LOG_RETENTION_DAYS = 3;

let cleanupJob = null;
let isCleanupRunning = false;
let lastRunAt = null;
let lastDeleted = 0;
let lastError = null;

function runLogCleanup() {
  lastRunAt = new Date().toISOString();

  try {
    const result = deleteLogsOlderThan(LOG_RETENTION_DAYS);

    lastDeleted = result.changes ?? 0;
    lastError = null;

    console.log(
      `[LOG CLEANUP] deleted=${lastDeleted} olderThan=${LOG_RETENTION_DAYS}d`,
    );

    return {
      deleted: lastDeleted,
      retentionDays: LOG_RETENTION_DAYS,
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
      timezone: "Asia/Jakarta",
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
