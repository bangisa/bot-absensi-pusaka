import Database from "better-sqlite3";
import {
  createCredentialLookup,
  decryptCredential,
  encryptCredential,
  maskUsername,
  resolvePath,
} from "../app/helpers/index.js";

const path = resolvePath(import.meta.url);

const dbPath = path.resolve("db.sqlite");

console.log("📁 DB PATH:", dbPath);

let db;

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();

  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.prepare(
      `ALTER TABLE ${tableName}
       ADD COLUMN ${columnName} ${definition}`,
    ).run();

    console.log(`[DB] Kolom ${tableName}.${columnName} ditambahkan`);
  }
}


function migrateUserCredentials() {
  const users = db
    .prepare(
      `
      SELECT id, username, username_hash, password
      FROM users
      `,
    )
    .all();

  const updateUser = db.prepare(
    `
    UPDATE users
    SET username = ?, username_hash = ?, password = ?
    WHERE id = ?
    `,
  );

  const logs = db
    .prepare(
      `
      SELECT id, username
      FROM logs
      WHERE username IS NOT NULL
      `,
    )
    .all();

  const updateLogUsername = db.prepare(
    `
    UPDATE logs
    SET username = ?
    WHERE id = ?
    `,
  );

  db.transaction(() => {
    for (const user of users) {
      const plainUsername = decryptCredential(user.username);
      const plainPassword = decryptCredential(user.password);

      updateUser.run(
        encryptCredential(plainUsername),
        createCredentialLookup(plainUsername),
        encryptCredential(plainPassword),
        user.id,
      );
    }

    for (const log of logs) {
      updateLogUsername.run(maskUsername(log.username), log.id);
    }
  })();

  if (users.length > 0) {
    console.log(`[SECURITY] ${users.length} credential user diverifikasi/terenkripsi`);
  }
}

function migrateUsersScheduleColumns() {
  const columns = db.prepare("PRAGMA table_info(users)").all();

  const obsoleteColumns = new Set(["masuk", "pulang", "jumat", "sabtu"]);
  const hasObsoleteColumns = columns.some((column) =>
    obsoleteColumns.has(column.name),
  );
  const nicknameExpression = columns.some((column) => column.name === "nickname")
    ? "nickname"
    : "NULL";

  if (!hasObsoleteColumns) {
    return;
  }

  db.pragma("foreign_keys = OFF");

  try {
    db.transaction(() => {
      db.prepare(
        `
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            nickname TEXT,
            password TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            auto_login INTEGER DEFAULT 1
          )
        `,
      ).run();

      db.prepare(
        `
          INSERT INTO users_new (
            id,
            username,
            nickname,
            password,
            latitude,
            longitude,
            auto_login
          )
          SELECT
            id,
            username,
            ${nicknameExpression},
            password,
            latitude,
            longitude,
            auto_login
          FROM users
        `,
      ).run();

      db.prepare("DROP TABLE users").run();
      db.prepare("ALTER TABLE users_new RENAME TO users").run();
    })();

    console.log("[DB] Kolom jadwal lama pada users dihapus");
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

try {
  db = new Database(dbPath);

  // Penting untuk penggunaan multi-user.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("auto_vacuum = FULL");
  db.pragma("busy_timeout = 5000");

  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        nickname TEXT,
        password TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        auto_login INTEGER DEFAULT 1
      )
    `,
  ).run();

  ensureColumn("users", "nickname", "TEXT");

  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        nickname TEXT,
        type TEXT,
        status TEXT CHECK(
          status IN ('success', 'failed', 'skipped')
        ),
        message TEXT,
        created_at TEXT,
        FOREIGN KEY (user_id)
          REFERENCES users(id)
      )
    `,
  ).run();

  ensureColumn("logs", "nickname", "TEXT");

  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  ).run();

  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        actor TEXT,
        target_type TEXT,
        target_id TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        metadata TEXT,
        created_at TEXT NOT NULL
      )
    `,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
     ON audit_logs(created_at)`,
  ).run();

  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS daily_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        schedule_date TEXT NOT NULL,
        type TEXT NOT NULL CHECK(
          type IN ('masuk', 'pulang')
        ),
        scheduled_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(
            status IN (
              'pending',
              'processing',
              'success',
              'failed',
              'skipped'
            )
          ),
        executed_at TEXT,
        message TEXT,

        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_retry_at TEXT,

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
          REFERENCES users(id)
          ON DELETE CASCADE,

        UNIQUE(user_id, schedule_date, type)
      )
    `,
  ).run();

  ensureColumn(
    "daily_schedules",
    "attempt_count",
    "INTEGER NOT NULL DEFAULT 0",
  );

  ensureColumn("daily_schedules", "max_attempts", "INTEGER NOT NULL DEFAULT 3");

  ensureColumn("daily_schedules", "next_retry_at", "TEXT");

  migrateUsersScheduleColumns();
  ensureColumn("users", "username_hash", "TEXT");
  migrateUserCredentials();

  db.prepare(
    `
      CREATE INDEX IF NOT EXISTS idx_logs_user
      ON logs(user_id)
    `,
  ).run();

  db.prepare(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_hash
      ON users(username_hash)
      WHERE username_hash IS NOT NULL
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

  db.prepare(
    `
      DROP INDEX IF EXISTS idx_daily_schedules_date_type
    `,
  ).run();

  db.prepare(
    `
      CREATE INDEX IF NOT EXISTS idx_daily_schedules_date_type
      ON daily_schedules(
        schedule_date,
        type,
        scheduled_time
      )
    `,
  ).run();

  db.prepare(
    `
      CREATE INDEX IF NOT EXISTS idx_daily_schedules_pending
      ON daily_schedules(
        schedule_date,
        status,
        scheduled_time
      )
    `,
  ).run();

  db.prepare(
    `
      CREATE INDEX IF NOT EXISTS idx_daily_schedules_retry
      ON daily_schedules(
        schedule_date,
        status,
        next_retry_at,
        scheduled_time
      )
  `,
  ).run();
} catch (err) {
  console.error("❌ Gagal inisialisasi database:", err.message);

  process.exit(1);
}

function closeDatabase() {
  if (!db.open) {
    return false;
  }

  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (err) {
    console.log("[DB] WAL checkpoint warning:", err.message);
  }

  db.close();
  console.log("[DB] Database closed");
  return true;
}

export { closeDatabase };
export default db;
