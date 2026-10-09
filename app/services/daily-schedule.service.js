import {
  findDailySchedule,
  findRecentDailySchedules,
  insertDailySchedule,
} from "../models/daily-schedule.model.js";

import { findAllUsers } from "../models/user.model.js";
import { canUseServiceDay } from "../models/user-service.model.js";
import { checkNationalHoliday } from "./holiday.service.js";
import { getZonedDate, getZonedDay, getZonedTime } from "../helpers/time.helper.js";

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
  return {
    start: "06:03",
    end: "06:33",
  };
}

/**
 * Menentukan rentang jadwal pulang berdasarkan hari.
 */
function getPulangRange(dayName) {
  if (dayName === "friday") {
    return {
      start: "12:18",
      end: "12:48",
    };
  }

  if (dayName === "saturday") {
    return {
      start: "15:03",
      end: "15:33",
    };
  }

  return {
    start: "14:33",
    end: "15:03",
  };
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

  if (dayName === "sunday") {
    return {
      schedule_date: scheduleDate,
      generated: 0,
      skipped: 0,
      message: "Hari Minggu, jadwal tidak dibuat",
    };
  }

  const holiday = await checkNationalHoliday(scheduleDate);

  // Stop/shutdown may arrive while the holiday provider is still responding.
  if (!shouldContinue()) return cancelled();

  if (!holiday.available) {
    console.log(
      `[HOLIDAY] Gagal cek libur nasional ${scheduleDate}: ${holiday.error}`,
    );
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
  generateDailySchedules,
  getJakartaDate,
  getJakartaDay,
  getJakartaTime,
  randomTimeBetween,
};
