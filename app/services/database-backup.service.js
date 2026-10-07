import fs from "node:fs";
import path from "node:path";
import { schedule } from "node-cron";

import db from "../../database/db.js";
import { backupConfig } from "../config/backup.config.js";
import { timeConfig } from "../config/time.config.js";
import { logger } from "../helpers/index.js";
import { getZonedDateTime, sleep } from "../helpers/time.helper.js";

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

function backupTimestamp(date = new Date()) {
  const zoned = getZonedDateTime(date);
  return zoned.replace(/:/g, "-").replace(" ", "_");
}

function listBackupFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^db-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sqlite$/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function cleanupOldBackups(directory) {
  const files = listBackupFiles(directory);
  const obsolete = files.slice(backupConfig.retentionCount);

  for (const file of obsolete) {
    fs.unlinkSync(file.fullPath);
  }

  return obsolete.length;
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
    const directory = ensureBackupDirectory();
    const filename = `db-${backupTimestamp()}.sqlite`;
    const destination = path.join(directory, filename);

    logger.info("database.backup_started", "Weekly database backup dimulai", {
      trigger,
      destination: path.relative(process.cwd(), destination),
    });

    try {
      // better-sqlite3 online backup API membuat snapshot SQLite yang konsisten
      // tanpa harus menutup koneksi database utama.
      await db.backup(destination);

      const stat = fs.statSync(destination);
      if (stat.size <= 0) {
        throw new Error("Backup database kosong");
      }

      lastDeletedCount = cleanupOldBackups(directory);
      lastSuccessAt = getZonedDateTime();
      lastBackupFile = path.relative(process.cwd(), destination);
      lastDurationMs = Date.now() - started;
      lastError = null;

      logger.info("database.backup_completed", "Weekly database backup selesai", {
        trigger,
        file: lastBackupFile,
        sizeBytes: stat.size,
        durationMs: lastDurationMs,
        retentionCount: backupConfig.retentionCount,
        oldBackupsDeleted: lastDeletedCount,
      });

      return {
        success: true,
        file: lastBackupFile,
        sizeBytes: stat.size,
        durationMs: lastDurationMs,
        oldBackupsDeleted: lastDeletedCount,
      };
    } catch (err) {
      lastError = err.message;
      lastDurationMs = Date.now() - started;

      try {
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
      } catch {
        // Ignore cleanup error; original backup error is more useful.
      }

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
