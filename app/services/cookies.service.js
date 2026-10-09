import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import db from "../../database/db.js";

function credentialVersion(id) {
  return db.prepare("SELECT credential_version FROM users WHERE id = ?").get(id)?.credential_version;
}

const COOKIE_DIR = path.resolve("cookies");

async function ensureCookieDir() {
  try {
    await fs.mkdir(COOKIE_DIR, {
      recursive: true,
    });
  } catch {}
}

function getCookiePath(userId) {
  return path.join(COOKIE_DIR, `${userId}.json`);
}

async function saveCookies(page, userId) {
  try {
    await ensureCookieDir();

    const cookies = await page.cookies();

    const version = credentialVersion(userId);
    if (version === undefined) return;
    await fs.writeFile(getCookiePath(userId), JSON.stringify({ version, cookies }, null, 2));

    console.log(`[COOKIE] Saved user=${userId}`);
  } catch (err) {
    console.log("[COOKIE SAVE ERROR]", err.message);
  }
}

async function loadCookies(page, userId) {
  try {
    const cookiePath = getCookiePath(userId);

    if (!existsSync(cookiePath)) {
      return false;
    }

    const stored = JSON.parse(await fs.readFile(cookiePath, "utf-8"));
    const version = credentialVersion(userId);
    const storedVersion = Array.isArray(stored) ? 0 : stored.version;
    if (version === undefined || version !== storedVersion) return false;
    const cookies = Array.isArray(stored) ? stored : stored.cookies;

    if (!Array.isArray(cookies) || !cookies.length) {
      return false;
    }

    await page.setCookie(...cookies);

    console.log(`[COOKIE] Loaded ${cookies.length} user=${userId}`);

    return true;
  } catch (err) {
    console.log("[COOKIE LOAD ERROR]", err.message);

    return false;
  }
}

async function clearCookies(userId) {
  try {
    const cookiePath = getCookiePath(userId);

    if (existsSync(cookiePath)) {
      await fs.unlink(cookiePath);
    }
  } catch {}
}

export { saveCookies, loadCookies, clearCookies };
