const db = require("../../database/db");

function createLog(data) {
  return db
    .prepare(
      `
    INSERT INTO logs (user_id, type, status, message)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(data.user_id, data.type, data.status, data.message);
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

module.exports = {
  createLog,
  getLogs,
};
