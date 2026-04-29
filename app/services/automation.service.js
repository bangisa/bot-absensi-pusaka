const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { createLog } = require("../models/log.model");

const BASE_URL = "https://pusaka-v3.kemenag.go.id";

function getCookiePath(userId) {
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
    console.log(`🔐 Login: ${user.username}`);

    await page.waitForSelector("input[name='email']", { timeout: 15000 });

    await page.type("input[name='email']", user.username, { delay: 50 });
    await page.type("input[name='password']", user.password, { delay: 50 });

    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    await page.waitForSelector("a[href='/profile']", { timeout: 15000 });

    console.log("Login sukses!");
    return true;
  } catch (err) {
    console.log("❌ Login gagal:", err.message);
    return false;
  }
}

// 🍪 SAVE COOKIE
async function saveCookies(page, userId) {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(getCookiePath(userId), JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.log("❌ Gagal simpan cookie:", err.message);
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

    console.log("🍪 Cookie loaded..");
    return true;
  } catch (err) {
    console.log("❌ Cookie rusak:", err.message);
    return false;
  }
}

// 🔍 CEK LOGIN
async function isLoggedIn(page) {
  try {
    await page.waitForSelector("a[href='/profile']", { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

// ➡️ NAVIGASI KE ABSENSI
async function gotoPresence(page) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`${BASE_URL}/profile/presence`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      const ok = await page.evaluate(() =>
        window.location.pathname.includes("/profile/presence"),
      );

      if (ok) return true;
    } catch {}

    console.log(`🔁 Retry presence (${i + 1})`);
  }

  return false;
}

// 🔍 CEK APAKAH SUDAH ABSEN?
async function getPresenceStatus(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();

    return {
      masuk: text.includes("sudah presensi masuk"),
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
      console.log("Konfirmasi absen");
      return true;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return false;
}

// 🚀 MAIN ENGINE
async function openPusaka(type, user) {
  const startTime = Date.now();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
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

    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "networkidle2",
    });

    // 🔐 LOGIN
    let loggedIn = await isLoggedIn(page);

    if (!loggedIn && user.auto_login) {
      const success = await autoLogin(page, user);

      if (!success) {
        console.log("❌ Login gagal total");
        return;
      }

      await saveCookies(page, user.id);
    } else {
      console.log("Login via cookie..");
    }

    // ➡️ PRESENCE
    const ok = await gotoPresence(page);
    if (!ok) return;

    const status = await getPresenceStatus(page);

    // 🔍 LOGIC BERDASARKAN TYPE
    if (type === "masuk" && status.masuk) {
      console.log("ℹ️ Sudah presensi masuk");

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "skipped",
        message: "Sudah presensi masuk",
      });

      return;
    }

    if (type === "pulang" && status.pulang) {
      console.log("ℹ️ Sudah presensi pulang");

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "skipped",
        message: "Sudah presensi pulang",
      });

      return;
    }

    // 🎯 EKSEKUSI
    const result = await clickPresensi(page, type);

    if (result.status === "clicked") {
      await new Promise((r) => setTimeout(r, 2000));
      await handleConfirm(page);

      const actionLabel =
        type === "masuk"
          ? "✅ Presensi masuk berhasil"
          : type === "pulang"
            ? "✅ Presensi pulang berhasil"
            : "✅ Presensi berhasil";

      const duration = Date.now() - startTime;
      const now = new Date().toLocaleTimeString();

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "success",
        message: `${actionLabel} (${formatDuration(duration)}) - ${now}`,
      });
    } else if (result.status === "disabled") {
      const reason =
        type === "masuk"
          ? "⚠ Tombol presensi masuk disabled"
          : type === "pulang"
            ? "⚠ Tombol presensi pulang disabled"
            : "⚠ Tombol presensi disabled";

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "skipped",
        message: `${reason} (${formatDuration(duration)}) - ${now}`,
      });
    } else {
      const reason =
        type === "masuk"
          ? "❌ Tombol presensi masuk tidak ditemukan"
          : type === "pulang"
            ? "❌ Tombol presensi pulang tidak ditemukan"
            : "❌ Tombol presensi tidak ditemukan";

      createLog({
        user_id: user.id,
        username: user.username,
        type,
        status: "failed",
        message: `${reason} (${formatDuration(duration)}) - ${now}`,
      });
    }
  } catch (err) {
    console.log("❌ Fatal:", err.message);
    createLog({
      user_id: user.id,
      username: user.username,
      type,
      status: "failed",
      message: err.message,
    });
  } finally {
    await browser.close();
  }
}

module.exports = {
  openPusaka,
};
