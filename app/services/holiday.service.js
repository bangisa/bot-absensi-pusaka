const HOLIDAY_API_BASE_URL = "https://api.kemendesa.link/libur-nasional/api";
const HOLIDAY_API_TIMEOUT_MS = 5000;

async function fetchJsonWithTimeout(url, timeoutMs = HOLIDAY_API_TIMEOUT_MS) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
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

async function checkNationalHoliday(date) {
  const url = new URL(`${HOLIDAY_API_BASE_URL}/is-holiday`);
  url.searchParams.set("date", date);

  try {
    const result = await fetchJsonWithTimeout(url);
    const holiday = result?.data ?? null;

    return {
      available: true,
      isHoliday: Boolean(result?.is_holiday),
      date,
      name: holiday?.name ?? null,
      isCutiBersama: Boolean(holiday?.is_cuti_bersama),
      source: "kemendesa",
    };
  } catch (err) {
    return {
      available: false,
      isHoliday: false,
      date,
      name: null,
      isCutiBersama: false,
      source: "kemendesa",
      error: err.message,
    };
  }
}

export { checkNationalHoliday };
