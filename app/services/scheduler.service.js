import { schedule } from "node-cron";

import {
  findAllUsers,
  findPendingSchedulesByDate,
  markScheduleProcessing,
  markScheduleSuccess,
  markScheduleFailed,
  markScheduleSkipped,
  resetProcessingSchedules,
} from "../models/index.js";

import { addToQueue } from "./queue.service.js";
import { openPusaka } from "./automation.service.js";

import {
  generateDailySchedules,
  getJakartaDate,
  getJakartaTime,
} from "./daily-schedule.service.js";

import { nowLog } from "../helpers/index.js";

let jobs = [];
let isRunning = false;
let isTickRunning = false;

function getSchedulerStatus() {
  return {
    running: isRunning,
    tickRunning: isTickRunning,
    totalJobs: jobs.length,
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

  addToQueue(async () => {
    const { type } = dailySchedule;

    console.log(
      `[${nowLog()}] [START] schedule=${dailySchedule.id} ${type} user=${user.id}`,
    );

    try {
      const result = await openPusaka(type, user);

      const message = result?.message ?? `Presensi ${type} selesai`;

      if (result?.status === "skipped") {
        markScheduleSkipped(dailySchedule.id, message);
      } else if (result?.status === "failed") {
        markScheduleFailed(dailySchedule.id, message);
      } else {
        markScheduleSuccess(dailySchedule.id, message);
      }
    } catch (err) {
      markScheduleFailed(dailySchedule.id, err.message);

      console.log(`[X] Task error user=${user.id}:`, err.message);
    }

    console.log(
      `[${nowLog()}] [DONE] schedule=${dailySchedule.id} ${type} user=${user.id}`,
    );
  }).catch((err) => {
    markScheduleFailed(dailySchedule.id, err.message);

    console.log(`[X] Queue error schedule=${dailySchedule.id}:`, err.message);
  });
}

async function runSchedulerTick() {
  const now = new Date();

  const scheduleDate = getJakartaDate(now);
  const currentTime = getJakartaTime(now);

  /*
   * Memastikan jadwal hari ini sudah tersedia.
   *
   * Aman dipanggil setiap menit karena database
   * memiliki UNIQUE(user_id, schedule_date, type).
   */
  const generation = generateDailySchedules(now);

  if (generation.generated > 0) {
    console.log(
      `[SCHEDULER] ${generation.generated} jadwal dibuat untuk ${scheduleDate}`,
    );
  }

  const users = await Promise.resolve(findAllUsers());

  const pendingSchedules = await Promise.resolve(
    findPendingSchedulesByDate(scheduleDate),
  );

  /*
   * Membuat pencarian pengguna berdasarkan ID
   * agar tidak perlu melakukan query per jadwal.
   */
  const usersById = new Map(users.map((user) => [user.id, user]));

  for (const dailySchedule of pendingSchedules) {
    /*
     * Jadwal yang waktunya belum tiba tidak
     * dijalankan.
     *
     * Format HH:mm dapat dibandingkan langsung
     * selama selalu memakai dua digit.
     */
    if (dailySchedule.scheduled_time > currentTime) {
      continue;
    }

    const user = usersById.get(dailySchedule.user_id);

    if (!user) {
      markScheduleFailed(
        dailySchedule.id,
        `User ${dailySchedule.user_id} tidak ditemukan`,
      );

      continue;
    }

    enqueueScheduleTask(dailySchedule, user);
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
  resetProcessingSchedules(scheduleDate);

  /*
   * Membuat jadwal ketika aplikasi dimulai.
   *
   * Ini penting apabila aplikasi tidak berjalan
   * tepat pada pergantian hari.
   */
  const generation = generateDailySchedules();

  console.log(
    `[SCHEDULER] Startup ${scheduleDate}: generated=${generation.generated}, skipped=${generation.skipped}`,
  );

  const job = schedule(
    "* * * * *",
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

  console.log("⚡ Scheduler started");
}

function restartScheduler() {
  clearJobs();
  isRunning = false;
  startScheduler();
}

function stopScheduler() {
  clearJobs();
  isRunning = false;

  console.log("🛑 Scheduler stopped");
}

export { getSchedulerStatus, startScheduler, restartScheduler, stopScheduler };
