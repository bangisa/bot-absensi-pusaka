import {
  findDailySchedule,
  findRecentDailySchedules,
  insertDailySchedule,
} from "../models/daily-schedule.model.js";

import { findAllUsers } from "../models/user.model.js";
import { canUseServiceDay } from "../models/user-service.model.js";
import { checkNationalHoliday } from "./holiday.service.js";
import { getZonedDate, getZonedDay, getZonedTime } from "../helpers/time.helper.js";
import db from "../../database/db.js";
import { getScheduleRanges } from "./schedule-setting.service.js";

/**
 * Mengubah waktu HH:mm menjadi jumlah menit.
 */
function timeToSeconds(time) {
  const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);

  return hour * 3600 + minute * 60 + second;
}

/**
 * Mengubah jumlah menit menjadi HH:mm.
 */
function secondsToTime(totalSeconds) {
  const normalizedSeconds = ((totalSeconds % 86400) + 86400) % 86400;

  const hour = Math.floor(normalizedSeconds / 3600);

  const minute = Math.floor((normalizedSeconds % 3600) / 60);

  const second = normalizedSeconds % 60;

  return [
    String(hour).padStart(2, "0"),
    String(minute).padStart(2, "0"),
    String(second).padStart(2, "0"),
  ].join(":");
}

function timeToMinuteKey(time) {
  const [hour = "00", minute = "00"] = time.split(":");

  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/**
 * Menghasilkan waktu acak di antara dua waktu.
 */
function randomTimeBetween(startTime, endTime) {
  const startSeconds = timeToSeconds(startTime);

  const endSeconds = timeToSeconds(endTime);

  if (endSeconds < startSeconds) {
    throw new Error(`Rentang waktu tidak valid: ${startTime}-${endTime}`);
  }

  const randomSeconds =
    Math.floor(Math.random() * (endSeconds - startSeconds + 1)) + startSeconds;

  return secondsToTime(randomSeconds);
}

function randomTimeBetweenExcludingMinutes(
  startTime,
  endTime,
  excludedMinuteKeys = [],
) {
  const startSeconds = timeToSeconds(startTime);

  const endSeconds = timeToSeconds(endTime);

  if (endSeconds < startSeconds) {
    throw new Error(`Rentang waktu tidak valid: ${startTime}-${endTime}`);
  }

  const excludedMinutes = new Set(excludedMinuteKeys);
  const allowedSeconds = [];

  for (let second = startSeconds; second <= endSeconds; second++) {
    const time = secondsToTime(second);

    if (!excludedMinutes.has(timeToMinuteKey(time))) {
      allowedSeconds.push(second);
    }
  }

  if (allowedSeconds.length === 0) {
    return randomTimeBetween(startTime, endTime);
  }

  const randomIndex = Math.floor(Math.random() * allowedSeconds.length);

  return secondsToTime(allowedSeconds[randomIndex]);
}

function getRecentScheduleMinuteKeys(userId, type, scheduleDate) {
  return findRecentDailySchedules(userId, type, scheduleDate, 2).map((row) =>
    timeToMinuteKey(row.scheduled_time),
  );
}

function shuffleUsers(users) {
  const shuffled = [...users];

  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));

    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function isTimeAfter(time, targetTime) {
  return timeToSeconds(time) > timeToSeconds(targetTime);
}




/**
 * Menentukan rentang jadwal masuk.
 */
function getMasukRange() {
  return getScheduleRanges().masuk;
}

/**
 * Menentukan rentang jadwal pulang berdasarkan hari.
 */
function getPulangRange(dayName) {
  const ranges = getScheduleRanges();
  return ranges[dayName === "friday" || dayName === "saturday" ? dayName : "pulang"];
}

