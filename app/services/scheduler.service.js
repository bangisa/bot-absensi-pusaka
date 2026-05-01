const cron = require("node-cron");
const { getAllUsers } = require("../models/user.model");
const { openPusaka } = require("./automation.service");
const { addToQueue } = require("./queue.service");

let jobs = [];
const runningUsers = new Set();

function getDay() {
  return new Date().getDay();
}

function getTime() {
  return new Date().toTimeString().slice(0, 5);
}

async function runTaskPerUser(type, user) {
  if (runningUsers.has(user.id)) return;

  runningUsers.add(user.id);

  try {
    console.log(`[-] ${type} user ${user.id}`);
    addToQueue(async () => {
      console.log(`[START] User ${user.id} mulai`);

      await openPusaka(type, user);

      console.log(`[DONE] User ${user.id} selesai`);
    });
  } catch (err) {
    console.log(`[x] User ${user.id}:`, err.message);
  } finally {
    runningUsers.delete(user.id);
  }
}

function clearJobs() {
  jobs.forEach((job) => job.stop());
  jobs = [];
}

function startScheduler() {
  clearJobs();

  const job = cron.schedule("* * * * *", async () => {
    const day = getDay();
    const time = getTime();

    const users = getAllUsers();

    for (const user of users) {
      // MASUK
      if (day !== 0 && time === user.masuk) {
        runTaskPerUser("masuk", user);
      }

      // SENIN-KAMIS
      if (day >= 1 && day <= 4 && time === user.pulang) {
        runTaskPerUser("pulang", user);
      }

      // JUMAT
      if (day === 5 && time === user.jumat) {
        runTaskPerUser("pulang", user);
      }

      // SABTU
      if (day === 6 && time === user.sabtu) {
        runTaskPerUser("pulang", user);
      }
    }
  });

  jobs.push(job);

  console.log("Scheduler started");
}

let isRunning = false;

function restartScheduler() {
  if (isRunning) {
    console.log("[!] Scheduler sedang berjalan, skip restart!");
    return;
  }

  clearJobs();
  startScheduler();
  console.log("Scheduler restarted...");
}

module.exports = {
  startScheduler,
  clearJobs,
  restartScheduler,
};
