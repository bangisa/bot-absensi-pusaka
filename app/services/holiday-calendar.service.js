import { getSystemSetting, setSystemSetting, deleteSystemSetting } from "../models/system-setting.model.js";
import { fetchCalendar } from "../helpers/holiday-calendar.helper.js";
import { isExternalWorkAllowed } from "./lifecycle.service.js";

const KEY = "holiday_calendar";

function readCalendar() {
  const row = getSystemSetting(KEY);
  return row ? JSON.parse(row.value) : null;
}

function summary(calendar) {
  return calendar ? {
    enabled: true, url: calendar.url, year: calendar.year,
    count: calendar.holidays.length, fetchedAt: calendar.fetchedAt,
    preview: calendar.holidays.slice(0, 3),
  } : { enabled: false, url: "", year: null, count: 0 };
}

function ensureWritable() {
  if (!isExternalWorkAllowed()) {
    throw Object.assign(new Error("Sistem sedang berhenti. Coba kembali setelah restart."), { code: "CALENDAR_DRAINING" });
  }
}

export function getHolidayCalendarSetting() { return summary(readCalendar()); }
export async function testHolidayCalendar(url) { return summary(await fetchCalendar(url)); }
export async function saveHolidayCalendar(url) {
  ensureWritable();
  const calendar = await fetchCalendar(url);
  ensureWritable();
  // One atomic row preserves the previous URL and data if validation fails.
  setSystemSetting(KEY, JSON.stringify(calendar));
  return summary(calendar);
}
export function resetHolidayCalendar() {
  ensureWritable();
  deleteSystemSetting(KEY);
  return summary(null);
}
export function checkSavedHolidayCalendar(date) {
  const calendar = readCalendar();
  if (!calendar || !date.startsWith(`${calendar.year}-`)) return null;
  const holiday = calendar.holidays.find((entry) => entry.date === date);
  return {
    available: true, date, isHoliday: Boolean(holiday), name: holiday?.name ?? null,
    isCutiBersama: holiday?.isCutiBersama ?? false, source: "saved-calendar",
  };
}
