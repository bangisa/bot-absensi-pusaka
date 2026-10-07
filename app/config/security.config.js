import { env } from "./env.config.js";

export const securityConfig = {
  headersEnabled: env.SECURITY_HEADERS_ENABLED,
  csrfEnabled: env.CSRF_PROTECTION_ENABLED,
  loginWindowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  loginMaxFailures: env.LOGIN_RATE_LIMIT_MAX,
  loginLockoutMs: env.LOGIN_LOCKOUT_MS,
  hstsEnabled: env.HSTS_ENABLED,
  hstsMaxAgeSeconds: env.HSTS_MAX_AGE_SECONDS,
  hstsIncludeSubdomains: env.HSTS_INCLUDE_SUBDOMAINS,
};
