const MAX_BYTES = 256 * 1024;

export function calendarError(message) {
  return Object.assign(new Error(message), { code: "INVALID_HOLIDAY_CALENDAR" });
}

export function validateCalendarUrl(value) {
  if (typeof value !== "string" || value.length > 512) {
    throw calendarError("URL kalender tidak valid.");
  }
  let url;
  try { url = new URL(value.trim()); } catch { throw calendarError("URL kalender tidak valid."); }
  // Only trusted, fixed JSON endpoints are allowed; never follow redirects.
  if (url.origin !== "https://api.kemendesa.link" || url.username || url.password ||
      url.search || url.hash || !/^\/libur-nasional\/api\/holidays\/(latest|\d{4}\.json)$/.test(url.pathname)) {
    throw calendarError("Gunakan URL JSON Kemendesa /holidays/latest atau /holidays/YYYY.json.");
  }
  return url.href;
}

export function validateCalendar(data, url) {
  const year = data?.metadata?.year;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Array.isArray(data?.data) || data.data.length < 1 || data.data.length > 366) {
    throw calendarError("Metadata tahun atau daftar hari libur tidak valid.");
  }
  const urlYear = new URL(url).pathname.match(/\/(\d{4})\.json$/)?.[1];
  if (urlYear && Number(urlYear) !== year) throw calendarError("Tahun URL berbeda dengan tahun data.");
  const dates = new Set();
  const holidays = data.data.map((item) => {
    const date = item?.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !date.startsWith(`${year}-`) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || dates.has(date) ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 300 ||
        typeof item.is_cuti_bersama !== "boolean") {
      throw calendarError("Tanggal, nama libur, atau penanda cuti bersama tidak valid/duplikat.");
    }
    dates.add(date);
    return { date, name: item.name.trim(), isCutiBersama: item.is_cuti_bersama };
  });
  return { year, holidays: holidays.sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function fetchCalendar(value, fetcher = fetch) {
  const url = validateCalendarUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal, redirect: "error", headers: { accept: "application/json" },
    });
    if (!response.ok) throw calendarError(`Provider mengembalikan HTTP ${response.status}.`);
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw calendarError("Respons provider bukan JSON.");
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw calendarError("File kalender terlalu besar.");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw calendarError("File kalender terlalu besar.");
      chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { url, ...validateCalendar(data, url), fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (error.code === "INVALID_HOLIDAY_CALENDAR") throw error;
    throw calendarError("Kalender tidak dapat diunduh atau JSON tidak valid. Pengaturan lama tetap digunakan.");
  } finally {
    clearTimeout(timer);
  }
}
