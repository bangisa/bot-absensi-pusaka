import { getZonedDate } from "../helpers/time.helper.js";
import { checkNationalHoliday } from "./holiday.service.js";
import { consumeServiceDay } from "../models/user-service.model.js";

export async function useServiceDayForExecution(userId, scheduleDate = getZonedDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) || !Number.isFinite(Date.parse(scheduleDate))) throw new Error("Tanggal layanan tidak valid.");
  if (new Date(`${scheduleDate}T12:00:00Z`).getUTCDay() === 0) return false;
  const holiday = await checkNationalHoliday(scheduleDate);
  if (holiday.isHoliday) return false;
  // A finite entitlement must not be debited against an unknown calendar.
  if (!holiday.available) throw new Error("Kalender hari kerja belum tersedia; kuota belum digunakan.");
  return consumeServiceDay(userId, scheduleDate);
}
