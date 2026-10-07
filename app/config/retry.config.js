import { env } from "./env.config.js";

function normalizeNonNegative(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export const retryConfig = {
  // Retry internal untuk login / aksi singkat.
  maxRetry: env.MAX_RETRY,
  retryDelay: env.RETRY_DELAY,

  // Retry scheduler untuk satu eksekusi presensi yang gagal total.
  scheduleBaseDelaySeconds: normalizeNonNegative(
    env.SCHEDULE_RETRY_BASE_SECONDS,
    30,
  ),
  scheduleJitterSeconds: normalizeNonNegative(
    env.SCHEDULE_RETRY_JITTER_SECONDS,
    15,
  ),
  scheduleMaxDelaySeconds: normalizeNonNegative(
    env.SCHEDULE_RETRY_MAX_SECONDS,
    90,
  ),
};

/**
 * Menghasilkan delay retry scheduler menggunakan capped exponential backoff
 * dengan jitter kecil agar banyak job yang gagal bersamaan tidak retry tepat
 * pada waktu yang sama.
 *
 * attemptCount adalah jumlah attempt yang SUDAH dijalankan.
 * attempt=1 -> base 30s, attempt=2 -> base 60s, dst.
 */
export function getScheduleRetryDelay(attemptCount, random = Math.random) {
  const attempt = Math.max(1, Number.parseInt(attemptCount, 10) || 1);
  const base = retryConfig.scheduleBaseDelaySeconds;
  const maxBase = Math.max(base, retryConfig.scheduleMaxDelaySeconds);
  const jitterMax = retryConfig.scheduleJitterSeconds;

  const exponentialDelay = base * Math.pow(2, attempt - 1);
  const cappedBaseDelay = Math.min(exponentialDelay, maxBase);
  const randomValue = Math.min(Math.max(Number(random()) || 0, 0), 0.999999999999);
  const jitterSeconds =
    jitterMax > 0 ? Math.floor(randomValue * (jitterMax + 1)) : 0;

  return {
    delaySeconds: cappedBaseDelay + jitterSeconds,
    baseDelaySeconds: cappedBaseDelay,
    jitterSeconds,
  };
}
