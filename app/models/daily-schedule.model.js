import db from "../../database/db.js";
import { nowSQL } from "../helpers/index.js";

/**
 * Mencari satu jadwal berdasarkan user, tanggal,
 * dan jenis presensi.
 */
function findDailySchedule(userId, scheduleDate, type) {
  return db
    .prepare(
      `
      SELECT *
      FROM daily_schedules
      WHERE user_id = ?
        AND schedule_date = ?
        AND type = ?
      LIMIT 1
      `,
    )
    .get(userId, scheduleDate, type);
}

/**
 * Mengambil seluruh jadwal pada tanggal tertentu.
 */
function findDailySchedulesByDate(scheduleDate) {
  return db
    .prepare(
      `
      SELECT *
      FROM daily_schedules
      WHERE schedule_date = ?
      ORDER BY
        scheduled_time ASC,
        user_id ASC,
        type ASC
      `,
    )
    .all(scheduleDate);
}

/**
 * Mengambil jadwal berstatus pending pada tanggal tertentu.
 *
 * Scheduler akan memeriksa scheduled_time sebelum
 * memasukkannya ke queue.
 */
function findPendingSchedulesByDate(scheduleDate) {
  return db
    .prepare(
      `
      SELECT *
      FROM daily_schedules
      WHERE schedule_date = ?
        AND status = 'pending'
      ORDER BY
        scheduled_time ASC,
        user_id ASC,
        type ASC
      `,
    )
    .all(scheduleDate);
}

/**
 * Menambahkan jadwal harian.
 *
 * INSERT OR IGNORE digunakan agar jadwal yang sama
 * tidak dibuat dua kali.
 */
function insertDailySchedule(data) {
  return db
    .prepare(
      `
      INSERT OR IGNORE INTO daily_schedules (
        user_id,
        schedule_date,
        type,
        scheduled_time,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, 'pending', ?)
      `,
    )
    .run(
      data.user_id,
      data.schedule_date,
      data.type,
      data.scheduled_time,
      nowSQL(),
    );
}

/**
 * Mengunci jadwal sebelum dimasukkan ke queue.
 *
 * Update hanya berhasil apabila statusnya masih pending.
 * Nilai changes === 0 berarti jadwal sudah diambil
 * atau telah selesai diproses.
 */
function markScheduleProcessing(scheduleId) {
  return db
    .prepare(
      `
      UPDATE daily_schedules
      SET
        status = 'processing',
        message = 'Jadwal sedang diproses'
      WHERE id = ?
        AND status = 'pending'
      `,
    )
    .run(scheduleId);
}

/**
 * Menandai jadwal berhasil dijalankan.
 */
function markScheduleSuccess(scheduleId, message = "Presensi berhasil") {
  return db
    .prepare(
      `
      UPDATE daily_schedules
      SET
        status = 'success',
        executed_at = ?,
        message = ?
      WHERE id = ?
        AND status = 'processing'
      `,
    )
    .run(nowSQL(), message, scheduleId);
}

/**
 * Menandai jadwal gagal dijalankan.
 *
 * Status pending juga diizinkan karena kegagalan dapat
 * terjadi sebelum jadwal berhasil dikunci, misalnya
 * pengguna tidak ditemukan.
 */
function markScheduleFailed(scheduleId, message = "Presensi gagal") {
  return db
    .prepare(
      `
      UPDATE daily_schedules
      SET
        status = 'failed',
        executed_at = ?,
        message = ?
      WHERE id = ?
        AND status IN (
          'pending',
          'processing'
        )
      `,
    )
    .run(nowSQL(), message, scheduleId);
}

/**
 * Menandai jadwal dilewati.
 */
function markScheduleSkipped(scheduleId, message = "Presensi dilewati") {
  return db
    .prepare(
      `
      UPDATE daily_schedules
      SET
        status = 'skipped',
        executed_at = ?,
        message = ?
      WHERE id = ?
        AND status = 'processing'
      `,
    )
    .run(nowSQL(), message, scheduleId);
}

/**
 * Mengembalikan jadwal processing menjadi pending.
 *
 * Digunakan ketika aplikasi sebelumnya berhenti
 * sebelum proses presensi selesai.
 */
function resetProcessingSchedules(scheduleDate) {
  return db
    .prepare(
      `
      UPDATE daily_schedules
      SET
        status = 'pending',
        executed_at = NULL,
        message = 'Dikembalikan ke pending saat scheduler dimulai'
      WHERE schedule_date = ?
        AND status = 'processing'
      `,
    )
    .run(scheduleDate);
}

export {
  findDailySchedule,
  findDailySchedulesByDate,
  findPendingSchedulesByDate,
  insertDailySchedule,
  markScheduleProcessing,
  markScheduleSuccess,
  markScheduleFailed,
  markScheduleSkipped,
  resetProcessingSchedules,
};
