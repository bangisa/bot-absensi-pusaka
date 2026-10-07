import db, { closeDatabase } from "../../database/db.js";
import { logger } from "../helpers/index.js";
import { sleep } from "../helpers/time.helper.js";
import { closeBrowserForShutdown, getBrowserStatus } from "./browser.service.js";
import {
  getDailyScheduleGeneratorStatus,
  stopDailyScheduleGenerator,
} from "./daily-schedule-generator.service.js";
import { stopLogCleanup } from "./log-cleanup.service.js";
import {
  getDatabaseBackupStatus,
  stopDatabaseBackup,
  waitForDatabaseBackupIdle,
} from "./database-backup.service.js";
import {
  getLifecycleStatus,
  markShutdownComplete,
  requestShutdown,
} from "./lifecycle.service.js";
import { getQueueStatus } from "./queue.service.js";
import { getSchedulerStatus, stopScheduler } from "./scheduler.service.js";

const POLL_INTERVAL_MS = 500;
const PROGRESS_LOG_INTERVAL_MS = 15000;

let shutdownPromise = null;

function getDatabaseDrainStatus() {
  const lifecycle = getLifecycleStatus();
  const scheduler = getSchedulerStatus();

  if (!lifecycle.shutdownRequested || !lifecycle.cutoffDate || !scheduler.running) {
    return {
      duePending: 0,
      retryPending: 0,
      processing: 0,
      total: 0,
    };
  }

  const row = db.prepare(`
    SELECT
      SUM(
        CASE
          WHEN status = 'pending'
            AND attempt_count = 0
            AND scheduled_time <= @cutoffTime
          THEN 1 ELSE 0
        END
      ) AS due_pending,
      SUM(
        CASE
          WHEN status = 'pending'
            AND attempt_count > 0
          THEN 1 ELSE 0
        END
      ) AS retry_pending,
      SUM(
        CASE
          WHEN status = 'processing'
          THEN 1 ELSE 0
        END
      ) AS processing
    FROM daily_schedules
    WHERE schedule_date = @cutoffDate
  `).get({
    cutoffDate: lifecycle.cutoffDate,
    cutoffTime: lifecycle.cutoffTime,
  });

  const duePending = Number(row?.due_pending || 0);
  const retryPending = Number(row?.retry_pending || 0);
  const processing = Number(row?.processing || 0);

  return {
    duePending,
    retryPending,
    processing,
    total: duePending + retryPending + processing,
  };
}

function getDrainSnapshot() {
  const queue = getQueueStatus();
  const browser = getBrowserStatus();
  const scheduler = getSchedulerStatus();
  const database = getDatabaseDrainStatus();
  const backup = getDatabaseBackupStatus();

  return {
    queue: {
      running: queue.running,
      pending: queue.pending,
    },
    browser: {
      activeContexts: browser.activeContexts,
      connected: browser.connected,
    },
    scheduler: {
      running: scheduler.running,
      tickRunning: scheduler.tickRunning,
    },
    database,
    backup: {
      running: backup.backupRunning,
      schedulerRunning: backup.schedulerRunning,
    },
  };
}

function isDrainComplete(snapshot) {
  return Boolean(
    snapshot.queue.running === 0 &&
      snapshot.queue.pending === 0 &&
      snapshot.browser.activeContexts === 0 &&
      !snapshot.scheduler.tickRunning &&
      !snapshot.backup.running &&
      snapshot.database.total === 0,
  );
}

function sameProgress(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

async function waitForDrainToZero() {
  let lastSnapshot = null;
  let lastProgressLogAt = 0;

  while (true) {
    const snapshot = getDrainSnapshot();

    if (isDrainComplete(snapshot)) {
      logger.info("shutdown.drain_complete", "Seluruh workload sudah drain ke nol", snapshot);
      return snapshot;
    }

    const now = Date.now();
    const changed = !sameProgress(snapshot, lastSnapshot);
    const intervalElapsed = now - lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS;

    if (changed || intervalElapsed) {
      logger.info("shutdown.drain_progress", "Menunggu queue/context/retry selesai", snapshot);
      lastProgressLogAt = now;
      lastSnapshot = snapshot;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function closeHttpServer(server) {
  if (!server?.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function performGracefulShutdown({ signal = "UNKNOWN", server = null } = {}) {
  if (!requestShutdown(signal)) {
    return shutdownPromise;
  }

  const queue = getQueueStatus();
  const browser = getBrowserStatus();
  const scheduler = getSchedulerStatus();
  const generator = getDailyScheduleGeneratorStatus();

  logger.info("shutdown.requested", `Shutdown diminta melalui ${signal}`, {
    signal,
    queueRunning: queue.running,
    queuePending: queue.pending,
    activeContexts: browser.activeContexts,
    schedulerRunning: scheduler.running,
    generatorRunning: generator.running,
    lifecycle: getLifecycleStatus(),
  });

  // Tidak membuat daily schedule baru selama drain.
  stopDailyScheduleGenerator();

  // Cleanup dan pemicu backup baru bukan workload kritis selama drain.
  // Backup yang SUDAH berjalan tetap dibiarkan selesai dan ikut invariant drain.
  stopLogCleanup();
  stopDatabaseBackup();

  // Scheduler sengaja TETAP hidup selama drain agar retry dari task aktif
  // dapat dieksekusi sampai terminal. Scheduler sendiri akan menolak jadwal
  // first-attempt yang baru jatuh tempo setelah shutdown cutoff.
  await waitForDrainToZero();
  await waitForDatabaseBackupIdle();

  // Setelah workload benar-benar nol, tidak ada alasan executor tetap hidup.
  stopScheduler();

  await closeBrowserForShutdown("full-drain shutdown");

  logger.info("shutdown.resources_drained", "Queue, context, scheduler, dan browser sudah dingin", {
    lifecycle: getLifecycleStatus(),
  });

  // Tutup HTTP paling akhir agar endpoint health/diagnostics tetap bisa
  // dipakai untuk memantau proses draining.
  await closeHttpServer(server);

  // Semua writer sudah berhenti; aman melakukan checkpoint dan close SQLite.
  closeDatabase();

  markShutdownComplete();

  // Structured logger menggunakan appendFileSync sehingga aman ditulis
  // setelah SQLite ditutup.
  logger.info("shutdown.completed", "Graceful shutdown selesai dalam kondisi dingin", {
    signal,
    lifecycle: getLifecycleStatus(),
  });
}

function gracefulShutdown(options = {}) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = performGracefulShutdown(options).catch((err) => {
    logger.error("shutdown.failed", err.message, { error: err, signal: options.signal });
    throw err;
  });

  return shutdownPromise;
}

export {
  getDatabaseDrainStatus,
  getDrainSnapshot,
  gracefulShutdown,
  isDrainComplete,
  waitForDrainToZero,
};
