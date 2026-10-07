import { Router } from "express";
import { authConfig } from "../config/index.js";
import {
  clearLoginFailures,
  destroyAdminSession,
  establishAdminSession,
  getLoginProtectionState,
  isAdminAuthenticated,
  recordLoginFailure,
  verifyAdminCredentials,
} from "../services/index.js";
import { createAuditLog } from "../models/index.js";
import { logger } from "../helpers/index.js";
import { getCsrfToken } from "../middleware/security.middleware.js";

const router = Router();

function sanitizeNext(value) {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/login") || value.startsWith("/auth/")) return "/";
  return value;
}

router.get("/csrf", (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({
      error: "Authentication required",
      code: "ADMIN_AUTH_REQUIRED",
    });
  }

  return res.json({ csrfToken: getCsrfToken(req) });
});

router.get("/session", (req, res) => {
  res.json({ authenticated: isAdminAuthenticated(req) });
});

router.post("/login", async (req, res) => {
  try {
    const protection = getLoginProtectionState(req);
    if (protection.blocked) {
      res.setHeader("Retry-After", String(protection.retryAfterSeconds));
      createAuditLog({
        action: "admin.login",
        actor: "admin",
        target_type: "system",
        status: "failed",
        metadata: { reason: "temporarily_limited" },
      });
      return res.status(429).json({
        error: "Login sementara dibatasi. Coba lagi nanti.",
        code: "ADMIN_LOGIN_TEMPORARILY_LIMITED",
      });
    }

    const username = req.body?.username;
    const password = req.body?.password;
    const next = sanitizeNext(req.body?.next);

    const valid = await verifyAdminCredentials(username, password);

    if (!valid) {
      const afterFailure = recordLoginFailure(req);
      createAuditLog({
        action: "admin.login",
        actor: "admin",
        target_type: "system",
        status: "failed",
        metadata: { reason: "invalid_credentials" },
      });

      if (afterFailure.blocked) {
        res.setHeader("Retry-After", String(afterFailure.retryAfterSeconds));
        return res.status(429).json({
          error: "Login sementara dibatasi. Coba lagi nanti.",
          code: "ADMIN_LOGIN_TEMPORARILY_LIMITED",
        });
      }

      return res.status(401).json({
        error: "Username atau password admin salah",
        code: "INVALID_ADMIN_CREDENTIALS",
      });
    }

    clearLoginFailures(req);
    await establishAdminSession(req);

    createAuditLog({
      action: "admin.login",
      actor: "admin",
      target_type: "system",
      status: "success",
    });

    return res.json({ ok: true, redirect: next });
  } catch (err) {
    logger.error("admin.login_failed", "Login admin gagal", { error: err });
    return res.status(500).json({ error: "Login admin gagal" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    if (isAdminAuthenticated(req)) {
      createAuditLog({
        action: "admin.logout",
        actor: "admin",
        target_type: "system",
        status: "success",
      });
    }

    await destroyAdminSession(req);
    res.clearCookie(authConfig.sessionCookieName, {
      httpOnly: true,
      sameSite: authConfig.sessionSameSite,
      secure: authConfig.sessionCookieSecure,
    });
    return res.json({ ok: true, redirect: "/login" });
  } catch (err) {
    logger.error("admin.logout_failed", "Logout admin gagal", { error: err });
    return res.status(500).json({ error: "Logout gagal" });
  }
});

export default router;
