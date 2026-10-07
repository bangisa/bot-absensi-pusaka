import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";

import { holidayConfig } from "../config/holiday.config.js";

const CACHE_VERSION = 1;

function normalizeHoliday({
  date,
  isHoliday,
  name = null,
  isCutiBersama = false,
  source,
  available = true,
  error = null,
}) {
  return {
    available,
    isHoliday: Boolean(isHoliday),
    date,
    name: name || null,
    isCutiBersama: Boolean(isCutiBersama),
    source,
    ...(error ? { error } : {}),
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = holidayConfig.timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "bot-absensi-pusaka/2.1",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function checkPrimaryProvider(date) {
  const url = new URL(`${holidayConfig.primaryBaseUrl}/is-holiday`);
  url.searchParams.set("date", date);

  const result = await fetchJsonWithTimeout(url);
  const holiday = result?.data ?? null;

  if (typeof result?.is_holiday !== "boolean") {
    throw new Error("response primary provider tidak valid");
  }

  return normalizeHoliday({
    date,
    isHoliday: result.is_holiday,
    name: holiday?.name ?? null,
    isCutiBersama: holiday?.is_cuti_bersama ?? false,
    source: "kemendesa",
  });
}

async function checkSecondaryProvider(date) {
  const url = new URL(`${holidayConfig.secondaryBaseUrl}/libur`);
  url.searchParams.set("date", date);

  const result = await fetchJsonWithTimeout(url);

  if (typeof result?.is_holiday !== "boolean") {
    throw new Error("response secondary provider tidak valid");
  }

  const national = result?.libur_nasional ?? null;
  const jointLeave = result?.cuti_bersama ?? null;
  const holiday = national ?? jointLeave;

  return normalizeHoliday({
    date,
    isHoliday: result.is_holiday,
    name: holiday?.name ?? null,
    isCutiBersama: Boolean(jointLeave),
    source: "data-libur-nasional-indonesia",
  });
}

async function readJsonFile(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function readCache(date) {
  try {
    const cache = await readJsonFile(holidayConfig.cacheFile, {
      version: CACHE_VERSION,
      dates: {},
    });

    const entry = cache?.dates?.[date];
    if (!entry || typeof entry.isHoliday !== "boolean") return null;

    return normalizeHoliday({
      date,
      isHoliday: entry.isHoliday,
      name: entry.name ?? null,
      isCutiBersama: entry.isCutiBersama ?? false,
      source: `cache:${entry.source || "unknown"}`,
    });
  } catch (err) {
    console.log(`[HOLIDAY] Cache tidak dapat dibaca: ${err.message}`);
    return null;
  }
}

async function writeCache(result) {
  try {
    await mkdir(dirname(holidayConfig.cacheFile), { recursive: true });

    const cache = await readJsonFile(holidayConfig.cacheFile, {
      version: CACHE_VERSION,
      dates: {},
    });

    const nextCache = {
      version: CACHE_VERSION,
      dates: {
        ...(cache?.dates || {}),
        [result.date]: {
          isHoliday: result.isHoliday,
          name: result.name,
          isCutiBersama: result.isCutiBersama,
          source: result.source,
          cachedAt: new Date().toISOString(),
        },
      },
    };

    const tempFile = `${holidayConfig.cacheFile}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(nextCache, null, 2)}\n`, "utf8");
    await rename(tempFile, holidayConfig.cacheFile);
  } catch (err) {
    // Cache hanya optimasi/fallback. Gagal menyimpan cache tidak boleh
    // menggagalkan pembuatan jadwal harian.
    console.log(`[HOLIDAY] Gagal menyimpan cache: ${err.message}`);
  }
}

async function readManualOverride(date) {
  try {
    const overrides = await readJsonFile(holidayConfig.overridesFile, {
      version: 1,
      dates: {},
    });

    const entry = overrides?.dates?.[date];
    if (!entry || typeof entry.isHoliday !== "boolean") return null;

    return normalizeHoliday({
      date,
      isHoliday: entry.isHoliday,
      name: entry.name ?? null,
      isCutiBersama: entry.isCutiBersama ?? false,
      source: "manual-override",
    });
  } catch (err) {
    console.log(`[HOLIDAY] Override manual tidak dapat dibaca: ${err.message}`);
    return null;
  }
}

async function checkNationalHoliday(date) {
  const errors = [];

  try {
    const primary = await checkPrimaryProvider(date);
    await writeCache(primary);
    return primary;
  } catch (err) {
    errors.push(`kemendesa: ${err.message}`);
    console.log(`[HOLIDAY] Primary provider gagal ${date}: ${err.message}`);
  }

  try {
    const secondary = await checkSecondaryProvider(date);
    await writeCache(secondary);
    console.log(`[HOLIDAY] Menggunakan secondary provider untuk ${date}`);
    return secondary;
  } catch (err) {
    errors.push(`secondary: ${err.message}`);
    console.log(`[HOLIDAY] Secondary provider gagal ${date}: ${err.message}`);
  }

  const cached = await readCache(date);
  if (cached) {
    console.log(`[HOLIDAY] Menggunakan cache lokal untuk ${date}`);
    return cached;
  }

  const manual = await readManualOverride(date);
  if (manual) {
    console.log(`[HOLIDAY] Menggunakan override manual untuk ${date}`);
    return manual;
  }

  // Fail-open mempertahankan perilaku lama: kegagalan seluruh provider
  // tidak boleh menghentikan generator jadwal. available=false membuat
  // kondisi ini tetap terlihat di log/status.
  return normalizeHoliday({
    date,
    isHoliday: false,
    source: "unavailable",
    available: false,
    error: errors.join(" | ") || "holiday provider unavailable",
  });
}

export {
  checkNationalHoliday,
  checkPrimaryProvider,
  checkSecondaryProvider,
};
