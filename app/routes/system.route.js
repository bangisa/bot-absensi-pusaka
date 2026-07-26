import { Router } from "express";

import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getQueueStatus,
  getBrowserStatus,
  startDailyScheduleGenerator,
  stopDailyScheduleGenerator,
  getDailyScheduleGeneratorStatus,
} from "../services/index.js";

import { getLogs } from "../models/index.js";

const router = Router();

// STATUS
router.get("/status", (req, res) => {
  res.json({
    ...getSchedulerStatus(),
    generator: getDailyScheduleGeneratorStatus(),
  });
});

// START SCHEDULER
router.post("/scheduler/start", (req, res) => {
  const status = getSchedulerStatus();

  if (status.running) {
    return res.send("Scheduler sudah berjalan");
  }

  const generatorStatus = startDailyScheduleGenerator();

  if (generatorStatus.lastError) {
    return res.status(500).json({
      error: "Daily schedule generator gagal dijalankan",
      generator: generatorStatus,
    });
  }

  startScheduler();

  res.send("Scheduler started");
});

// STOP SCHEDULER
router.post("/scheduler/stop", (req, res) => {
  const status = getSchedulerStatus();
  const generatorStatus = getDailyScheduleGeneratorStatus();

  if (!status.running && !generatorStatus.running) {
    return res.send("Scheduler sudah berhenti");
  }

  stopScheduler();
  stopDailyScheduleGenerator();

  res.send("Scheduler stopped");
});

// HEALTHCHECK
router.get("/health", (req, res) => {
  res.json({
    scheduler: getSchedulerStatus(),
    generator: getDailyScheduleGeneratorStatus(),
    queue: getQueueStatus(),
    browser: getBrowserStatus(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  });
});

// LOGS
router.get("/logs", (req, res) => {
  res.json(getLogs(100));
});

export default router;
