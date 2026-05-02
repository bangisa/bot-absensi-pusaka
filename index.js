require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// Routes & Middleware
const userRoutes = require("./app/routes/user.route");
const { authMiddleware } = require("./app/middleware/auth.middleware");

// Services
const {
  startScheduler,
  clearJobs,
} = require("./app/services/scheduler.service");
const { openPusaka } = require("./app/services/automation.service");

// Models
const { getUserById } = require("./app/models/user.model");
const { getLogs } = require("./app/models/log.model");

let schedulerRunning = false;

// 🔹 MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.use(express.static("public"));

// 🔹 ROUTES
app.use("/api/users", userRoutes);

// 🔹 HOME
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

// 🔹 STATUS
app.get("/status", (req, res) => {
  res.json({ scheduler: schedulerRunning });
});

// 🔹 START
app.get("/start", (req, res) => {
  if (schedulerRunning) {
    return res.send("⚠️ Scheduler sudah berjalan");
  }

  startScheduler();
  schedulerRunning = true;

  console.log("Scheduler started");
  res.send("✅ Scheduler started");
});

// 🔹 STOP
app.get("/stop", (req, res) => {
  if (!schedulerRunning) {
    return res.send("⚠️ Scheduler sudah berhenti");
  }

  clearJobs();
  schedulerRunning = false;

  console.log("Scheduler stopped");
  res.send("🛑 Scheduler stopped");
});

// 🔹 LOGS
app.get("/logs", (req, res) => {
  res.json(getLogs(100));
});

// 🔹 TEST BOT
app.get("/test-bot/:id", async (req, res) => {
  const userId = parseInt(req.params.id);

  if (isNaN(userId)) {
    return res.status(400).send("ID tidak valid");
  }

  const user = getUserById(userId);

  if (!user) {
    return res.status(404).send("User tidak ditemukan");
  }

  try {
    await openPusaka("masuk", user);
    res.send(`✅ Bot dijalankan untuk user ${user.id}`);
  } catch (err) {
    res.status(500).send("❌ Error bot: " + err.message);
  }
});

// 🔹 LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Input tidak lengkap" });
  }

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.isLogin = true;
    return res.json({ success: true });
  }

  return res.status(401).json({ error: "Login gagal" });
});

// 🔹 LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

// 🔥 EXPRESS ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("❌ Express Error:", err.message);
  res.status(500).json({ error: "Internal Server Error" });
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
    console.log("⚡  Auto starting scheduler...");
    startScheduler();
    schedulerRunning = true;
  }
});

// MONITORING
app.get("/health", (req, res) => {
  res.json({
    scheduler: schedulerRunning,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});
