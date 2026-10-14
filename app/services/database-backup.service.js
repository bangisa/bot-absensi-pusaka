import fs from "node:fs";
import path from "node:path";
import { schedule } from "node-cron";

import db from "../../database/db.js";
import { backupConfig } from "../config/backup.config.js";
import { timeConfig } from "../config/time.config.js";
import { logger } from "../helpers/index.js";
import { getZonedDateTime, sleep } from "../helpers/time.helper.js";
import { createDatabaseSnapshot, cleanupDatabaseBackups } from "../helpers/database-backup.helper.js";

let backupJob = null;
let backupRunning = false;
let currentBackupPromise = null;
let lastStartedAt = null;
let lastSuccessAt = null;
let lastError = null;
let lastBackupFile = null;
let lastDurationMs = null;
let lastDeletedCount = 0;

function ensureBackupDirectory() {
  const directory = path.resolve(process.cwd(), backupConfig.directory);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function cleanupOldBackups(directory) {
  return cleanupDatabaseBackups(directory, backupConfig.retentionCount);
}

async function executeBackup(trigger = "scheduled") {
  if (!backupConfig.enabled) {
    return { skipped: true, reason: "disabled" };
  }

  if (backupRunning) {
    return currentBackupPromise;
  }

  backupRunning = true;
  lastStartedAt = getZonedDateTime();
  lastError = null;

  const started = Date.now();

  currentBackupPromise = (async () => {
    try {
      const directory = ensureBackupDirectory();
      logger.info("database.backup_started", "Database backup dimulai", { trigger });
      // better-sqlite3 online backup API membuat snapshot SQLite yang konsisten
      // tanpa harus menutup koneksi database utama.
      const result = await createDatabaseSnapshot(db, {
        directory,
        retentionCount: backupConfig.retentionCount,
        timestamp: getZonedDateTime(),
      });
      lastDeletedCount = result.oldBackupsDeleted;
      lastSuccessAt = getZonedDateTime();
      lastBackupFile = path.relative(process.cwd(), result.file);
      lastDurationMs = Date.now() - started;
      lastError = null;

      logger.info("database.backup_completed", "Weekly database backup selesai", {
        trigger,
        file: lastBackupFile,
        sizeBytes: result.sizeBytes,
        durationMs: lastDurationMs,
        retentionCount: backupConfig.retentionCount,
        oldBackupsDeleted: lastDeletedCount,
      });

      return {
        success: true,
        file: lastBackupFile,
        sizeBytes: result.sizeBytes,
        durationMs: lastDurationMs,
        oldBackupsDeleted: lastDeletedCount,
      };
    } catch (err) {
      lastError = err.message;
      lastDurationMs = Date.now() - started;

      logger.error("database.backup_failed", err.message, {
        trigger,
        durationMs: lastDurationMs,
        error: err,
      });

      throw err;
    } finally {
      backupRunning = false;
      currentBackupPromise = null;
    }
  })();

  return currentBackupPromise;
}

function startDatabaseBackup() {
  if (!backupConfig.enabled) {
    console.log("[BACKUP] Weekly database backup disabled");
    return getDatabaseBackupStatus();
  }

  if (backupJob) {
    return getDatabaseBackupStatus();
  }

  ensureBackupDirectory();

  backupJob = schedule(
    backupConfig.cron,
    () => {
      void executeBackup("scheduled").catch((err) => {
        console.error("[BACKUP] Database backup gagal:", err.message);
      });
    },
    {
      timezone: timeConfig.timeZone,
    },
  );

  console.log(
    `[BACKUP] Weekly database backup aktif (${backupConfig.cron}, ${timeConfig.timeZone})`,
  );

  return getDatabaseBackupStatus();
}

function stopDatabaseBackup() {
  if (backupJob) {
    backupJob.stop();
    backupJob = null;
  }

  console.log("[BACKUP] Weekly database backup scheduler stopped");
  return getDatabaseBackupStatus();
}

async function waitForDatabaseBackupIdle() {
  while (backupRunning) {
    if (currentBackupPromise) {
      try {
        await currentBackupPromise;
      } catch {
        // Failure already logged. Shutdown may continue after writer is idle.
      }
      break;
    }

    await sleep(100);
  }
}

function getDatabaseBackupStatus() {
  return {
    enabled: backupConfig.enabled,
    schedulerRunning: backupJob !== null,
    backupRunning,
    cron: backupConfig.cron,
    timezone: timeConfig.timeZone,
    directory: backupConfig.directory,
    retentionCount: backupConfig.retentionCount,
    lastStartedAt,
    lastSuccessAt,
    lastBackupFile,
    lastDurationMs,
    lastDeletedCount,
    lastError,
  };
}

export {
  cleanupOldBackups,
  executeBackup,
  getDatabaseBackupStatus,
  startDatabaseBackup,
  stopDatabaseBackup,
  waitForDatabaseBackupIdle,
};
