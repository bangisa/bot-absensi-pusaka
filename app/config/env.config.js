function toBool(value, fallback = false) {
  if (value == null) return fallback;

  return value === "true";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isNaN(parsed) ? fallback : parsed;
}

function required(value, name) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || "production",

  TZ: process.env.TZ || "Asia/Jakarta",

  PORT: toNumber(process.env.PORT, 3000),

  AUTO_START: toBool(process.env.AUTO_START),

  APP_SECRET: required(process.env.APP_SECRET, "APP_SECRET"),

  BASE_URL_PUSAKA: required(process.env.BASE_URL_PUSAKA, "BASE_URL_PUSAKA"),

  APP_BASE_URL: required(process.env.APP_BASE_URL, "APP_BASE_URL"),

  ADMIN_USERNAME: required(process.env.ADMIN_USERNAME, "ADMIN_USERNAME"),

  ADMIN_PASSWORD_HASH: required(
    process.env.ADMIN_PASSWORD_HASH,
    "ADMIN_PASSWORD_HASH",
  ),

  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || "pusaka_admin_sid",

  SESSION_COOKIE_SECURE: toBool(process.env.SESSION_COOKIE_SECURE, false),

  SESSION_SAME_SITE: process.env.SESSION_SAME_SITE || "lax",

  SESSION_MAX_AGE_MS: toNumber(
    process.env.SESSION_MAX_AGE_MS,
    1000 * 60 * 60 * 8,
  ),

  HEADLESS: toBool(process.env.HEADLESS, true),

  BOT_DELAY: toNumber(process.env.BOT_DELAY, 3000),

  NAVIGATION_TIMEOUT: toNumber(process.env.NAVIGATION_TIMEOUT, 30000),

  ELEMENT_TIMEOUT: toNumber(process.env.ELEMENT_TIMEOUT, 30000),

  MAX_RETRY: toNumber(process.env.MAX_RETRY, 3),

  RETRY_DELAY: toNumber(process.env.RETRY_DELAY, 3000),

  SCHEDULE_RETRY_BASE_SECONDS: toNumber(
    process.env.SCHEDULE_RETRY_BASE_SECONDS,
    30,
  ),

  SCHEDULE_RETRY_JITTER_SECONDS: toNumber(
    process.env.SCHEDULE_RETRY_JITTER_SECONDS,
    15,
  ),

  SCHEDULE_RETRY_MAX_SECONDS: toNumber(
    process.env.SCHEDULE_RETRY_MAX_SECONDS,
    90,
  ),

  MAX_CONCURRENT: toNumber(process.env.MAX_CONCURRENT, 2),

  TASK_TIMEOUT: toNumber(process.env.TASK_TIMEOUT, 180000),

  COOKIE_DIR: process.env.COOKIE_DIR || "cookies",

  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  STRUCTURED_LOG_DIR: process.env.STRUCTURED_LOG_DIR || "logs",

  STRUCTURED_LOG_RETENTION_DAYS: toNumber(
    process.env.STRUCTURED_LOG_RETENTION_DAYS,
    7,
  ),

  AUDIT_LOG_RETENTION_DAYS: toNumber(
    process.env.AUDIT_LOG_RETENTION_DAYS,
    90,
  ),

  DEFAULT_LAT: toNumber(process.env.DEFAULT_LAT),

  DEFAULT_LNG: toNumber(process.env.DEFAULT_LNG),

  HOLIDAY_TIMEOUT_MS: toNumber(process.env.HOLIDAY_TIMEOUT_MS, 5000),

  HOLIDAY_PRIMARY_BASE_URL:
    process.env.HOLIDAY_PRIMARY_BASE_URL ||
    "https://api.kemendesa.link/libur-nasional/api",

  HOLIDAY_SECONDARY_BASE_URL:
    process.env.HOLIDAY_SECONDARY_BASE_URL ||
    "https://data-libur-nasional-indonesia.vercel.app/api",

  HOLIDAY_CACHE_FILE:
    process.env.HOLIDAY_CACHE_FILE || "data/holiday-cache.json",

  HOLIDAY_OVERRIDES_FILE:
    process.env.HOLIDAY_OVERRIDES_FILE || "data/holiday-overrides.json",

  GEO_RADIUS_METERS: toNumber(process.env.GEO_RADIUS_METERS, 0),

  DB_BACKUP_ENABLED: toBool(process.env.DB_BACKUP_ENABLED, true),

  DB_BACKUP_CRON: process.env.DB_BACKUP_CRON || "0 0 1 * * 0",

  DB_BACKUP_DIR: process.env.DB_BACKUP_DIR || "backups/database",

  DB_BACKUP_RETENTION_COUNT: toNumber(
    process.env.DB_BACKUP_RETENTION_COUNT,
    8,
  ),

  SECURITY_HEADERS_ENABLED: toBool(process.env.SECURITY_HEADERS_ENABLED, true),

  CSRF_PROTECTION_ENABLED: toBool(process.env.CSRF_PROTECTION_ENABLED, true),

  LOGIN_RATE_LIMIT_WINDOW_MS: toNumber(
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000,
  ),

  LOGIN_RATE_LIMIT_MAX: toNumber(process.env.LOGIN_RATE_LIMIT_MAX, 5),

  LOGIN_LOCKOUT_MS: toNumber(
    process.env.LOGIN_LOCKOUT_MS,
    15 * 60 * 1000,
  ),

  // Reverse proxy / HTTPS deployment boundary. Keep disabled for direct localhost HTTP.
  TRUST_PROXY: process.env.TRUST_PROXY || "false",

  FORCE_HTTPS: toBool(process.env.FORCE_HTTPS, false),

  HSTS_ENABLED: toBool(process.env.HSTS_ENABLED, true),

  HSTS_MAX_AGE_SECONDS: toNumber(
    process.env.HSTS_MAX_AGE_SECONDS,
    31536000,
  ),

  HSTS_INCLUDE_SUBDOMAINS: toBool(
    process.env.HSTS_INCLUDE_SUBDOMAINS,
    false,
  ),
};
