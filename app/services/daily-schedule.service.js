import {
  findDailySchedule,
  insertDailySchedule,
} from "../models/daily-schedule.model.js";

import { findAllUsers } from "../models/user.model.js";

/**
 * Mengubah waktu HH:mm menjadi jumlah menit.
 */
function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
}

/**
 * Mengubah jumlah menit menjadi HH:mm.
 */
function minutesToTime(totalMinutes) {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;

  const hour = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Menghasilkan waktu acak di antara dua waktu.
 */
function randomTimeBetween(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (endMinutes < startMinutes) {
    throw new Error(`Rentang waktu tidak valid: ${startTime}-${endTime}`);
  }

  const randomMinutes =
    Math.floor(Math.random() * (endMinutes - startMinutes + 1)) + startMinutes;

  return minutesToTime(randomMinutes);
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
    hour12: false,
  }).format(date);
}

/**
 * Menentukan rentang jadwal masuk.
 */
function getMasukRange() {
  return {
    start: "06:00",
    end: "06:30",
  };
}

/**
 * Menentukan rentang jadwal pulang berdasarkan hari.
 */
function getPulangRange(dayName) {
  if (dayName === "friday") {
    return {
      start: "11:30",
      end: "13:00",
    };
  }

  if (dayName === "saturday") {
    return {
      start: "15:00",
      end: "16:00",
    };
  }

  return {
    start: "14:30",
    end: "16:00",
  };
}

/**
 * Membuat jadwal harian untuk seluruh pengguna.
 */
function generateDailySchedules(date = new Date()) {
  const scheduleDate = getJakartaDate(date);
  const dayName = getJakartaDay(date);

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
      const masukResult = insertDailySchedule({
        user_id: user.id,
        schedule_date: scheduleDate,
        type: "masuk",
        scheduled_time: randomTimeBetween(masukRange.start, masukRange.end),
      });

      if (masukResult.changes > 0) {
        generated++;
      }
    } else {
      skipped++;
    }

    const pulangRange = getPulangRange(dayName);

    const existingPulang = findDailySchedule(user.id, scheduleDate, "pulang");

    if (!existingPulang) {
      const pulangResult = insertDailySchedule({
        user_id: user.id,
        schedule_date: scheduleDate,
        type: "pulang",
        scheduled_time: randomTimeBetween(pulangRange.start, pulangRange.end),
      });

      if (pulangResult.changes > 0) {
        generated++;
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
