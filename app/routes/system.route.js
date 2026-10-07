import { Router } from "express";
import { getZonedDateTime } from "../helpers/time.helper.js";
import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  buildHealthSnapshot,
  buildReadinessSnapshot,
  startDailyScheduleGenerator,
  stopDailyScheduleGenerator,
  getDailyScheduleGeneratorStatus,
  getLifecycleStatus,
  getMaxConcurrentSetting,
  setMaxConcurrent,
} from "../services/index.js";

import {
  getLogs,
  getAuditLogs,
  createAuditLog,
} from "../models/index.js";

const router = Router();

// STATUS
router.get("/status", (req, res) => {
  res.json({
    ...getSchedulerStatus(),
    generator: getDailyScheduleGeneratorStatus(),
    lifecycle: getLifecycleStatus(),
  });
});

// START SCHEDULER
router.post("/scheduler/start", async (req, res) => {
  const status = getSchedulerStatus();

  if (status.running) {
    return res.send("Scheduler sudah berjalan");
  }

  const generatorStatus = await startDailyScheduleGenerator();

  if (generatorStatus.lastError) {
    return res.status(500).json({
      error: "Daily schedule generator gagal dijalankan",
      generator: generatorStatus,
    });
  }

  startScheduler();
  createAuditLog({
    action: "scheduler.start",
    actor: "local-api",
    target_type: "system",
  });

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
  createAuditLog({
    action: "scheduler.stop",
    actor: "local-api",
    target_type: "system",
  });

  res.send("Scheduler stopped");
});


// RUNTIME SETTING: MAX CONCURRENT
router.get("/settings/max-concurrent", (req, res) => {
  res.json(getMaxConcurrentSetting());
});

router.put("/settings/max-concurrent", (req, res) => {
  try {
    const previous = getMaxConcurrentSetting();
    const result = setMaxConcurrent(req.body?.value);

    createAuditLog({
      action: "settings.max_concurrent_changed",
      actor: "admin",
      target_type: "system_setting",
      target_id: "max_concurrent",
      metadata: {
        oldValue: previous.value,
        newValue: result.value,
      },
    });

    return res.json({
      ...result,
      warning:
        "Nilai concurrency yang lebih tinggi membutuhkan resource CPU/RAM lebih besar dan menjalankan lebih banyak browser automation secara paralel.",
    });
  } catch (err) {
    if (err?.code === "INVALID_MAX_CONCURRENT") {
      return res.status(400).json({
        error: err.message,
        code: err.code,
      });
    }

    throw err;
  }
});

// LIVENESS
router.get("/live", (req, res) => {
  res.json({
    status: "ok",
    timestamp: getZonedDateTime(),
  });
});

// READINESS
router.get("/ready", async (req, res) => {
  const readiness = await buildReadinessSnapshot();
  res.status(readiness.ready ? 200 : 503).json(readiness);
});

// HEALTHCHECK
router.get("/health", async (req, res) => {
  const health = await buildHealthSnapshot();
  res.status(health.status === "UNHEALTHY" ? 503 : 200).json(health);
});

// DEEP DIAGNOSTICS (read-only, no external network/browser launch)
router.get("/diagnostics", async (req, res) => {
  const diagnostics = await buildHealthSnapshot({ detailed: true });
  res.status(diagnostics.status === "UNHEALTHY" ? 503 : 200).json(diagnostics);
});

// LOGS
router.get("/logs", (req, res) => {
  res.json(getLogs(100));
});

router.get("/audit-logs", (req, res) => {
  res.json(getAuditLogs(100));
});

export default router;
