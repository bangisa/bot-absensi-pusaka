import { schedule } from "node-cron";
import { getAllUsers } from "../models/user.model.js";
import { addToQueue } from "./queue.service.js";
import { openPusaka } from "./automation.service.js";
import { shouldRun } from "./execution.guard.js";

let jobs = [];
let isRunning = false;
let isTickRunning = false;

// Helper waktu
function nowHM() {
  const d = new Date();
  return { h: d.getHours(), m: d.getMinutes() };
}

function matchTime(target) {
  const now = new Date();

  const current =
    `${String(now.getHours()).padStart(2, "0")}:` +
    `${String(now.getMinutes()).padStart(2, "0")}`;

  return current === target;
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
  if (!shouldRun(user.id, type)) {
    return;
  }

  addToQueue(async () => {
    console.log(
      `[${new Date().toISOString()}] [START] ${type} user=${user.id}`,
    );

    try {
      await openPusaka(type, user);
    } catch (err) {
      console.log(`[X] Task error user=${user.id}:`, err.message);
    }

    console.log(`[${new Date().toISOString()}] [DONE] ${type} user=${user.id}`);
  });
}

function clearJobs() {
  jobs.forEach((job) => job.stop());
  jobs = [];
}

function startScheduler() {
  if (isRunning) return;

  clearJobs();

  const job = schedule("* * * * *", async () => {
    if (isTickRunning) return;
    isTickRunning = true;

    try {
      const day = new Date().getDay();
      const users = await getAllUsers();

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

  console.log("⚡ Scheduler started");
}

function restartScheduler() {
  clearJobs();
  isRunning = false;
  startScheduler();
}

export { startScheduler, clearJobs, restartScheduler };
