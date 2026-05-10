import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createLog } from "../models/log.model.js";
import { getBrowser } from "./browser.service.js";
import { getPage, releasePage } from "./page.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = "https://pusaka-v3.kemenag.go.id";

function getCookiePath(userId) {
  const dir = join(__dirname, "../cookies");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(__dirname, `../cookies/${userId}.json`);
}

// FORMAT WAKTU
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;

  const sec = Math.floor(ms / 1000);
  return `${sec} detik`;
}

function getDuration(startTime) {
  return ((Date.now() - startTime) / 1000).toFixed(1);
}

// 🔐 AUTO LOGIN
async function autoLogin(page, user) {
  try {
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
    });

    console.log(`[i] Login: ${user.username}`);

    await page.waitForSelector("input[name='email']", { timeout: 15000 });

    await page.type("input[name='email']", user.username, { delay: 30 });
    await page.type("input[name='password']", user.password, { delay: 30 });

    // 🔥 handle SPA + navigation
    try {
      await page.click("button[type='submit']");
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForSelector("a[href='/profile']", {
        timeout: 20000,
      });
    } catch {}

    // buffer kecil (optional tapi stabil)
    await sleep(1000);

    console.log("[V] Login sukses!");
    return true;
  } catch (err) {
    console.log("[X] Login error:", err.message);
    return false;
  }
}

// 🍪 SAVE COOKIE
async function saveCookies(page, userId) {
  try {
    const cookies = await page.cookies();
    writeFileSync(getCookiePath(userId), JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.log("[X] Gagal simpan cookie:", err.message);
  }
}

// 🍪 LOAD COOKIE
async function loadCookies(page, userId) {
  const file = getCookiePath(userId);

  if (!existsSync(file)) return false;

  try {
    const content = readFileSync(file, "utf-8");
    if (!content) return false;

    const cookies = JSON.parse(content);
    await page.setCookie(...cookies);

    console.log("[i] Cookie loaded..");
    return true;
  } catch (err) {
    console.log("[X] Cookie rusak:", err.message);
    return false;
  }
}

// Login with Retry
async function loginWithRetry(page, user, maxRetry = 2) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    console.log(`[i] Login attempt ${attempt} user ${user.id}`);

    const success = await autoLogin(page, user);

    if (success) return true;

    if (attempt < maxRetry) {
      console.log("[i] Retry login...");
      await page.goto(`${BASE_URL}/login`, {
        waitUntil: "domcontentloaded",
      });
      await sleep(3000);
    }
  }

  return false;
}

// 🔍 CEK LOGIN
async function isLoggedIn(page) {
  try {
    return await page.evaluate(() => {
      return !!document.querySelector("a[href='/profile']");
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureLogin(page, user) {
  await loadCookies(page, user.id);

  console.log("[i] Membuka BASE_URL...");

  await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await sleep(3000);

  let loggedIn = await isLoggedIn(page);

  // cookie invalid
  if (!loggedIn) {
    if (!user.auto_login) {
      throw new Error("User tidak login dan auto_login disabled");
    }

    console.log("[!] Cookie tidak valid, login ulang...");

    const success = await loginWithRetry(page, user, 2);

    if (!success) {
      throw new Error("Login gagal total");
    }

    await saveCookies(page, user.id);

    // refresh state
    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await sleep(3000);

    loggedIn = await isLoggedIn(page);

    if (!loggedIn) {
      throw new Error("Login berhasil tapi session tidak valid");
    }
  }

  console.log("[V] Login valid");
}

// ➡️ NAVIGASI KE ABSENSI
async function gotoPresence(page, user) {
  for (let i = 0; i < 3; i++) {
    try {
      console.log(`[i] Go to presence attempt ${i + 1} user ${user.id}`);

      await page.goto(`${BASE_URL}/profile/presence`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await page.waitForFunction(() => {
        const btns = [...document.querySelectorAll("button")];
        return btns.some((b) => b.innerText.toLowerCase().includes("presensi"));
      });

      await page.waitForFunction(
        () => {
          return (
            window.location.pathname.includes("/profile/presence") ||
            window.location.pathname.includes("/login")
          );
        },
        { timeout: 15000 },
      );

      const isLoginPage = await page.evaluate(() =>
        window.location.pathname.includes("/login"),
      );

      if (isLoginPage) {
        i = -1;
        console.log("[!] Session expired, mencoba login ulang...");

        const success = await loginWithRetry(page, user, 2);

        if (!success) {
          throw new Error("Login ulang gagal");
        }

        // ulangi navigasi setelah login
        continue;
      }

      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button")).filter(
          (btn) => {
            const text = btn.innerText.toLowerCase();
            return (
              btn.offsetParent !== null &&
              text.length > 3 &&
              (text.includes("presensi") ||
                text.includes("masuk") ||
                text.includes("pulang"))
            );
          },
        );
      });

      console.log("[V] Berhasil masuk halaman absensi");
      return true;
    } catch (err) {
      console.log(`[X] Gagal masuk presence: ${err.message}`);
    }

    await sleep(3000);
  }

  console.log("[X] Gagal masuk halaman absensi setelah retry");
  return false;
}

// 🔍 CEK APAKAH SUDAH ABSEN?
async function getPresenceStatus(page) {
  return await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (btn) => btn.offsetParent !== null,
    );

    const texts = buttons.map((btn) => btn.innerText.toLowerCase().trim());

    const masuk =
      texts.some((t) => t.includes("sudah presensi masuk")) ||
      texts.some((t) => t.includes("presensi pulang"));

    const pulang = texts.some((t) =>
      t.includes("anda sudah presensi hari ini"),
    );

    console.log("[DEBUG BUTTONS]", texts);
    return {
      masuk,
      pulang,
      debug: texts,
    };
  });
}

