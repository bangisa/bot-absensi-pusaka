import db from "../../database/db.js";
import { geoConfig } from "../config/index.js";
import {
  createCredentialLookup,
  encryptCredential,
  hydrateUserCredentials,
  maskUsername,
} from "../helpers/index.js";
import { validateUser, validateUserInput } from "../validators/user.validator.js";
import { nowSQL } from "../helpers/time.helper.js";
import { createAuditLog } from "./audit-log.model.js";
import { isUserOperationActive } from "../services/user-operation.service.js";

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
        service_days_total, service_days_used, service_status,
        service_started_at, service_completed_at,
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
      service_days_total: row.service_days_total,
      service_days_used: row.service_days_used,
      service_days_remaining: row.service_days_total === null ? null : Math.max(0, row.service_days_total - row.service_days_used),
      service_status: row.service_status,
      service_started_at: row.service_started_at,
      service_completed_at: row.service_completed_at,
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
      data.latitude ?? geoConfig.defaultLat,
      data.longitude ?? geoConfig.defaultLng,
      data.auto_login ?? 1,
    );
}

// ✏️ UPDATE
function updateUser(id, data) {
  data = validateUserInput(data, { partial: true });
  if (isUserOperationActive(id)) throw Object.assign(new Error("User sedang diproses."), { status: 409 });
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id);

  if (!current) {
    throw Object.assign(new Error("User tidak ditemukan"), { status: 404 });
  }

  const changes = {};
  for (const key of ["nickname", "latitude", "longitude", "service_days_total"]) {
    if (key in data && data[key] !== current[key]) changes[key] = data[key];
  }
  if (data.username || data.password) {
    const plain = hydrateUserCredentials(current);
    if (data.username && data.username !== plain.username) {
      changes.username = encryptCredential(data.username);
      changes.username_hash = createCredentialLookup(data.username);
    }
    if (data.password && data.password !== plain.password) changes.password = encryptCredential(data.password);
  }
  const credentialsChanged = Boolean(changes.username || changes.password);
  if (credentialsChanged) changes.credential_version = current.credential_version + 1;
  if ("service_days_total" in changes) {
    const completed = changes.service_days_total !== null && current.service_days_used >= changes.service_days_total;
    changes.service_status = completed ? "completed" : "active";
    changes.service_completed_at = completed ? current.service_completed_at || nowSQL() : null;
  }
  const keys = Object.keys(changes);
  return db.transaction(() => {
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map(key => `${key} = ?`).join(", ")} WHERE id = ?`).run(...keys.map(key => changes[key]), id);
      createAuditLog({ action: "user.update", actor: "admin", target_type: "user", target_id: id,
        metadata: { fields: keys.filter(key => !["username_hash", "credential_version"].includes(key)), credentialsChanged } });
      if ("service_days_total" in changes) createAuditLog({ action: "user.plan_changed", actor: "admin", target_type: "user", target_id: id,
        metadata: { oldPlan: current.service_days_total, newPlan: changes.service_days_total, used: current.service_days_used } });
    }
    return { changes: keys.length ? 1 : 0, credentialsChanged };
  })();
}

function createManagedUser(input) {
  const data = validateUserInput(input);
  return db.transaction(() => {
    const result = insertUser(data);
    if (!result.changes) throw new Error("Username sudah digunakan.");
    db.prepare("UPDATE users SET service_days_total = ? WHERE id = ?").run(data.service_days_total ?? null, result.lastInsertRowid);
    createAuditLog({ action: "user.create", actor: "admin", target_type: "user", target_id: result.lastInsertRowid });
    createAuditLog({ action: "user.plan_changed", actor: "admin", target_type: "user", target_id: result.lastInsertRowid,
      metadata: { oldPlan: null, newPlan: data.service_days_total ?? null, used: 0 } });
    return result;
  })();
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
  createManagedUser,
  findAllUsers,
  findAllPublicUsers,
  findPublicUserById,
  findUserById,
  insertUser,
  updateUser,
  removeUser,
  insertUsers,
};
