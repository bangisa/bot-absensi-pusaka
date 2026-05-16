function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowID() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Jakarta",
    }),
  );
}

function nowSQL() {
  return new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
  });
}

function nowLog() {
  return new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Jakarta",
  });
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

export { sleep, nowID, nowSQL, nowLog, getDuration, formatDuration };
