import {
  insertDailySchedule,
  findDailySchedule,
  findDailySchedulesByDate,
} from "../models/daily-schedule.model.js";

const scheduleDate = "2026-07-25";

const insertResult = insertDailySchedule({
  user_id: 1,
  schedule_date: scheduleDate,
  type: "masuk",
  scheduled_time: "06:17",
});

console.log("Insert result:", insertResult);

const schedule = findDailySchedule(1, scheduleDate, "masuk");

console.log("Jadwal ditemukan:", schedule);

const schedules = findDailySchedulesByDate(scheduleDate);

console.log("Semua jadwal:", schedules);
