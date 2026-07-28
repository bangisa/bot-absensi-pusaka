import db from "../../database/db.js";
import { nowSQL } from "../helpers/index.js";

function getJakartaDateTimeAfter(seconds) {
  const date = new Date(Date.now() + seconds * 1000);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return (
    `${values.year}-${values.month}-${values.day} ` +
    `${values.hour}:${values.minute}:${values.second}`
  );
}

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
 * Mengambil seluruh jadwal pending beserta data user.
 */
function findPendingSchedulesByDate(scheduleDate, currentDateTime) {
  const rows = db
    .prepare(
      `
      SELECT
        ds.id,
        ds.user_id,
        ds.schedule_date,
        ds.type,
        ds.scheduled_time,
        ds.status,
        ds.executed_at,
        ds.message,
        ds.attempt_count,
        ds.max_attempts,
        ds.next_retry_at,

        u.id            AS u_id,
        u.username      AS u_username,
        u.password      AS u_password,
        u.latitude      AS u_latitude,
        u.longitude     AS u_longitude,
        u.masuk         AS u_masuk,
        u.pulang        AS u_pulang,
        u.jumat         AS u_jumat,
        u.sabtu         AS u_sabtu,
        u.auto_login    AS u_auto_login

      FROM daily_schedules ds

      INNER JOIN users u
        ON u.id = ds.user_id

      WHERE
        ds.schedule_date = ?
        AND ds.status = 'pending'
        AND (
          ds.next_retry_at IS NULL
          OR ds.next_retry_at <= ?
        )

      ORDER BY
        ds.scheduled_time ASC,
        ds.user_id ASC,
        ds.type ASC
      `,
    )
    .all(scheduleDate, currentDateTime);

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    schedule_date: row.schedule_date,
    type: row.type,
    scheduled_time: row.scheduled_time,
    status: row.status,
    executed_at: row.executed_at,
    message: row.message,

    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    next_retry_at: row.next_retry_at,

    user: {
      id: row.u_id,
      username: row.u_username,
      password: row.u_password,
      latitude: row.u_latitude,
      longitude: row.u_longitude,
      masuk: row.u_masuk,
      pulang: row.u_pulang,
      jumat: row.u_jumat,
      sabtu: row.u_sabtu,
      auto_login: row.u_auto_login,
    },
  }));
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
        attempt_count = attempt_count + 1,
        next_retry_at = NULL,
        message = 'Jadwal sedang diproses'
      WHERE id = ?
        AND status = 'pending'
        AND attempt_count < max_attempts
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

function markScheduleRetry(
  scheduleId,
  message = "Presensi akan dicoba kembali",
) {
  const schedule = db
    .prepare(
      `
      SELECT
        attempt_count,
        max_attempts
      FROM daily_schedules
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(scheduleId);

  if (!schedule) {
    return {
      retried: false,
      failed: false,
      reason: "schedule_not_found",
    };
  }

  /*
   * Jika jumlah percobaan sudah mencapai batas,
   * jadwal langsung ditandai gagal permanen.
   */
  if (schedule.attempt_count >= schedule.max_attempts) {
    const failedResult = markScheduleFailed(
      scheduleId,
      `${message}. Batas percobaan tercapai`,
    );

    return {
      retried: false,
      failed: failedResult.changes > 0,
      attempt_count: schedule.attempt_count,
      max_attempts: schedule.max_attempts,
    };
  }

  /*
   * Exponential backoff sederhana:
   *
   * Percobaan ke-1 gagal:
   * retry dalam 30 detik.
   *
   * Percobaan ke-2 gagal:
   * retry dalam 60 detik.
   */
  const retryDelaySeconds =
    30 * Math.pow(2, Math.max(schedule.attempt_count - 1, 0));

  const nextRetryAt = getJakartaDateTimeAfter(retryDelaySeconds);

  const retryResult = db
    .prepare(
      `
      UPDATE daily_schedules
      SET
        status = 'pending',
        executed_at = NULL,
        next_retry_at = ?,
        message = ?
      WHERE id = ?
        AND status = 'processing'
        AND attempt_count < max_attempts
      `,
    )
    .run(nextRetryAt, `${message}. Retry pada ${nextRetryAt}`, scheduleId);

  return {
    retried: retryResult.changes > 0,
    failed: false,
    attempt_count: schedule.attempt_count,
    max_attempts: schedule.max_attempts,
    next_retry_at: nextRetryAt,
    delay_seconds: retryDelaySeconds,
  };
}

/**
 * Mengembalikan jadwal processing menjadi pending.
 *
 * Digunakan ketika aplikasi sebelumnya berhenti
 * sebelum proses presensi selesai.
 */
function resetProcessingSchedules(scheduleDate) {
  const recoverSchedules = db.transaction(() => {
    /*
     * Jadwal yang masih memiliki kesempatan retry
     * dikembalikan menjadi pending.
     */
    const pendingResult = db
      .prepare(
        `
          UPDATE daily_schedules
          SET
            status = 'pending',
            executed_at = NULL,
            next_retry_at = NULL,
            message = ?
          WHERE schedule_date = ?
            AND status = 'processing'
            AND attempt_count < max_attempts
          `,
      )
      .run(
        "Proses sebelumnya terhenti. Jadwal dikembalikan ke pending",
        scheduleDate,
      );

    /*
     * Jadwal yang telah mencapai batas percobaan
     * tidak boleh dijalankan lagi.
     */
    const failedResult = db
      .prepare(
        `
          UPDATE daily_schedules
          SET
            status = 'failed',
            next_retry_at = NULL,
            message = ?
          WHERE schedule_date = ?
            AND status = 'processing'
            AND attempt_count >= max_attempts
          `,
      )
      .run(
        "Proses sebelumnya terhenti dan batas percobaan telah tercapai",
        scheduleDate,
      );

    return {
      recovered: pendingResult.changes,
      failed: failedResult.changes,
      total: pendingResult.changes + failedResult.changes,
    };
  });

  return recoverSchedules();
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
  markScheduleRetry,
  resetProcessingSchedules,
};
