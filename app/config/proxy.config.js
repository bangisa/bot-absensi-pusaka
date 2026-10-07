import { env } from "./env.config.js";

function parseTrustProxy(value) {
  const raw = String(value ?? "false").trim();
  const lowered = raw.toLowerCase();

  if (["", "false", "off", "0", "none"].includes(lowered)) {
    return false;
  }

  if (lowered === "true") {
    return true;
  }

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  // Express accepts named ranges (loopback/linklocal/uniquelocal), IPs,
  // CIDRs, and comma-separated lists for trust proxy.
  return raw;
}

function hasTrustedProxy(value) {
  return value !== false && value !== 0 && value !== "" && value != null;
}

const trustProxy = parseTrustProxy(env.TRUST_PROXY);

export const proxyConfig = {
  trustProxy,
  trustProxyRaw: String(env.TRUST_PROXY ?? "false").trim(),
  enabled: hasTrustedProxy(trustProxy),
  forceHttps: env.FORCE_HTTPS,
  canonicalBaseUrl: env.APP_BASE_URL,
};

export { hasTrustedProxy, parseTrustProxy };
