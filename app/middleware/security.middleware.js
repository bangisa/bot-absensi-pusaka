import crypto from "crypto";
import { appConfig, securityConfig } from "../config/index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function applySecurityHeaders(req, res, next) {
  if (!securityConfig.headersEnabled) return next();

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
    ].join("; "),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");

  if (appConfig.isProduction && req.secure && securityConfig.hstsEnabled) {
    const directives = [`max-age=${securityConfig.hstsMaxAgeSeconds}`];
    if (securityConfig.hstsIncludeSubdomains) directives.push("includeSubDomains");
    res.setHeader("Strict-Transport-Security", directives.join("; "));
  }

  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/auth/") ||
    req.path === "/" ||
    req.path.endsWith(".html") ||
    ["/login", "/privacy", "/forgot-password"].includes(req.path)
  ) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }

  return next();
}

function ensureCsrfToken(req) {
  if (!req.session) {
    throw new Error("Session middleware is required before CSRF middleware");
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }

  return req.session.csrfToken;
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function csrfProtection(req, res, next) {
  if (!securityConfig.csrfEnabled || SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Login creates the authenticated session and is protected separately by
  // same-origin browser policy plus brute-force throttling. Requiring a public
  // pre-login CSRF session would allow anonymous session-store amplification.
  if (req.path === "/auth/login") {
    return next();
  }

  // CSRF applies to authenticated browser/session mutations.
  const expected = ensureCsrfToken(req);
  const supplied = req.get("x-csrf-token") || req.body?._csrf;

  if (!safeEqual(expected, supplied)) {
    return res.status(403).json({
      error: "Request ditolak",
      code: "CSRF_VALIDATION_FAILED",
    });
  }

  return next();
}

function getCsrfToken(req) {
  return ensureCsrfToken(req);
}

export { applySecurityHeaders, csrfProtection, getCsrfToken };
