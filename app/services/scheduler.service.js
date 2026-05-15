import { schedule } from "node-cron";
import { findAllUsers } from "../models/index.js";
import { addToQueue } from "./queue.service.js";
import { openPusaka } from "./automation.service.js";
import { shouldRun } from "./execution.guard.js";
import { resolveTypeForUser } from "../helpers/index.js";

let jobs = [];
let isRunning = false;
let isTickRunning = false;

function getSchedulerStatus() {
  return {
    running: isRunning,
    tickRunning: isTickRunning,
    totalJobs: jobs.length,
  };
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
  if (isRunning) {
    console.log("[i] Scheduler already running");
    return;
  }

  clearJobs();

  const job = schedule("* * * * *", async () => {
    if (isTickRunning) return;
    isTickRunning = true;

    try {
      const day = new Date().getDay();
      const users = await findAllUsers();

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

function stopScheduler() {
  clearJobs();
  isRunning = false;

  console.log("🛑 Scheduler stopped");
}

export { getSchedulerStatus, startScheduler, restartScheduler, stopScheduler };
