import { browserConfig, retryConfig } from "../config/index.js";
import { sleep } from "../helpers/index.js";
import { saveCookies, loadCookies, clearCookies } from "./cookies.service.js";

async function autoLogin(page, user) {
  try {
    await page.goto(`${browserConfig.baseUrl}/login`, {
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

    await sleep(1000);

    console.log("[V] Login sukses!");
    return true;
  } catch (err) {
    console.log("[X] Login error:", err.message);
    return false;
  }
}

async function loginWithRetry(page, user, maxRetry = 2) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    console.log(`[i] Login attempt ${attempt} user ${user.id}`);

    const success = await autoLogin(page, user);

    if (success) return true;

    if (attempt < maxRetry) {
      console.log("[i] Retry login...");
      await page.goto(`${browserConfig.baseUrl}/login`, {
        waitUntil: "domcontentloaded",
      });
      await sleep(retryConfig.retryDelay);
    }
  }

  return false;
}

async function isLoggedIn(page) {
  try {
    return await page.evaluate(() => {
      return !!document.querySelector("a[href='/profile']");
    });
  } catch {
    return false;
  }
}

async function ensureLogin(page, user) {
  await loadCookies(page, user.id);

  console.log("[i] Membuka browser...");

  await page.goto(browserConfig.baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForSelector("body", { timeout: 10000 });

  let loggedIn = await isLoggedIn(page);

  // cookie invalid
  if (!loggedIn) {
    await clearCookies(user.id);
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
    await page.goto(browserConfig.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await sleep(retryConfig.retryDelay);

    loggedIn = await isLoggedIn(page);

    if (!loggedIn) {
      throw new Error("Login berhasil tapi session tidak valid");
    }
  }

  console.log("[V] Login valid");
}

export { autoLogin, loginWithRetry, isLoggedIn, ensureLogin };
