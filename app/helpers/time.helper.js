import { timeConfig } from "../config/time.config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getZonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeConfig.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getZonedDate(date = new Date()) {
  const p = getZonedParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function getZonedTime(date = new Date()) {
  const p = getZonedParts(date);
  return `${p.hour}:${p.minute}:${p.second}`;
}

function getZonedDateTime(date = new Date()) {
  return `${getZonedDate(date)} ${getZonedTime(date)}`;
}

function getZonedDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeConfig.timeZone,
    weekday: "long",
  })
    .format(date)
    .toLowerCase();
}

function getZonedDateTimeAfterSeconds(seconds) {
  return getZonedDateTime(new Date(Date.now() + seconds * 1000));
}

function getZonedDateTimeBeforeDays(days) {
  return getZonedDateTime(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function nowID() {
  const p = getZonedParts();
  return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
}

function nowSQL() {
  return getZonedDateTime();
}

function nowLog() {
  return getZonedDateTime();
}

function nowLocalISO() {
  const p = getZonedParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function getDuration(startTime) {
  return Date.now() - startTime;
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const sec = durationMs / 1000;

  if (sec < 60) {
    return `${sec.toFixed(1)} detik`;
  }

  const min = Math.floor(sec / 60);
  const remainingSec = (sec % 60).toFixed(0);

  return `${min}m ${remainingSec}d`;
}

export {
  sleep,
  nowID,
  nowSQL,
  nowLog,
  nowLocalISO,
  getZonedParts,
  getZonedDate,
  getZonedTime,
  getZonedDateTime,
  getZonedDay,
  getZonedDateTimeAfterSeconds,
  getZonedDateTimeBeforeDays,
  getDuration,
  formatDuration,
};
