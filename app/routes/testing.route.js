import { Router } from "express";

import { findUserById } from "../models/index.js";

import { openPusaka } from "../services/index.js";

const router = Router();

// 🔹 TEST BOT
router.get("/test-bot/:id", async (req, res) => {
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

    return res.send(`✅ Bot dijalankan untuk user ${user.id}`);
  } catch (err) {
    console.error("[TEST BOT ERROR]", err);

    return res.status(500).send("❌ Error bot: " + err.message);
  }
});

export default router;
