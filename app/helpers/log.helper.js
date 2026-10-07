import { createLog } from "../models/index.js";
import { formatDuration, getDuration } from "./time.helper.js";
import { logger } from "./structured-log.helper.js";

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
    nickname: user.nickname,
    type,
    status: "success",
    message,
  });

  logger.info("presence.success", message, { userId: user.id, type, durationMs: duration });
}

function logSkip(label, user, type, startTime, now) {
  const duration = getDuration(startTime);

  const message = `⏭️ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    nickname: user.nickname,
    type,
    status: "skipped",
    message,
  });

  logger.info("presence.skipped", message, { userId: user.id, type, durationMs: duration });
}

function logFail(label, user, type, startTime, now) {
  const duration = getDuration(startTime);

  const message = `❌ ${label} (${formatDuration(duration)})`;

  createLog({
    user_id: user.id,
    username: user.username,
    nickname: user.nickname,
    type,
    status: "failed",
    message,
  });

  logger.warn("presence.failed", message, { userId: user.id, type, durationMs: duration });
}

export { logSuccess, logSkip, logFail };
