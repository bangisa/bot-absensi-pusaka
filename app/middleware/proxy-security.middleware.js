import { proxyConfig } from "../config/proxy.config.js";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

function canonicalHttpsUrl(req) {
  const base = new URL(proxyConfig.canonicalBaseUrl);
  const target = new URL(req.originalUrl || req.url || "/", base);
  target.protocol = "https:";
  target.host = base.host;
  return target.toString();
}

function enforceHttps(req, res, next) {
  if (!proxyConfig.forceHttps || req.secure) {
    return next();
  }

  // Redirect only safe navigation. Replaying authenticated mutations through
  // an automatic redirect is avoided; clients must retry directly over HTTPS.
  if (SAFE_METHODS.has(req.method)) {
    return res.redirect(308, canonicalHttpsUrl(req));
  }

  return res.status(426).json({
    error: "HTTPS required",
    code: "HTTPS_REQUIRED",
  });
}

export { canonicalHttpsUrl, enforceHttps };