// 🎯 KLIK PRESENSI
async function clickPresensi(page, type) {
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.toLowerCase().includes("presensi"),
    );

    return btn && !btn.disabled;
  });

  await sleep(3000);

  return await page.evaluate((type) => {
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (btn) => btn.offsetParent !== null,
    );

    for (const btn of buttons) {
      const text = btn.innerText.toLowerCase();

      const match =
        (type === "masuk" &&
          (text.includes("masuk") || text.includes("presensi masuk"))) ||
        (type === "pulang" &&
          (text.includes("pulang") || text.includes("presensi pulang")));

      if (match) {
        if (btn.disabled) return { status: "disabled" };

        btn.click();
        return { status: "clicked" };
      }
    }

    return { status: "not_found" };
  }, type);
}

async function clickWithRetry(page, type, maxRetry = 3) {
  for (let i = 0; i < maxRetry; i++) {
    const result = await clickPresensi(page, type);

    if (result.status !== "not_found") {
      return result;
    }

    console.log(`[i] Tombol belum ada, retry ${i + 1}`);
    await sleep(3000);
  }

  return { status: "not_found" };
}

// ✅ HANDLE MODAL
async function handleConfirm(page) {
  for (let i = 0; i < 5; i++) {
    const found = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const yes = btns.find((b) => b.innerText.toLowerCase().trim() === "ya");

      if (yes) {
        yes.click();
        return true;
      }

      return false;
    });

    if (found) {
      console.log("[i] Mengonfirmasi absen...");
      await page
        .waitForFunction(
          () => {
            return (
              document.body.innerText.toLowerCase().includes("berhasil") ||
              document.body.innerText.toLowerCase().includes("sudah presensi")
            );
          },
          { timeout: 10000 },
        )
        .catch(() => {});
      return true;
    }

    await sleep(3000);
  }

  return false;
}

async function handlePresenceFlow(page, type, user, startTime, now) {
  const status = await getPresenceStatus(page);
  console.log("[DEBUG STATUS]", status);

  if (type === "masuk" && status.masuk) {
    return logSkip("Sudah presensi masuk", user, type, startTime, now);
  }

  if (type === "pulang" && status.pulang) {
    return logSkip("Sudah presensi pulang", user, type, startTime, now);
  }

  const result = await clickWithRetry(page, type);

  if (result.status === "clicked") {
    await sleep(3000);
    await handleConfirm(page);

    return logSuccess(type, user, startTime, now);
  }

  if (result.status === "disabled") {
    return logSkip("Tombol disabled", user, type, startTime, now);
  }

  return logFail("Tombol tidak ditemukan", user, type, startTime, now);
}

function logSuccess(type, user, startTime, now) {
  const duration = getDuration(startTime);

  const label = {
    masuk: "Presensi masuk berhasil",
    pulang: "Presensi pulang berhasil",
  }[type];

  const message = `✅ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    type,
    status: "success",
    message,
  });

  console.log(`[V] ${message} | user=${user.id}`);
}

function logSkip(label, user, type, startTime, now) {
  const duration = getDuration(startTime);

  const message = `✅ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    type,
    status: "skipped",
    message,
  });

  console.log(`[!] ${message} | user=${user.id}`);
}

function logFail(label, user, type, startTime, now) {
  const duration = getDuration(startTime);

  const message = `⚠️ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    type,
    status: "failed",
    message,
  });

  console.log(`[X] ${message} | user=${user.id}`);
}

// 🚀 MAIN ENGINE
async function openPusaka(type, user) {
  const startTime = Date.now();
  const now = new Date().toLocaleTimeString("id-ID");
  console.log("🔥 openPusaka dipanggil:", user.id, type);

  let page = null;
  let context = null;

  try {
    ({ page, context } = await getPage());
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
