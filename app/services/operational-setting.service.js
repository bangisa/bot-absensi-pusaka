import db from "../../database/db.js";
import { getSystemSetting, setSystemSetting } from "../models/system-setting.model.js";
import { geoConfig } from "../config/geo.config.js";
import { backupConfig } from "../config/backup.config.js";

const defaults = {
  geoRadiusMeters: Math.min(200, geoConfig.radiusMeters),
  backupEnabled: backupConfig.enabled,
  backupRetentionCount: Math.min(8, backupConfig.retentionCount),
  logRetentionDays: 3,
};
let active = { ...defaults };

function validate(value, stored = false) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 4 || typeof value.backupEnabled !== "boolean") {
    throw Object.assign(new Error("Pengaturan operasional tidak valid."), { code: "INVALID_OPERATIONAL_SETTING" });
  }
  for (const [key, min, max] of [
    ["geoRadiusMeters", 0, stored ? 10000 : 200],
    ["backupRetentionCount", 1, stored ? 100 : 8],
    ["logRetentionDays", 1, 3650],
  ]) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) {
      throw Object.assign(new Error(`${key} harus berupa bilangan bulat ${min}-${max}.`), { code: "INVALID_OPERATIONAL_SETTING" });
    }
  }
  if (!stored && ![3, 7].includes(value.logRetentionDays)) {
    throw Object.assign(new Error("Retensi log presensi harus 3 atau 7 hari."), { code: "INVALID_OPERATIONAL_SETTING" });
  }
  return { geoRadiusMeters: value.geoRadiusMeters, backupEnabled: value.backupEnabled,
    backupRetentionCount: value.backupRetentionCount, logRetentionDays: value.logRetentionDays };
}

function apply(value) {
  active = { ...value, geoRadiusMeters: Math.min(200, value.geoRadiusMeters),
    backupRetentionCount: Math.min(8, value.backupRetentionCount) };
  geoConfig.radiusMeters = active.geoRadiusMeters;
  backupConfig.enabled = active.backupEnabled;
  backupConfig.retentionCount = active.backupRetentionCount;
}

export function initializeOperationalSettings() {
  const stored = getSystemSetting("operational_settings");
  if (stored) apply(validate(JSON.parse(stored.value), true));
  else apply(defaults);
}

export function getOperationalSettings() {
  return { ...active };
}

export function saveOperationalSettings(value) {
  const validated = validate(value);
  db.transaction(() => setSystemSetting("operational_settings", JSON.stringify(validated)))();
  apply(validated);
  return getOperationalSettings();
}
