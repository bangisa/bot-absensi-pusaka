const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { createLog } = require("../models/log.model");

const BASE_URL = "https://pusaka-v3.kemenag.go.id";

function getCookiePath(userId) {
  const dir = path.join(__dirname, "../cookies");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(__dirname, `../cookies/${userId}.json`);
}

// FORMAT WAKTU
function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;

  const sec = Math.floor(ms / 1000);
  return `${sec} detik`;
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

    await page.click("button[type='submit']");

    // 🔥 handle SPA + navigation
    try {
      await page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 15000,
      });
    } catch {
      console.log("[i] Tidak ada navigation (SPA), lanjut...");
    }

    // 🔥 validasi login sukses
    await page.waitForSelector("a[href='/profile']", {
      timeout: 20000,
    });

    // buffer kecil (optional tapi stabil)
    await new Promise((r) => setTimeout(r, 1000));

    console.log("[✔] Login sukses!");
    return true;
  } catch (err) {
    console.log("[x] Login error:", err.message);
    return false;
  }
}

// 🍪 SAVE COOKIE
async function saveCookies(page, userId) {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(getCookiePath(userId), JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.log("[x] Gagal simpan cookie:", err.message);
  }
}

// 🍪 LOAD COOKIE
async function loadCookies(page, userId) {
  const file = getCookiePath(userId);

  if (!fs.existsSync(file)) return false;

  try {
    const content = fs.readFileSync(file, "utf-8");
    if (!content) return false;

    const cookies = JSON.parse(content);
    await page.setCookie(...cookies);

    console.log("[i] Cookie loaded..");
    return true;
  } catch (err) {
    console.log("[x] Cookie rusak:", err.message);
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
        waitUntil: "networkidle2",
      });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  return false;
}

// 🔍 CEK LOGIN
async function isLoggedIn(page) {
  return await page.evaluate(() => {
    return !!document.querySelector("a[href='/profile']");
  });
}

// ➡️ NAVIGASI KE ABSENSI
async function gotoPresence(page) {
  for (let i = 0; i < 3; i++) {
    try {
      console.log(`[i] goto presence attempt ${i + 1}`);

      await page.goto(`${BASE_URL}/profile/presence`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
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
        throw new Error("Redirect ke login (session expired)");
      }

      await page.waitForSelector("button", { timeout: 10000 });

      console.log("[i] Berhasil masuk halaman absensi");
      return true;
    } catch (err) {
      console.log(`[x] Gagal masuk presence: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("[x] Gagal masuk halaman absensi setelah retry");
  return false;
}

// 🔍 CEK APAKAH SUDAH ABSEN?
async function getPresenceStatus(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();

    return {
      masuk: text.includes("sudah presensi masuk hari ini"),
      pulang: text.includes("sudah presensi hari ini"),
    };
  });
}

// 🎯 KLIK PRESENSI
async function clickPresensi(page, type) {
  return await page.evaluate((type) => {
    const buttons = Array.from(document.querySelectorAll("button"));

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
      return true;
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  return false;
}

// 🚀 MAIN ENGINE
async function openPusaka(type, user) {
  const startTime = Date.now();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = browser.defaultBrowserContext();

    await context.overridePermissions(BASE_URL, ["geolocation"]);

    const page = await browser.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    // 🌍 SET GEO
    await page.setGeolocation({
      latitude: user.latitude,
      longitude: user.longitude,
    });

    // 🍪 COOKIE
    await loadCookies(page, user.id);

    await page.goto(BASE_URL, {
      waitUntil: "networkidle2",
    });

    // 🔐 LOGIN
    let loggedIn = await isLoggedIn(page);

    if (!loggedIn && user.auto_login) {
      console.log("[i] Belum login, mencoba login...");

      const success = await loginWithRetry(page, user, 2);

      if (!success) {
        console.log("[x] Login gagal total!");

        createLog({
          user_id: user.id,
          type,
          status: "failed",
          message: "❌ Login gagal setelah retry",
        });

        return;
      }

      await saveCookies(page, user.id);
    } else {
      console.log("[i] Login via cookie..");
    }

    // ➡️ PRESENCE
    const ok = await gotoPresence(page);
    if (!ok) return;

    const status = await getPresenceStatus(page);

    // 🔍 LOGIC BERDASARKAN TYPE
    if (type === "masuk" && status.masuk) {
      console.log("[i] Sudah presensi masuk!");

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "skipped",
        message: "✅ Sudah presensi masuk",
      });

      return;
    }

    if (type === "pulang" && status.pulang) {
      console.log("[i] Sudah presensi pulang!");

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "skipped",
        message: "✅ Sudah presensi pulang",
      });

      return;
    }

    // 🎯 EKSEKUSI
    const result = await clickPresensi(page, type);
    const duration = Date.now() - startTime;
    const now = new Date().toLocaleTimeString();

    if (result.status === "clicked") {
      await new Promise((r) => setTimeout(r, 2000));
      await handleConfirm(page);

      const labelMap = {
        masuk: "✅ Presensi masuk berhasil",
        pulang: "✅ Presensi pulang berhasil",
      };

      const actionLabel = labelMap[type] || "⚠️ Presensi tidak dikenal";

      const now = new Date().toLocaleString("id-ID");

      const message = `${actionLabel} (${formatDuration(duration)}) - ${now}`;

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "success",
        message,
      });

      console.log(`[✔] ${message} | user=${user.id}`);
      return;
    } else if (result.status === "disabled") {
      const labelMap = {
        masuk: "⚠️ Tombol presensi masuk disabled",
        pulang: "⚠️ Tombol presensi pulang disabled",
      };

      const actionLabel = labelMap[type] || "⚠ Tombol presensi tidak dikenal";

      const now = new Date().toLocaleString("id-ID");

      const message = `${actionLabel} (${formatDuration(duration)}) - ${now}`;

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "skipped",
        message,
      });

      console.log(`[!] ${message} | user=${user.id}`);
      return;
    } else {
      const labelMap = {
        masuk: "❌ Tombol presensi masuk tidak ditemukan",
        pulang: "❌ Tombol presensi pulang tidak ditemukan",
      };

      const actionLabel = labelMap[type] || "❌ Tombol presensi tidak dikenal";

      const now = new Date().toLocaleString("id-ID");

      const message = `${actionLabel} (${formatDuration(duration)}) - ${now}`;

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "failed",
        message,
      });

      console.log(`[x] ${message} | user=${user.id}`);
      return;
    }
  } catch (err) {
    console.log("[x] Fatal:", err.message);
    createLog({
      user_id: user.id,
      username: user.username,
      type,
      status: "failed",
      message: err.message,
    });
    return;
  } finally {
    await browser.close();
  }
}

module.exports = {
  openPusaka,
};