function reschedulePendingToday(date = new Date()) {
  const scheduleDate = getZonedDate(date);
  const dayName = getZonedDay(date);
  const currentTime = getZonedTime(date);
  const result = { updated: 0, unchanged: 0, elapsed: 0 };
  if (dayName === "sunday") return result;
  const rows = db.prepare(`SELECT id, user_id, type, scheduled_time FROM daily_schedules
    WHERE schedule_date = ? AND status = 'pending' AND COALESCE(attempt_count, 0) = 0
      AND executed_at IS NULL AND next_retry_at IS NULL`).all(scheduleDate);
  const update = db.prepare(`UPDATE daily_schedules SET scheduled_time = ?
    WHERE id = ? AND status = 'pending' AND COALESCE(attempt_count, 0) = 0
      AND executed_at IS NULL AND next_retry_at IS NULL`);
  for (const row of shuffleUsers(rows)) {
    if (!["masuk", "pulang"].includes(row.type)) continue;
    const range = row.type === "masuk" ? getMasukRange() : getPulangRange(dayName);
    const end = `${range.end}:00`;
    if (currentTime >= end) { result.elapsed++; continue; }
    if (row.scheduled_time >= `${range.start}:00` && row.scheduled_time <= end) {
      result.unchanged++;
      continue;
    }
    const start = secondsToTime(Math.max(timeToSeconds(range.start), timeToSeconds(currentTime) + 1));
    const time = randomTimeBetweenExcludingMinutes(start, end,
      getRecentScheduleMinuteKeys(row.user_id, row.type, scheduleDate));
    result.updated += update.run(time, row.id).changes;
  }
  return result;
}

/**
 * Membuat jadwal harian untuk seluruh pengguna.
 */
async function generateDailySchedules(date = new Date(), { shouldContinue = () => true } = {}) {
  const scheduleDate = getZonedDate(date);
  const dayName = getZonedDay(date);
  const currentTime = getZonedTime(date);

  const cancelled = () => ({ schedule_date: scheduleDate, generated: 0, skipped: 0, cancelled: true });
  if (!shouldContinue()) return cancelled();

  const holiday = await checkNationalHoliday(scheduleDate);

  // Stop/shutdown may arrive while the holiday provider is still responding.
  if (!shouldContinue()) return cancelled();

  if (!holiday.available) {
    console.log(
      `[HOLIDAY] Gagal cek libur nasional ${scheduleDate}: ${holiday.error}`,
    );
  }

  if (dayName === "sunday") {
    return {
      schedule_date: scheduleDate,
      generated: 0,
      skipped: 0,
      holiday: {
        ...holiday,
        isHoliday: true,
        name: holiday.name ? `Hari Minggu; ${holiday.name}` : "Hari Minggu",
      },
      message: "Hari Minggu, jadwal tidak dibuat",
    };
  }

  if (holiday.isHoliday) {
    return {
      schedule_date: scheduleDate,
      generated: 0,
      skipped: 0,
      holiday,
      message: `Hari libur nasional (${holiday.name}), jadwal tidak dibuat`,
    };
  }

  const users = shuffleUsers(findAllUsers());

  let generated = 0;
  let skipped = 0;

  for (const user of users) {
    if (!canUseServiceDay(user.id, scheduleDate)) { skipped += 2; continue; }
    const masukRange = getMasukRange();

    const existingMasuk = findDailySchedule(user.id, scheduleDate, "masuk");

    if (!existingMasuk) {
      if (isTimeAfter(currentTime, masukRange.end)) {
        skipped++;
      } else {
        const masukResult = insertDailySchedule({
          user_id: user.id,
          schedule_date: scheduleDate,
          type: "masuk",
          scheduled_time: randomTimeBetweenExcludingMinutes(
            masukRange.start,
            masukRange.end,
            getRecentScheduleMinuteKeys(user.id, "masuk", scheduleDate),
          ),
        });

        if (masukResult.changes > 0) {
          generated++;
        }
      }
    } else {
      skipped++;
    }

    const pulangRange = getPulangRange(dayName);

    const existingPulang = findDailySchedule(user.id, scheduleDate, "pulang");

    if (!existingPulang) {
      if (isTimeAfter(currentTime, pulangRange.end)) {
        skipped++;
      } else {
        const pulangResult = insertDailySchedule({
          user_id: user.id,
          schedule_date: scheduleDate,
          type: "pulang",
          scheduled_time: randomTimeBetweenExcludingMinutes(
            pulangRange.start,
            pulangRange.end,
            getRecentScheduleMinuteKeys(user.id, "pulang", scheduleDate),
          ),
        });

        if (pulangResult.changes > 0) {
          generated++;
        }
      }
    } else {
      skipped++;
    }
  }

  return {
    schedule_date: scheduleDate,
    generated,
    skipped,
    total_users: users.length,
    holiday,
  };
}


const getJakartaDate = getZonedDate;
const getJakartaDay = getZonedDay;
const getJakartaTime = getZonedTime;

export {
  reschedulePendingToday,
  generateDailySchedules,
  getJakartaDate,
  getJakartaDay,
  getJakartaTime,
  randomTimeBetween,
};
