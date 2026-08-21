import {
  findDailySchedule,
  insertDailySchedule,
} from "../models/daily-schedule.model.js";

import { findAllUsers } from "../models/user.model.js";

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

function isTimeAfter(time, targetTime) {
  return timeToSeconds(time) > timeToSeconds(targetTime);
}

/**
 * Mendapatkan tanggal lokal Asia/Jakarta dalam format YYYY-MM-DD.
 */
function getJakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Mendapatkan nama hari lokal Asia/Jakarta.
 */
function getJakartaDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
  })
    .format(date)
    .toLowerCase();
}

/**
 * Mendapatkan waktu lokal Asia/Jakarta dalam format HH:mm.
 */
function getJakartaTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
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
function generateDailySchedules(date = new Date()) {
  const scheduleDate = getJakartaDate(date);
  const dayName = getJakartaDay(date);
  const currentTime = getJakartaTime(date);

  if (dayName === "sunday") {
    return {
      schedule_date: scheduleDate,
      generated: 0,
      skipped: 0,
      message: "Hari Minggu, jadwal tidak dibuat",
    };
  }

  const users = findAllUsers();

  let generated = 0;
  let skipped = 0;

  for (const user of users) {
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
          scheduled_time: randomTimeBetween(masukRange.start, masukRange.end),
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
          scheduled_time: randomTimeBetween(pulangRange.start, pulangRange.end),
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
  };
}

export {
  generateDailySchedules,
  getJakartaDate,
  getJakartaDay,
  getJakartaTime,
  randomTimeBetween,
};
