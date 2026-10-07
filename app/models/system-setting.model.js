import db from "../../database/db.js";
import { nowSQL } from "../helpers/time.helper.js";

function getSystemSetting(key) {
  const row = db
    .prepare(
      `
      SELECT key, value, updated_at
      FROM system_settings
      WHERE key = ?
      `,
    )
    .get(key);

  return row ?? null;
}

function setSystemSetting(key, value) {
  const updatedAt = nowSQL();

  db.prepare(
    `
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    `,
  ).run(key, String(value), updatedAt);

  return {
    key,
    value: String(value),
    updated_at: updatedAt,
  };
}

function deleteSystemSetting(key) {
  return db.prepare("DELETE FROM system_settings WHERE key = ?").run(key);
}

export { deleteSystemSetting, getSystemSetting, setSystemSetting };
