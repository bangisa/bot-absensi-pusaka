import "dotenv/config";
import { env } from "./app/config/index.js";

process.env.TZ = env.TZ;

import express from "express";
import session from "express-session";

import { appConfig } from "./app/config/index.js";

import { resolvePath } from "./app/helpers/index.js";

// ROUTES
import {
  systemRoutes,
  testingRoutes,
  userRoutes,
  webRoutes,
} from "./app/routes/index.js";

// SERVICES
import { startScheduler, getSchedulerStatus } from "./app/services/index.js";

const app = express();
const PORT = appConfig.port;

// ESM __dirname FIX
const path = resolvePath(import.meta.url);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  }),
);

app.use(
  session({
    secret: appConfig.secret,

    resave: false,

    saveUninitialized: false,

    cookie: {
      secure: appConfig.isProduction,

      httpOnly: true,

      maxAge: appConfig.sessionMaxAge,
    },
  }),
);

// STATIC
app.use(express.static(path.resolve("public")));

// 🔹 ROUTES
app.use("/", webRoutes);
app.use("/api/users", userRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/testing", testingRoutes);

// 404 HANDLER
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// 🔥 EXPRESS ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("❌ Express Error:", err);

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

// 🚀 START SERVER
app.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  const status = getSchedulerStatus();
  if (appConfig.autoStart && !status.running) {
    console.log("⚡ Auto starting scheduler...");
    startScheduler();
  }
});
