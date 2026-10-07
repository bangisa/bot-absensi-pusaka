import { env } from './env.config.js';

export const authConfig = {
  adminUsername: env.ADMIN_USERNAME,
  adminPasswordHash: env.ADMIN_PASSWORD_HASH,
  sessionCookieName: env.SESSION_COOKIE_NAME,
  sessionCookieSecure: env.SESSION_COOKIE_SECURE,
  sessionSameSite: env.SESSION_SAME_SITE,
  sessionMaxAgeMs: env.SESSION_MAX_AGE_MS,
};
