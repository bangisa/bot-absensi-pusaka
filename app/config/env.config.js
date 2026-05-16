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

  BASE_URL: required(process.env.BASE_URL, "BASE_URL"),

  HEADLESS: toBool(process.env.HEADLESS, true),

  BOT_DELAY: toNumber(process.env.BOT_DELAY, 3000),

  NAVIGATION_TIMEOUT: toNumber(process.env.NAVIGATION_TIMEOUT, 30000),

  ELEMENT_TIMEOUT: toNumber(process.env.ELEMENT_TIMEOUT, 30000),

  MAX_RETRY: toNumber(process.env.MAX_RETRY, 3),

  RETRY_DELAY: toNumber(process.env.RETRY_DELAY, 3000),

  MAX_CONCURRENT: toNumber(process.env.MAX_CONCURRENT, 2),

  TASK_TIMEOUT: toNumber(process.env.TASK_TIMEOUT, 180000),

  COOKIE_DIR: process.env.COOKIE_DIR || "cookies",

  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  DEFAULT_LAT: toNumber(process.env.DEFAULT_LAT),

  DEFAULT_LNG: toNumber(process.env.DEFAULT_LNG),
};
