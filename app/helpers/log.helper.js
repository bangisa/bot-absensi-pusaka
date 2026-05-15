import { createLog } from "../models/index.js";
import { formatDuration, getDuration } from "./time.helper.js";

function logSuccess(type, user, startTime) {
  const duration = getDuration(startTime);

  const label = {
    masuk: "Presensi masuk berhasil",
    pulang: "Presensi pulang berhasil",
  }[type];

  const message = `✅ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    type,
    status: "success",
    message,
  });

  console.log(`[V] ${message} | user=${user.id}`);
}

function logSkip(label, user, type, startTime, now) {
  const duration = getDuration(startTime);

  const message = `✅ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    type,
    status: "skipped",
    message,
  });

  console.log(`[!] ${message} | user=${user.id}`);
}

function logFail(label, user, type, startTime, now) {
  const duration = getDuration(startTime);

  const message = `⚠️ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    type,
    status: "failed",
    message,
  });

  console.log(`[X] ${message} | user=${user.id}`);
}

export { logSuccess, logSkip, logFail };
