import { getSystemSetting, setSystemSetting } from "../models/system-setting.model.js";

export const TIMEZONE_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export function getTimezoneChangeProtection() {
  const cooldownUntil = Number(getSystemSetting("timezone_change_allowed_after")?.value || 0);
  return { cooldownUntil, retryAfterSeconds: Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) };
}

export function checkTimezoneChangeCooldown() {
  const state = getTimezoneChangeProtection();
  if (state.retryAfterSeconds > 0) {
    throw Object.assign(new Error("Perubahan timezone dibatasi satu kali dalam 24 jam. Tunggu hingga jeda berakhir."), {
      code: "TIMEZONE_CHANGE_COOLDOWN", retryAfterSeconds: state.retryAfterSeconds,
    });
  }
}

export function recordTimezoneChangeAttempt() {
  const now = Date.now();
  const saved = getSystemSetting("timezone_change_attempts");
  let state = saved ? JSON.parse(saved.value) : null;
  if (!state || now - state.startedAt >= WINDOW_MS) state = { startedAt: now, attempts: 0, notified: false };
  if (state.attempts >= MAX_ATTEMPTS) {
    const audit = !state.notified;
    if (audit) {
      state.notified = true;
      setSystemSetting("timezone_change_attempts", JSON.stringify(state));
    }
    throw Object.assign(new Error("Terlalu banyak percobaan perubahan timezone. Coba lagi setelah 15 menit."), {
      code: "TIMEZONE_RATE_LIMIT", retryAfterSeconds: Math.max(1, Math.ceil((state.startedAt + WINDOW_MS - now) / 1000)), audit,
    });
  }
  state.attempts += 1;
  setSystemSetting("timezone_change_attempts", JSON.stringify(state));
}
