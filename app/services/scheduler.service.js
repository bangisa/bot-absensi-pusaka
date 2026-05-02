const cron = require("node-cron");
const { getAllUsers } = require("../models/user.model");
const { addToQueue } = require("./queue.service");
const { openPusaka } = require("./automation.service");
const { shouldRun } = require("./execution.guard");

let jobs = [];
let isRunning = false;
let isTickRunning = false;

// Helper waktu
function nowHM() {
  const d = new Date();
  return { h: d.getHours(), m: d.getMinutes() };
}

function matchTime(target) {
  const { h, m } = nowHM();
  const [th, tm] = target.split(":").map(Number);
  return h === th && m === tm;
}

function resolveTypeForUser(user, day) {
  const results = [];

  // MASUK
  if (day !== 0 && matchTime(user.masuk)) {
    results.push("masuk");
  }

  // PULANG
  if (day >= 1 && day <= 4 && matchTime(user.pulang)) {
    results.push("pulang");
  }

  if (day === 5 && matchTime(user.jumat)) {
    results.push("pulang");
  }

  if (day === 6 && matchTime(user.sabtu)) {
    results.push("pulang");
  }

  return results;
}

function enqueueUserTask(type, user) {
  // anti duplikasi per menit
  if (!shouldRun(user.id, type)) return;

  addToQueue(async () => {
    console.log(`[START] ${type} user=${user.id}`);

    await openPusaka(type, user);

    console.log(`[DONE] ${type} user=${user.id}`);
  });
}

function clearJobs() {
  jobs.forEach((job) => job.stop());
  jobs = [];
}

function startScheduler() {
  if (isRunning) return;

  clearJobs();

  const job = cron.schedule("* * * * *", async () => {
    if (isTickRunning) return;
    isTickRunning = true;

    try {
      const day = new Date().getDay();
      const users = getAllUsers();

      for (const user of users) {
        const types = resolveTypeForUser(user, day);

        for (const type of types) {
          enqueueUserTask(type, user);
        }
      }
    } catch (err) {
      console.log("[X] Scheduler error:", err.message);
    } finally {
      isTickRunning = false;
    }
  });

  jobs.push(job);
  isRunning = true;

  console.log("Scheduler started");
}

function restartScheduler() {
  clearJobs();
  isRunning = false;
  startScheduler();
}

module.exports = {
  startScheduler,
  clearJobs,
  restartScheduler,
};
