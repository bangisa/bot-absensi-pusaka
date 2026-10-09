import db from "../../database/db.js";
import { timeConfig } from "../config/time.config.js";
import { getSystemSetting, setSystemSetting } from "../models/system-setting.model.js";

const zones = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
export function getTimezoneSetting() {
  const value = getSystemSetting("timezone")?.value ?? timeConfig.timeZone;
  return { value, active: timeConfig.timeZone, restartRequired: value !== timeConfig.timeZone };
}
export function hasUnfinishedSchedules() {
  return db.prepare("SELECT COUNT(*) AS count FROM daily_schedules WHERE status IN ('pending', 'processing')").get().count > 0;
}
export function saveTimezoneSetting(value) {
  if (!zones.includes(value)) {
    throw Object.assign(new Error("Pilih WIB, WITA, atau WIT."), { code: "INVALID_TIMEZONE" });
  }
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
