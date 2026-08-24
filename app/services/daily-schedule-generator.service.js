import { schedule } from "node-cron";

import {
  generateDailySchedules,
  getJakartaDate,
} from "./daily-schedule.service.js";

let generatorJob = null;
let isGeneratorRunning = false;
let lastRunAt = null;
let lastResult = null;
let lastError = null;

/**
 * Menjalankan pembuatan jadwal harian.
 *
 * Fungsi ini aman dipanggil berulang karena tabel
 * daily_schedules memiliki UNIQUE:
 * user_id + schedule_date + type.
 */
async function runDailyScheduleGeneration(date = new Date()) {
  const scheduleDate = getJakartaDate(date);

  lastRunAt = new Date().toISOString();

  try {
    const result = await generateDailySchedules(date);

    lastResult = result;
    lastError = null;

    console.log(
      `[GENERATOR] ${scheduleDate}: generated=${result.generated}, skipped=${result.skipped}`,
    );

    if (result.message) {
      console.log(`[GENERATOR] ${result.message}`);
    }

    return result;
  } catch (err) {
    lastResult = null;
    lastError = err.message;

    console.log(`[X] Daily schedule generator error:`, err.message);

    return {
      schedule_date: scheduleDate,
      generated: 0,
      skipped: 0,
      error: err.message,
    };
  }
}

/**
 * Menyalakan generator jadwal.
 *
 * Generator dijalankan:
 * 1. Sekali ketika aplikasi startup.
 * 2. Setiap hari pukul 00:00:05 WIB.
 */
async function startDailyScheduleGenerator() {
  if (isGeneratorRunning) {
    console.log("[i] Daily schedule generator already running");

    return getDailyScheduleGeneratorStatus();
  }

  /*
   * Pastikan jadwal hari ini tersedia ketika
   * aplikasi pertama kali dijalankan.
   */
  const initialResult = await runDailyScheduleGeneration();

  if (initialResult.error) {
    return getDailyScheduleGeneratorStatus();
  }

  /*
   * Detik 5 dipilih agar tanggal lokal sudah
   * benar-benar berganti sebelum generator berjalan.
   */
  generatorJob = schedule(
    "5 0 0 * * *",
    async () => {
      await runDailyScheduleGeneration();
    },
    {
      timezone: "Asia/Jakarta",
    },
  );

  isGeneratorRunning = true;

  console.log("Daily schedule generator started");

  return getDailyScheduleGeneratorStatus();
}

function stopDailyScheduleGenerator() {
  if (generatorJob) {
    generatorJob.stop();
    generatorJob = null;
  }

  isGeneratorRunning = false;

  console.log("Daily schedule generator stopped");
}

function restartDailyScheduleGenerator() {
  stopDailyScheduleGenerator();
  return startDailyScheduleGenerator();
}

function getDailyScheduleGeneratorStatus() {
  return {
    running: isGeneratorRunning,
    hasJob: generatorJob !== null,
    healthy: isGeneratorRunning && !lastError,
    lastRunAt,
    lastResult,
    lastError,
  };
}

export {
  runDailyScheduleGeneration,
  startDailyScheduleGenerator,
  stopDailyScheduleGenerator,
  restartDailyScheduleGenerator,
  getDailyScheduleGeneratorStatus,
};
