import db from "../../database/db.js";
import { timeConfig } from "../config/time.config.js";
import { getSystemSetting, setSystemSetting } from "../models/system-setting.model.js";
import { getTimezoneChangeProtection } from "./timezone-protection.service.js";

const zones = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
export function validateTimezone(value) {
  if (!zones.includes(value)) {
    throw Object.assign(new Error("Pilih WIB, WITA, atau WIT."), { code: "INVALID_TIMEZONE" });
  }
}
export function hasPendingTimezoneRestart() {
  return Boolean(getSystemSetting("timezone_restart_pending"));
}
export function getTimezoneSetting() {
  const pending = getSystemSetting("timezone_restart_pending")?.value;
  const value = pending ?? getSystemSetting("timezone")?.value ?? timeConfig.timeZone;
  const remaining = pending ? db.prepare("SELECT COUNT(*) AS total FROM daily_schedules WHERE status IN ('pending', 'processing')").get().total : 0;
  return { value, active: timeConfig.timeZone, restartRequired: value !== timeConfig.timeZone, pendingRestart: Boolean(pending), remainingSchedules: remaining, ...getTimezoneChangeProtection() };
}
export function hasUnfinishedSchedules() {
  return db.prepare("SELECT COUNT(*) AS count FROM daily_schedules WHERE status IN ('pending', 'processing')").get().count > 0;
}
export function saveTimezoneSetting(value) {
  validateTimezone(value);
  if (hasUnfinishedSchedules()) {
    throw Object.assign(new Error("Selesaikan jadwal pending/processing sebelum mengubah timezone."), { code: "TIMEZONE_BUSY" });
  }
  db.transaction(() => {
    setSystemSetting("timezone_active", timeConfig.timeZone);
    setSystemSetting("timezone", value);
  })();
  return getTimezoneSetting();
}
export function initializeRuntimeTimezone() {
  const saved = getSystemSetting("timezone")?.value;
  if (!saved) return;
  if (!zones.includes(saved)) throw new Error("Invalid stored timezone setting");
  const previouslyActive = getSystemSetting("timezone_active")?.value ?? timeConfig.timeZone;
  if (saved !== previouslyActive && hasUnfinishedSchedules()) {
    // Never reinterpret outstanding local timestamps in a different timezone.
    throw new Error("Timezone change blocked by unfinished schedules");
  }
  timeConfig.timeZone = saved;
  process.env.TZ = saved;
  setSystemSetting("timezone_active", saved);
}
