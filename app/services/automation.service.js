import { queueConfig } from "../config/index.js";
import { createLog } from "../models/index.js";
import { getPage, releasePage } from "./page.service.js";
import { ensureLogin } from "./auth.service.js";
import { gotoPresence, handlePresenceFlow } from "./presence.service.js";
import { nowID } from "../helpers/index.js";

const AUTOMATION_TIMEOUT = Math.max(1000, queueConfig.taskTimeout - 10000);

class AutomationTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Automation timeout setelah ${timeoutMs} ms`);

    this.name = "AutomationTimeoutError";
    this.code = "AUTOMATION_TIMEOUT";
  }
}

function runWithAutomationTimeout(task, { timeoutMs, onTimeout }) {
  let timeoutId;
  let settled = false;

  const taskPromise = Promise.resolve()
    .then(task)
    .finally(() => {
      settled = true;
    });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      if (settled) {
        return;
      }

      console.log(`[TIMEOUT] Automation melewati ${timeoutMs} ms`);

      try {
        await onTimeout?.();
      } catch (err) {
        console.log("[X] Gagal menghentikan automation:", err.message);
      }

      reject(new AutomationTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([taskPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

// 🚀 MAIN ENGINE
async function openPusaka(type, user) {
  const startTime = Date.now();
  const now = nowID();

  console.log("[INFO] openPusaka dipanggil:", user.id, type);

  let page = null;
  let context = null;

  try {
    ({ page, context } = await getPage(user));

    if (!page || !context) {
      throw new Error("Browser page atau context tidak tersedia");
    }

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    const result = await runWithAutomationTimeout(
      async () => {
        await page.setGeolocation({
          latitude: user.latitude,
          longitude: user.longitude,
        });

        await ensureLogin(page, user);

        const ok = await gotoPresence(page, user);

        if (!ok) {
          throw new Error("Gagal membuka halaman presensi");
        }

        return handlePresenceFlow(page, type, user, startTime, now);
      },
      {
        timeoutMs: AUTOMATION_TIMEOUT,

        onTimeout: async () => {
          /*
           * Menutup page akan memutus operasi
           * Puppeteer yang sedang menunggu.
           *
           * Context tetap ditutup oleh finally
           * melalui releasePage().
           */
          if (page && !page.isClosed()) {
            await page.close({
              runBeforeUnload: false,
            });
          }
        },
      },
    );

    return result;
  } catch (err) {
    const isTimeout = err?.code === "AUTOMATION_TIMEOUT";

    const message = isTimeout
      ? `Automation timeout untuk user ${user.id}`
      : err.message;

    console.log(isTimeout ? "[TIMEOUT]" : "[X] Fatal:", message);

    createLog({
      user_id: user.id,
      username: user.username,
      type,
      status: "failed",
      message,
    });

    /*
     * Error harus dilempar kembali agar scheduler
     * dapat menjalankan markScheduleRetry().
     */
    throw new Error(message, {
      cause: err,
    });
  } finally {
    await releasePage(page, context);
  }
}

export { openPusaka };
