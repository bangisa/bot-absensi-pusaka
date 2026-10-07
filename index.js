import "dotenv/config";
import { env } from "./app/config/index.js";

process.env.TZ = env.TZ;

import express from "express";
import session from "express-session";

import { appConfig, authConfig, proxyConfig } from "./app/config/index.js";

import { resolvePath } from "./app/helpers/index.js";
import { requireAdmin } from "./app/middleware/admin-auth.middleware.js";
import { applySecurityHeaders, csrfProtection } from "./app/middleware/security.middleware.js";
import { enforceHttps } from "./app/middleware/proxy-security.middleware.js";

// ROUTES
import {
  authRoutes,
  systemRoutes,
  testingRoutes,
  userRoutes,
  webRoutes,
} from "./app/routes/index.js";

// SERVICES
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  startDailyScheduleGenerator,
  stopDailyScheduleGenerator,
  startLogCleanup,
  stopLogCleanup,
  startDatabaseBackup,
  gracefulShutdown,
  isDraining,
  validateProductionSecurityConfig,
} from "./app/services/index.js";

validateProductionSecurityConfig();

const app = express();
const PORT = appConfig.port;

app.disable("x-powered-by");

// Trust only the explicitly configured reverse-proxy boundary. This must be
// configured before anything that relies on req.ip / req.secure.
app.set("trust proxy", proxyConfig.trustProxy);

// ESM __dirname FIX
const path = resolvePath(import.meta.url);

app.use(enforceHttps);

app.use(express.json({ limit: "32kb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "32kb",
  }),
);

app.use(applySecurityHeaders);

app.use(
  session({
    name: authConfig.sessionCookieName,

    secret: appConfig.secret,

    resave: false,

    saveUninitialized: false,

    cookie: {
      secure: authConfig.sessionCookieSecure,

      httpOnly: true,

      sameSite: authConfig.sessionSameSite,

      maxAge: appConfig.sessionMaxAge,
    },
  }),
);

app.use(csrfProtection);

// Saat full-drain shutdown berlangsung, tetap izinkan read-only monitoring,
// tetapi blok pekerjaan eksternal baru (mutation/manual bot trigger).
app.use((req, res, next) => {
  if (!isDraining()) {
    return next();
  }

  const isManualBotTrigger = req.path.startsWith("/api/testing");
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const isLogout = req.path === "/auth/logout";

  if (!isLogout && (isManualBotTrigger || isMutation)) {
    return res.status(503).json({
      error: "Application is draining for shutdown",
      state: "DRAINING",
    });
  }

  return next();
});

// Authentication routes remain reachable before the admin guard.
app.use("/auth", authRoutes);

// Protect dashboard pages, static application HTML, and private APIs.
app.use(requireAdmin);

// STATIC
app.use(express.static(path.resolve("public")));

// 🔹 ROUTES
app.use("/", webRoutes);
app.use("/api/users", userRoutes);
app.use("/api/system", systemRoutes);
if (!appConfig.isProduction) {
  app.use("/api/testing", testingRoutes);
  console.log("🧪 Development testing API enabled: POST /api/testing/test-bot/:id");
}

// 404 HANDLER
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// 🔥 EXPRESS ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("❌ Express Error:", appConfig.isProduction ? err?.message : err);

  if (res.headersSent) return next(err);

  res.status(500).json({
    error: "Internal Server Error",
  });
});

// 🔥 GLOBAL ERROR HANDLER
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

let server = null;

async function handleShutdownSignal(signal) {
  console.log(`\n[SHUTDOWN] ${signal} diterima. Menunggu seluruh workload selesai...`);

  try {
    await gracefulShutdown({ signal, server });
    process.exit(0);
  } catch (err) {
    console.error("❌ Graceful shutdown gagal:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void handleShutdownSignal("SIGINT");
});

process.on("SIGTERM", () => {
  void handleShutdownSignal("SIGTERM");
});

if (process.platform === "win32") {
  process.on("SIGBREAK", () => {
    void handleShutdownSignal("SIGBREAK");
  });
}

// 🚀 START SERVER
server = app.listen(PORT, "127.0.0.1", async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  startLogCleanup();
  startDatabaseBackup();

  const status = getSchedulerStatus();
  if (appConfig.autoStart && !status.running) {
    console.log("⚡ Auto starting scheduler...");
    await startDailyScheduleGenerator();
    startScheduler();
  }
});
