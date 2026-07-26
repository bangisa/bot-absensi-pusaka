import db from "../database/db.js";

import {
  markScheduleProcessing,
  markScheduleSuccess,
  markScheduleFailed,
  markScheduleSkipped,
} from "../app/models/index.js";

/**
 * Membaca satu jadwal berdasarkan ID.
 */
function findScheduleById(scheduleId) {
  return db
    .prepare(
      `
      SELECT *
      FROM daily_schedules
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(scheduleId);
}

/**
 * Menampilkan status jadwal.
 */
function showSchedule(scheduleId, label) {
  const schedule = findScheduleById(scheduleId);

  console.log(`\n=== ${label} ===`);
  console.table(schedule ? [schedule] : []);

  return schedule;
}

/**
 * Pengujian transisi status:
 *
 * pending -> processing -> success/failed/skipped
 */
function testScheduleStatus(scheduleId, finalStatus) {
  const schedule = showSchedule(scheduleId, "STATUS AWAL");

  if (!schedule) {
    throw new Error(`Jadwal ID ${scheduleId} tidak ditemukan`);
  }

  if (schedule.status !== "pending") {
    throw new Error(`Status awal harus pending, saat ini: ${schedule.status}`);
  }

  const processingResult = markScheduleProcessing(scheduleId);

  console.log("\nHasil markScheduleProcessing:", processingResult);

  if (processingResult.changes === 0) {
    throw new Error("Jadwal gagal diubah menjadi processing");
  }

  showSchedule(scheduleId, "SETELAH PROCESSING");

  let finalResult;

  if (finalStatus === "success") {
    finalResult = markScheduleSuccess(scheduleId, "Tes manual berhasil");
  } else if (finalStatus === "failed") {
    finalResult = markScheduleFailed(scheduleId, "Tes manual gagal");
  } else if (finalStatus === "skipped") {
    finalResult = markScheduleSkipped(scheduleId, "Tes manual dilewati");
  } else {
    throw new Error(`Final status tidak valid: ${finalStatus}`);
  }

  console.log(`\nHasil markSchedule${finalStatus}:`, finalResult);

  showSchedule(scheduleId, "STATUS AKHIR");
}

const scheduleId = Number(process.argv[2]);

const finalStatus = process.argv[3] ?? "success";

if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
  console.log("Cara penggunaan:");

  console.log(
    "node --env-file=.env scripts/test-daily-schedule.js <scheduleId> <success|failed|skipped>",
  );

  process.exit(1);
}

try {
  testScheduleStatus(scheduleId, finalStatus);

  console.log("\n✅ Pengujian selesai");
} catch (error) {
  console.error("\n❌ Pengujian gagal:", error.message);

  process.exitCode = 1;
}
