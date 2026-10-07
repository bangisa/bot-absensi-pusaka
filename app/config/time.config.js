import { env } from "./env.config.js";

function validateTimeZone(value) {
  const candidate = value || "Asia/Jakarta";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "Asia/Jakarta";
  }
}

export const timeConfig = {
  timeZone: validateTimeZone(env.TZ),
  locale: "id-ID",
};
