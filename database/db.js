import Database from "better-sqlite3";
import { resolvePath } from "../app/helpers/index.js";

const path = resolvePath(import.meta.url);

const dbPath = path.resolve("db.sqlite");

console.log("📁 DB PATH:", dbPath);

let db;

try {
  db = new Database(dbPath);

  // 🔥 penting untuk multi-user
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("auto_vacuum = FULL");
  db.pragma("busy_timeout = 5000");

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      masuk TEXT NOT NULL,
      pulang TEXT NOT NULL,
      jumat TEXT NOT NULL,
      sabtu TEXT NOT NULL,
      auto_login INTEGER DEFAULT 1
    )
  `,
  ).run();

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      type TEXT,
      status TEXT CHECK(status IN ('success','failed','skipped')),
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `,
  ).run();

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS idx_logs_user 
    ON logs(user_id)
  `,
  ).run();

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS idx_users_username 
    ON users(username)
  `,
  ).run();

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS idx_logs_created_at
    ON logs(created_at DESC)
  `,
  ).run();
} catch (err) {
  console.error("❌ Gagal inisialisasi database:", err.message);
  process.exit(1);
}

export default db;
