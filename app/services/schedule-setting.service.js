import { getSystemSetting, setSystemSetting } from "../models/system-setting.model.js";

const defaults = {
  masuk: { start: "06:02", end: "06:17" },
  pulang: { start: "14:32", end: "14:47" },
  friday: { start: "12:18", end: "12:48" },
  saturday: { start: "15:02", end: "15:17" },
};

function validateScheduleRanges(value) {
  const invalid = () => Object.assign(new Error("Isi seluruh rentang dengan waktu HH:mm; mulai harus lebih awal daripada akhir."), { code: "INVALID_SCHEDULE_RANGES" });
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 4) throw invalid();
  const ranges = {};
  for (const key of Object.keys(defaults)) {
    const range = value[key];
    if (!range || typeof range !== "object" || Array.isArray(range) ||
        Object.keys(range).length !== 2 ||
        ![range.start, range.end].every(time => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) ||
        range.start >= range.end) throw invalid();
    ranges[key] = { start: range.start, end: range.end };
  }
  return ranges;
}

export function getScheduleRanges() {
  const stored = getSystemSetting("schedule_ranges");
  return validateScheduleRanges(stored ? JSON.parse(stored.value) : defaults);
}

export function saveScheduleRanges(value) {
  const ranges = validateScheduleRanges(value);
  setSystemSetting("schedule_ranges", JSON.stringify(ranges));
  return ranges;
}
