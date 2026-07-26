import { schedule } from "node-cron";

import {
  findPendingSchedulesByDate,
  markScheduleProcessing,
  markScheduleSuccess,
  markScheduleFailed,
  markScheduleSkipped,
  markScheduleRetry,
  resetProcessingSchedules,
} from "../models/index.js";

import { addToQueue } from "./queue.service.js";
import { openPusaka } from "./automation.service.js";

import { getJakartaDate, getJakartaTime } from "./daily-schedule.service.js";

import { nowLog } from "../helpers/index.js";

let jobs = [];
let isRunning = false;
let isTickRunning = false;

const MAX_SCHEDULE_DELAY_SECONDS = 10 * 60;

function getSchedulerStatus() {
  return {
    running: isRunning,
    tickRunning: isTickRunning,
    totalJobs: jobs.length,
  };
}

function timeToSeconds(time) {
  const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);

  return hour * 3600 + minute * 60 + second;
}

function isScheduleExpired(scheduledTime, currentTime) {
  const delaySeconds =
    timeToSeconds(currentTime) - timeToSeconds(scheduledTime);

  return delaySeconds > MAX_SCHEDULE_DELAY_SECONDS;
}

function handleTaskFailure(dailySchedule, error) {
  const message = error?.message || "Terjadi kesalahan tidak diketahui";

  const retryResult = markScheduleRetry(dailySchedule.id, message);

  if (retryResult.retried) {
    console.log(
      `[RETRY] ` +
        `schedule=${dailySchedule.id} ` +
        `attempt=${retryResult.attempt_count}/` +
        `${retryResult.max_attempts} ` +
        `next=${retryResult.next_retry_at}`,
    );

    return {
      status: "retry_scheduled",
      message,
      retry: retryResult,
    };
  }

  if (retryResult.failed) {
    console.log(
      `[FAILED] ` +
        `schedule=${dailySchedule.id} ` +
        `attempt=${retryResult.attempt_count}/` +
        `${retryResult.max_attempts}`,
    );

    return {
      status: "failed",
      message,
      retry: retryResult,
    };
  }

  /*
   * Fallback apabila jadwal tidak ditemukan
   * atau statusnya sudah bukan processing.
   */
  const failedResult = markScheduleFailed(dailySchedule.id, message);

  console.log(
    `[FAILED] ` +
      `schedule=${dailySchedule.id} ` +
      `fallbackChanges=${failedResult.changes}`,
  );

  return {
    status: "failed",
    message,
    retry: retryResult,
  };
}

function enqueueScheduleTask(dailySchedule, user) {
  /*
   * Mengubah status pending menjadi processing.
   *
   * Kondisi ini sekaligus menjadi lock agar jadwal
   * yang sama tidak dimasukkan ke antrean dua kali.
   */
  const lockResult = markScheduleProcessing(dailySchedule.id);

  if (lockResult.changes === 0) {
    console.log(`[SCHEDULER] Jadwal ${dailySchedule.id} sudah diproses`);

    return;
  }

  addToQueue(user.id, async () => {
    const { type } = dailySchedule;

    console.log(
      `[${nowLog()}] [START] schedule=${dailySchedule.id} ${type} user=${user.id}`,
    );

    try {
      const result = await openPusaka(type, user);

      const message = result?.message ?? `Presensi ${type} selesai`;

      if (result?.status === "skipped") {
        markScheduleSkipped(dailySchedule.id, message);

        return result;
      }

      if (result?.status === "failed") {
        return handleTaskFailure(dailySchedule, new Error(message));
      }

      if (result?.status === "success") {
        markScheduleSuccess(dailySchedule.id, message);

        return result;
      }

      return handleTaskFailure(
        dailySchedule,
        new Error(`Status automation tidak dikenal: ${result?.status}`),
      );
    } catch (err) {
      console.log(
        `[X] Task error ` +
          `schedule=${dailySchedule.id} ` +
          `user=${user.id}:`,
        err.message,
      );

      return handleTaskFailure(dailySchedule, err);
    } finally {
      console.log(
        `[${nowLog()}] [DONE] schedule=${dailySchedule.id} ${type} user=${user.id}`,
      );
    }
  }).catch((err) => {
    console.log(
      `[X] Queue error ` + `schedule=${dailySchedule.id} ` + `user=${user.id}:`,
      err.message,
    );

    handleTaskFailure(dailySchedule, err);
  });
}

async function runSchedulerTick() {
  const now = new Date();

  const scheduleDate = getJakartaDate(now);
  const currentTime = getJakartaTime(now);
  const currentDateTime = `${scheduleDate} ${currentTime}`;

  const pendingSchedules = await Promise.resolve(
    findPendingSchedulesByDate(scheduleDate, currentDateTime),
  );

  for (const dailySchedule of pendingSchedules) {
    /*
     * Jadwal yang waktunya belum tiba tidak
     * dijalankan.
     *
     * Format HH:mm:ss dapat dibandingkan langsung
     * selama selalu memakai dua digit.
     */
    if (dailySchedule.scheduled_time > currentTime) {
      continue;
    }

    const isRetry = dailySchedule.attempt_count > 0;

    if (
      !isRetry &&
      isScheduleExpired(dailySchedule.scheduled_time, currentTime)
    ) {
      const lockResult = markScheduleProcessing(dailySchedule.id);

      if (lockResult.changes > 0) {
        markScheduleSkipped(
          dailySchedule.id,
          `Jadwal kedaluwarsa pada ${dailySchedule.scheduled_time}`,
        );
      }

      continue;
    }

    enqueueScheduleTask(dailySchedule, dailySchedule.user);
  }
}

function clearJobs() {
  jobs.forEach((job) => job.stop());
  jobs = [];
}

function startScheduler() {
  if (isRunning) {
    console.log("[i] Scheduler already running");

    return;
  }

  clearJobs();

  const scheduleDate = getJakartaDate();

  /*
   * Jika aplikasi sebelumnya mati ketika jadwal
   * berstatus processing, kembalikan jadwal tersebut
   * menjadi pending saat startup.
   */
  const recoveryResult = resetProcessingSchedules(scheduleDate);

  if (recoveryResult.total > 0) {
    console.log(
      `[RECOVERY] ` +
        `date=${scheduleDate} ` +
        `pending=${recoveryResult.recovered} ` +
        `failed=${recoveryResult.failed}`,
    );
  }

  const job = schedule(
    "* * * * * *",
    async () => {
      /*
       * Mencegah cron tick berikutnya berjalan
       * sebelum tick sebelumnya selesai.
       */
      if (isTickRunning) {
        return;
      }

      isTickRunning = true;

      try {
        await runSchedulerTick();
      } catch (err) {
        console.log("[X] Scheduler error:", err.message);
      } finally {
        isTickRunning = false;
      }
    },
    {
      timezone: "Asia/Jakarta",
    },
  );

  jobs.push(job);
  isRunning = true;

  console.log("⚡ Schedule executor started");
}

function restartScheduler() {
  clearJobs();
  isRunning = false;
  startScheduler();
}

function stopScheduler() {
  clearJobs();

  isRunning = false;
  isTickRunning = false;

  console.log("🛑 Scheduler stopped");
}

export { getSchedulerStatus, startScheduler, restartScheduler, stopScheduler };
