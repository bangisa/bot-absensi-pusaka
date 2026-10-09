import { geoConfig, queueConfig } from "../config/index.js";
import { createLog } from "../models/index.js";
import { getPage, releasePage } from "./page.service.js";
import { ensureLogin } from "./auth.service.js";
import { gotoPresence, handlePresenceFlow } from "./presence.service.js";
import { nowID, randomPointInRadius } from "../helpers/index.js";
import { beginUserOperation, endUserOperation } from "./user-operation.service.js";
import { findUserById } from "../models/user.model.js";
import { useServiceDayForExecution } from "./user-service-day.service.js";

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
async function openPusaka(type, user, { serviceDate } = {}) {
  beginUserOperation(user.id);
  const startTime = Date.now();
  const now = nowID();

  console.log("[INFO] openPusaka dipanggil:", user.id, type);

  let page = null;
  let context = null;

  try {
    // Refresh queued credentials and debit once, only when automation starts.
    user = findUserById(user.id) ?? user;
    if (!await useServiceDayForExecution(user.id, serviceDate)) {
      return { status: "skipped", message: "Hari libur atau kuota hari layanan telah habis." };
    }
    ({ page, context } = await getPage(user));

    if (!page || !context) {
      throw new Error("Browser page atau context tidak tersedia");
    }

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    const result = await runWithAutomationTimeout(
      async () => {
        const randomizedLocation = randomPointInRadius(
          user.latitude,
          user.longitude,
          geoConfig.radiusMeters,
        );

        await page.setGeolocation({
          latitude: randomizedLocation.latitude,
          longitude: randomizedLocation.longitude,
        });

        if (geoConfig.radiusMeters > 0) {
          console.log(
            `[GEO] User ${user.id}: random ${randomizedLocation.distanceMeters.toFixed(1)} m dari titik pusat`,
          );
        }

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
      nickname: user.nickname,
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
    try { await releasePage(page, context); }
    finally { endUserOperation(user.id); }
  }
}

export { openPusaka };
