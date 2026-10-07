import { Router } from "express";

import { findUserById, createAuditLog } from "../models/index.js";

import { openPusaka } from "../services/index.js";
import { logger } from "../helpers/index.js";

const router = Router();

// 🔹 TEST BOT
router.post("/test-bot/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (Number.isNaN(userId)) {
      return res.status(400).send("ID tidak valid");
    }

    const user = findUserById(userId);

    if (!user) {
      return res.status(404).send("User tidak ditemukan");
    }

    await openPusaka("masuk", user);
    createAuditLog({
      action: "bot.manual_test",
      actor: "local-api",
      target_type: "user",
      target_id: user.id,
      metadata: { type: "masuk" },
    });

    return res.send(`✅ Bot dijalankan untuk user ${user.id}`);
  } catch (err) {
    logger.error("bot.manual_test_failed", err.message, { error: err });

    return res.status(500).send("❌ Error bot: " + err.message);
  }
});

export default router;
