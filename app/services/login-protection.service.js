import { securityConfig } from "../config/index.js";

const attempts = new Map();

function nowMs() {
  return Date.now();
}

function normalizeKey(req) {
  // req.ip respects Express trust-proxy configuration. P5 will explicitly
  // configure proxy trust before deployment behind a reverse proxy.
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function currentState(key, now = nowMs()) {
  const state = attempts.get(key);
  if (!state) return null;

  if (state.lockedUntil > now) return state;

  if (now - state.windowStartedAt >= securityConfig.loginWindowMs) {
    attempts.delete(key);
    return null;
  }

  return state;
}

function getLoginProtectionState(req) {
  const key = normalizeKey(req);
  const now = nowMs();
  const state = currentState(key, now);

  if (!state) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  if (state.lockedUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntil - now) / 1000)),
    };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

function recordLoginFailure(req) {
  const key = normalizeKey(req);
  const now = nowMs();
  let state = currentState(key, now);

  if (!state) {
    state = {
      failures: 0,
      windowStartedAt: now,
      lockedUntil: 0,
    };
  }

  state.failures += 1;

  if (state.failures >= securityConfig.loginMaxFailures) {
    state.lockedUntil = now + securityConfig.loginLockoutMs;
  }

  attempts.set(key, state);
  return getLoginProtectionState(req);
}

function clearLoginFailures(req) {
  attempts.delete(normalizeKey(req));
}

function pruneLoginProtection(now = nowMs()) {
  for (const [key, state] of attempts.entries()) {
    const expiredLock = state.lockedUntil > 0 && state.lockedUntil <= now;
    const expiredWindow = now - state.windowStartedAt >= securityConfig.loginWindowMs;
    if (expiredLock && expiredWindow) attempts.delete(key);
  }
}

export {
  clearLoginFailures,
  getLoginProtectionState,
  pruneLoginProtection,
  recordLoginFailure,
};
