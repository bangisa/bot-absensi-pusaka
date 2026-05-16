import db from "../../database/db.js";
import { nowSQL } from "../helpers/time.helper.js";

function createLog(data) {
  const created_at = nowSQL();

  return db
    .prepare(
      `
      INSERT INTO logs 
      (user_id, username, type, status, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      data.user_id,
      data.username,
      data.type,
      data.status,
      data.message,
      created_at,
    );
}

function getLogs(limit = 50) {
  return db
    .prepare(
      `
      SELECT * FROM logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `,
    )
    .all(limit);
}

export { createLog, getLogs };
