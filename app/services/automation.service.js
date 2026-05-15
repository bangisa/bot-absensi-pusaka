import { createLog } from "../models/index.js";
import { getPage, releasePage } from "./page.service.js";
import { ensureLogin } from "./auth.service.js";
import { gotoPresence, handlePresenceFlow } from "./presence.service.js";

// 🚀 MAIN ENGINE
async function openPusaka(type, user) {
  const startTime = Date.now();
  const now = new Date();
  console.log("🔥 openPusaka dipanggil:", user.id, type);

  let page = null;
  let context = null;

  try {
    ({ page, context } = await getPage(user));
    if (!page || !context) return;

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // GEO
    await page.setGeolocation({
      latitude: user.latitude,
      longitude: user.longitude,
    });

    // LOGIN
    await ensureLogin(page, user);

    // NAVIGASI
    const ok = await gotoPresence(page, user);
    if (!ok) {
      console.log("[X] Presence gagal total untuk user:", user.id);
      throw new Error("Presence gagal!");
    }

    // EKSEKUSI
    await handlePresenceFlow(page, type, user, startTime, now);
  } catch (err) {
    console.log("[X] Fatal:", err.message);

    createLog({
      user_id: user.id,
      username: user.username,
      type,
      status: "failed",
      message: err.message,
    });
  } finally {
    await releasePage(page, context);
  }
}

export { openPusaka };
