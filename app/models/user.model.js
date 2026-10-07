import db from "../../database/db.js";
import { geoConfig } from "../config/index.js";
import {
  createCredentialLookup,
  encryptCredential,
  hydrateUserCredentials,
  maskUsername,
} from "../helpers/index.js";
import { validateUser } from "../validators/user.validator.js";

// 📥 GET ALL
function findAllUsers() {
  return db
    .prepare("SELECT * FROM users")
    .all()
    .map(hydrateUserCredentials);
}

// 📤 PUBLIC LIST FOR ADMIN UI
// Deliberately does not SELECT password or username_hash.
function findAllPublicUsers() {
  return db
    .prepare(
      `
      SELECT
        id,
        nickname,
        username,
        latitude,
        longitude,
        auto_login,
        CASE
          WHEN username IS NOT NULL AND username <> ''
           AND password IS NOT NULL AND password <> ''
          THEN 1 ELSE 0
        END AS credential_configured
      FROM users
      ORDER BY id ASC
    `,
    )
    .all()
    .map((row) => ({
      id: row.id,
      nickname: row.nickname,
      usernameMasked: maskUsername(row.username),
      credentialConfigured: Boolean(row.credential_configured),
      latitude: row.latitude,
      longitude: row.longitude,
      auto_login: row.auto_login,
    }));
}

// 📥 PUBLIC GET BY ID FOR ADMIN/AUDIT USE
// Password is intentionally never selected.
function findPublicUserById(id) {
  const row = db
    .prepare(
      `
      SELECT id, nickname, username, latitude, longitude, auto_login
      FROM users
      WHERE id = ?
    `,
    )
    .get(id);

  if (!row) return null;

  return {
    id: row.id,
    nickname: row.nickname,
    usernameMasked: maskUsername(row.username),
    latitude: row.latitude,
    longitude: row.longitude,
    auto_login: row.auto_login,
  };
}

// 📥 GET BY ID
function findUserById(id) {
  return hydrateUserCredentials(
    db.prepare("SELECT * FROM users WHERE id = ?").get(id),
  );
}

// ➕ CREATE
function insertUser(data) {
  validateUser(data);

  const username = String(data.username).trim();
  const encryptedUsername = encryptCredential(username);
  const encryptedPassword = encryptCredential(data.password);
  const usernameHash = createCredentialLookup(username);

  return db
    .prepare(
      `
    INSERT OR IGNORE INTO users
    (username, username_hash, nickname, password, latitude, longitude, auto_login)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      encryptedUsername,
      usernameHash,
      data.nickname || null,
      encryptedPassword,
      data.latitude || geoConfig.defaultLat,
      data.longitude || geoConfig.defaultLng,
      data.auto_login ?? 1,
    );
}

// ✏️ UPDATE
function updateUser(id, data) {
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id);

  if (!current) {
    throw new Error("User tidak ditemukan");
  }

  const currentHydrated = hydrateUserCredentials(current);
  const username = String(data.username ?? currentHydrated.username).trim();
  const password = data.password || currentHydrated.password;

  return db
    .prepare(
      `
    UPDATE users SET
      username = ?,
      username_hash = ?,
      nickname = ?,
      password = ?,
      latitude = ?,
      longitude = ?,
      auto_login = ?
    WHERE id = ?
  `,
    )
    .run(
      encryptCredential(username),
      createCredentialLookup(username),
      data.nickname ?? current.nickname ?? null,
      encryptCredential(password),
      data.latitude || current.latitude || geoConfig.defaultLat,
      data.longitude || current.longitude || geoConfig.defaultLng,
      data.auto_login ?? current.auto_login ?? 1,
      id,
    );
}

// ❌ DELETE
function removeUser(id) {
  db.prepare(
    `
    DELETE FROM logs
    WHERE user_id = ?
  `,
  ).run(id);

  db.prepare(
    `
    DELETE FROM daily_schedules
    WHERE user_id = ?
  `,
  ).run(id);

  return db
    .prepare(
      `
    DELETE FROM users
    WHERE id = ?
  `,
    )
    .run(id);
}

// ➕ BULK CREATE
function insertUsers(users) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users
    (username, username_hash, nickname, password, latitude, longitude, auto_login)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((items) => {
    for (const user of items) {
      validateUser(user);

      const username = String(user.username).trim();

      insert.run(
        encryptCredential(username),
        createCredentialLookup(username),
        user.nickname || null,
        encryptCredential(user.password),
        user.latitude || geoConfig.defaultLat,
        user.longitude || geoConfig.defaultLng,
        user.auto_login ?? 1,
      );
    }
  });

  transaction(users);

  return {
    total: users.length,
  };
}

export {
  findAllUsers,
  findAllPublicUsers,
  findPublicUserById,
  findUserById,
  insertUser,
  updateUser,
  removeUser,
  insertUsers,
};
