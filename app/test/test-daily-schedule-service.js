import { generateDailySchedules } from "../services/daily-schedule.service.js";

try {
  const result = generateDailySchedules();

  console.log("Hasil generator:");
  console.log(result);
} catch (error) {
  console.error("Generator jadwal gagal:", error);

  process.exit(1);
}
