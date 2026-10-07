import { schedule } from "node-cron";
import { nowLocalISO } from "../helpers/time.helper.js";
import { timeConfig } from "../config/time.config.js";
import { isExternalWorkAllowed } from "./lifecycle.service.js";

import {
  generateDailySchedules,
  getJakartaDate,
} from "./daily-schedule.service.js";

let generatorJob = null;
let isGeneratorRunning = false;
let lastRunAt = null;
let lastResult = null;
let lastError = null;
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;
let recheckTimer = null;
let generationPromise = null;
let generationEpoch = 0;
let lastTrigger = null;

/**
 * Menjalankan pembuatan jadwal harian.
 *
 * Fungsi ini aman dipanggil berulang karena tabel
 * daily_schedules memiliki UNIQUE:
 * user_id + schedule_date + type.
 */
async function executeGeneration(date, trigger, shouldContinue) {
  const scheduleDate = getJakartaDate(date);

  lastRunAt = nowLocalISO();
  lastTrigger = trigger;

  try {
    const result = await generateDailySchedules(date, { shouldContinue });

    if (result.cancelled || !shouldContinue()) return result;

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
    if (!shouldContinue()) {
      return { schedule_date: scheduleDate, generated: 0, skipped: 0, cancelled: true };
    }
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

function runDailyScheduleGeneration(date = new Date(), trigger = "manual") {
  if (generationPromise) return generationPromise;

  const epoch = generationEpoch;
  const shouldContinue = () =>
    epoch === generationEpoch && isExternalWorkAllowed() &&
    (trigger === "manual" || (isGeneratorRunning && getJakartaDate() === getJakartaDate(date)));

  generationPromise = executeGeneration(date, trigger, shouldContinue).finally(() => {
    generationPromise = null;
  });
  return generationPromise;
}

/**
 * Menyalakan generator jadwal.
 *
 * Generator dijalankan:
 * 1. Sekali ketika aplikasi startup.
 * 2. Setiap hari pukul 00:00:05 WIB.
 * 3. Pemeriksaan ulang tiap lima menit, terpisah dari pemicu cron.
 */
async function startDailyScheduleGenerator() {
  if (!isExternalWorkAllowed()) return getDailyScheduleGeneratorStatus();

  if (isGeneratorRunning) {
    console.log("[i] Daily schedule generator already running");

    if (generationPromise) await generationPromise;
    return getDailyScheduleGeneratorStatus();
  }

  /*
   * Pastikan jadwal hari ini tersedia ketika
   * aplikasi pertama kali dijalankan.
   */
  isGeneratorRunning = true;
  const epoch = generationEpoch;
  const runScheduled = (trigger) => {
    if (!isGeneratorRunning || epoch !== generationEpoch || !isExternalWorkAllowed()) return;
    return runDailyScheduleGeneration(new Date(), trigger);
  };

  /*
   * Detik 5 dipilih agar tanggal lokal sudah
   * benar-benar berganti sebelum generator berjalan.
   */
  generatorJob = schedule(
    "5 0 0 * * *",
    async () => {
      await runScheduled("daily-cron");
    },
    {
      timezone: timeConfig.timeZone,
    },
  );

  // An interval checks today's database even if the midnight cron was missed.
  // Register before the first run so a startup failure can recover automatically.
  recheckTimer = setInterval(() => { void runScheduled("periodic-recheck"); }, RECHECK_INTERVAL_MS);
  recheckTimer.unref?.();

  await runScheduled("startup");

  console.log("Daily schedule generator started");

  return getDailyScheduleGeneratorStatus();
}

function stopDailyScheduleGenerator() {
  generationEpoch++;
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = null;
  }
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
    recheckRunning: recheckTimer !== null,
    recheckIntervalMs: RECHECK_INTERVAL_MS,
    generationRunning: generationPromise !== null,
    lastTrigger,
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
