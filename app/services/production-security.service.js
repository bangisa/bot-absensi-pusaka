import { appConfig, authConfig, env, proxyConfig, securityConfig } from "../config/index.js";

function validateProductionSecurityConfig() {
  const errors = [];

  if (!appConfig.isProduction) return { ok: true, errors };

  if (typeof appConfig.secret !== "string" || appConfig.secret.length < 32) {
    errors.push("APP_SECRET must contain at least 32 characters in production");
  }

  if (!/^\$2[aby]\$\d{2}\$/.test(authConfig.adminPasswordHash || "")) {
    errors.push("ADMIN_PASSWORD_HASH must be a valid bcrypt hash in production");
  }

  if (!new Set(["lax", "strict", "none"]).has(String(authConfig.sessionSameSite).toLowerCase())) {
    errors.push("SESSION_SAME_SITE must be lax, strict, or none");
  }

  if (
    String(authConfig.sessionSameSite).toLowerCase() === "none" &&
    authConfig.sessionCookieSecure !== true
  ) {
    errors.push("SESSION_COOKIE_SECURE=true is required when SESSION_SAME_SITE=none");
  }

  if (!Number.isFinite(securityConfig.loginWindowMs) || securityConfig.loginWindowMs < 1000) {
    errors.push("LOGIN_RATE_LIMIT_WINDOW_MS must be >= 1000");
  }

  if (
    !Number.isInteger(securityConfig.loginMaxFailures) ||
    securityConfig.loginMaxFailures < 1 ||
    securityConfig.loginMaxFailures > 100
  ) {
    errors.push("LOGIN_RATE_LIMIT_MAX must be an integer between 1 and 100");
  }

  if (!Number.isFinite(securityConfig.loginLockoutMs) || securityConfig.loginLockoutMs < 1000) {
    errors.push("LOGIN_LOCKOUT_MS must be >= 1000");
  }

  if (
    !Number.isInteger(securityConfig.hstsMaxAgeSeconds) ||
    securityConfig.hstsMaxAgeSeconds < 0 ||
    securityConfig.hstsMaxAgeSeconds > 63072000
  ) {
    errors.push("HSTS_MAX_AGE_SECONDS must be an integer between 0 and 63072000");
  }

  try {
    const pusakaUrl = new URL(env.BASE_URL_PUSAKA);
    if (!new Set(["http:", "https:"]).has(pusakaUrl.protocol)) {
      errors.push("BASE_URL_PUSAKA must use http or https");
    }
    if (pusakaUrl.username || pusakaUrl.password) {
      errors.push("BASE_URL_PUSAKA must not contain credentials");
    }
  } catch {
    errors.push("BASE_URL_PUSAKA must be a valid absolute URL");
  }

  let baseUrl = null;
  try {
    baseUrl = new URL(env.APP_BASE_URL);
    if (!new Set(["http:", "https:"]).has(baseUrl.protocol)) {
      errors.push("APP_BASE_URL must use http or https");
    }
    if (baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
      errors.push("APP_BASE_URL must be an origin without credentials, path, query, or fragment");
    }
  } catch {
    errors.push("APP_BASE_URL must be a valid absolute URL");
  }

  // Express `trust proxy=true` trusts the left-most forwarded address and is
  // too broad for this application's production boundary. Require an explicit
  // hop count, named subnet, IP, or CIDR instead.
  if (proxyConfig.trustProxy === true) {
    errors.push(
      "TRUST_PROXY=true is not allowed in production; use loopback, an explicit hop count, IP, or CIDR",
    );
  }

  if (proxyConfig.forceHttps) {
    if (!proxyConfig.enabled) {
      errors.push("TRUST_PROXY must be configured when FORCE_HTTPS=true");
    }
    if (baseUrl && baseUrl.protocol !== "https:") {
      errors.push("APP_BASE_URL must use https when FORCE_HTTPS=true");
    }
    if (authConfig.sessionCookieSecure !== true) {
      errors.push("SESSION_COOKIE_SECURE=true is required when FORCE_HTTPS=true");
    }
  }

  if (authConfig.sessionCookieSecure === true) {
    if (baseUrl && baseUrl.protocol !== "https:") {
      errors.push("APP_BASE_URL must use https when SESSION_COOKIE_SECURE=true");
    }
    if (!proxyConfig.enabled) {
      errors.push(
        "TRUST_PROXY must be configured when SESSION_COOKIE_SECURE=true because this server terminates plain HTTP locally",
      );
    }
  }

  if (env.NODE_ENV !== "production") {
    errors.push("NODE_ENV must be production");
  }

  if (errors.length) {
    const err = new Error(`Production security configuration invalid:\n- ${errors.join("\n- ")}`);
    err.code = "PRODUCTION_SECURITY_CONFIG_INVALID";
    throw err;
  }

  return { ok: true, errors };
}

export { validateProductionSecurityConfig };
