import dotenv from "dotenv";
import express from "express";
import session from "express-session";

import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ROUTES & MIDDLEWARE
import { router } from "./app/routes/user.route.js";
import { authMiddleware } from "./app/middleware/auth.middleware.js";

// SERVICES
import { startScheduler, clearJobs } from "./app/services/scheduler.service.js";

import { openPusaka } from "./app/services/automation.service.js";

// MODELS
import { getUserById } from "./app/models/user.model.js";
import { getLogs } from "./app/models/log.model.js";

// INIT
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ESM __dirname FIX
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// STATE
let schedulerRunning = false;

// 🔹 MIDDLEWARE
app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  }),
);

app.use(
  session({
    secret: process.env.APP_SECRET || "secret123",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

// STATIC
app.use(express.static(join(__dirname, "public")));

// 🔹 ROUTES
app.use("/api/users", router);

// 🔹 HOME
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "login.html"));
});

// 🔹 STATUS
app.get("/status", (req, res) => {
  res.json({
    scheduler: schedulerRunning,
  });
});

// 🔹 START SCHEDULER
app.get("/start", (req, res) => {
  if (schedulerRunning) {
    return res.send("⚠️ Scheduler sudah berjalan");
  }

  startScheduler();
  schedulerRunning = true;

  console.log("⚡ Scheduler started");

  res.send("⚡ Scheduler started");
});

// 🔹 STOP SCHEDULER
app.get("/stop", (req, res) => {
  if (!schedulerRunning) {
    return res.send("⚠️ Scheduler sudah berhenti");
  }

  clearJobs();
  schedulerRunning = false;

  console.log("🛑 Scheduler stopped");

  res.send("🛑 Scheduler stopped");
});

// 🔹 LOGS
app.get("/logs", (req, res) => {
  res.json(getLogs(100));
});

// 🔹 TEST BOT
app.get("/test-bot/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (Number.isNaN(userId)) {
      return res.status(400).send("ID tidak valid");
    }

    const user = getUserById(userId);

    if (!user) {
      return res.status(404).send("User tidak ditemukan");
    }

    await openPusaka("masuk", user);

    return res.send(`✅ Bot dijalankan untuk user ${user.id}`);
  } catch (err) {
    console.error("[TEST BOT ERROR]", err);

    return res.status(500).send("❌ Error bot: " + err.message);
  }
});

// 🔹 LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: "Input tidak lengkap",
    });
  }

  const valid =
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD;

  if (!valid) {
    return res.status(401).json({
      error: "Login gagal",
    });
  }

  req.session.isLogin = true;

  return res.json({
    success: true,
  });
});

// 🔹 LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

// 🔹 HEALTHCHECK
app.get("/health", (req, res) => {
  res.json({
    scheduler: schedulerRunning,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
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
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  if (process.env.AUTO_START === "true" && !schedulerRunning) {
    console.log("⚡ Auto starting scheduler...");

    startScheduler();

    schedulerRunning = true;
  }
});
