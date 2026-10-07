import {
  getZonedDate,
  getZonedDateTime,
  getZonedTime,
} from "../helpers/time.helper.js";

let state = "RUNNING";
let shutdownRequested = false;
let shutdownSignal = null;
let shutdownRequestedAt = null;
let cutoffDate = null;
let cutoffTime = null;
let completedAt = null;

function requestShutdown(signal = "UNKNOWN") {
  if (shutdownRequested) {
    return false;
  }

  const now = new Date();

  shutdownRequested = true;
  shutdownSignal = signal;
  shutdownRequestedAt = getZonedDateTime(now);
  cutoffDate = getZonedDate(now);
  cutoffTime = getZonedTime(now);
  state = "DRAINING";

  return true;
}

function markShutdownComplete() {
  state = "STOPPED";
  completedAt = getZonedDateTime();
}

function isDraining() {
  return state === "DRAINING";
}

function isExternalWorkAllowed() {
  return state === "RUNNING";
}

/**
 * Ketika shutdown sedang draining, scheduler hanya boleh mengambil:
 * - retry dari pekerjaan yang sudah pernah dimulai; atau
 * - first-attempt yang seharusnya sudah jatuh tempo saat shutdown diminta.
 *
 * Jadwal first-attempt yang waktunya baru tiba setelah cutoff tidak ikut
 * masuk ke drain. Ini mencegah shutdown terus menerima workload baru.
 */
function shouldProcessScheduleDuringDrain(dailySchedule) {
  if (!isDraining()) {
    return true;
  }

  if (!dailySchedule || dailySchedule.schedule_date !== cutoffDate) {
    return false;
  }

  if (Number(dailySchedule.attempt_count || 0) > 0) {
    return true;
  }

  return String(dailySchedule.scheduled_time || "") <= cutoffTime;
}

function getLifecycleStatus() {
  return {
    state,
    shutdownRequested,
    signal: shutdownSignal,
    requestedAt: shutdownRequestedAt,
    cutoffDate,
    cutoffTime,
    completedAt,
  };
}

export {
  getLifecycleStatus,
  isDraining,
  isExternalWorkAllowed,
  markShutdownComplete,
  requestShutdown,
  shouldProcessScheduleDuringDrain,
};
