import db from "../../database/db.js";
import { maskUsername } from "../helpers/credential.helper.js";
import { redactString } from "../helpers/redact.helper.js";
import { nowSQL, getZonedDateTimeBeforeDays } from "../helpers/time.helper.js";


const STATUS_EMOJI = {
  success: "✅",
  failed: "❌",
  skipped: "⏭️",
};

const KNOWN_STATUS_EMOJI = /^(?:✅|❌|⚠️|⚠|⏭️|⏭|ℹ️|ℹ|🔄|⏳)\s*/u;

function normalizeStatusMessage(status, message) {
  const text = String(message ?? "").trim();
  const emoji = STATUS_EMOJI[status];

  if (!emoji) return text;

  const normalizedText = text.replace(KNOWN_STATUS_EMOJI, "").trim();
  return normalizedText ? `${emoji} ${normalizedText}` : emoji;
}


function createLog(data) {
  const created_at = nowSQL();

  return db
    .prepare(
      `
      INSERT INTO logs 
      (user_id, username, nickname, type, status, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      data.user_id,
      maskUsername(data.username),
      data.nickname || null,
      data.type,
      data.status,
      redactString(normalizeStatusMessage(data.status, data.message)),
      created_at,
    );
}

function getLogs(limit = 50) {
  return db
    .prepare(
      `
      SELECT
        l.id,
        l.user_id,
        l.username,
        COALESCE(l.nickname, u.nickname, l.username) AS nickname,
        l.type,
        l.status,
        l.message,
        l.created_at
      FROM logs l
      LEFT JOIN users u
        ON u.id = l.user_id
      ORDER BY l.created_at DESC
      LIMIT ?
    `,
    )
    .all(limit);
}

function deleteLogsOlderThan(days = 3) {
  const cutoff = getZonedDateTimeBeforeDays(days);

  return db
    .prepare(
      `
      DELETE FROM logs
      WHERE created_at < ?
    `,
    )
    .run(cutoff);
}

export { createLog, getLogs, deleteLogsOlderThan };
