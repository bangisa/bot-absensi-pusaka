import { resolve } from "path";
import { env } from "./env.config.js";

const projectRoot = resolve(process.cwd());

export const holidayConfig = {
  timeoutMs: env.HOLIDAY_TIMEOUT_MS,
  primaryBaseUrl: env.HOLIDAY_PRIMARY_BASE_URL,
  secondaryBaseUrl: env.HOLIDAY_SECONDARY_BASE_URL,
  cacheFile: resolve(projectRoot, env.HOLIDAY_CACHE_FILE),
  overridesFile: resolve(projectRoot, env.HOLIDAY_OVERRIDES_FILE),
};
