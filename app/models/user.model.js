import db from "../../database/db.js";
import { geoConfig } from "../config/index.js";
import { validateUser } from "../validators/user.validator.js";
// const bcrypt = require("bcrypt");

// 📥 GET ALL
function findAllUsers() {
  return db.prepare("SELECT * FROM users").all();
}

// 📥 GET BY ID
function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// ➕ CREATE
function insertUser(data) {
  validateUser(data);

  // const hashed = bcrypt.hashSync(data.password, 10);

  return db
    .prepare(
      `
    INSERT OR IGNORE INTO users 
    (username, nickname, password, latitude, longitude, auto_login)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      data.username,
      data.nickname || null,
      data.password,
      data.latitude || geoConfig.defaultLat,
      data.longitude || geoConfig.defaultLng,
      data.auto_login ?? 1,
    );
}

// ✏️ UPDATE
function updateUser(id, data) {
  return db
    .prepare(
      `
    UPDATE users SET
      nickname = ?,
      password = ?,
      latitude = ?,
      longitude = ?,
      auto_login = ?
    WHERE id = ?
  `,
    )
    .run(
      data.nickname || null,
      data.password,
      data.latitude || geoConfig.defaultLat,
      data.longitude || geoConfig.defaultLng,
      data.auto_login ?? 1,
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
    (username, nickname, password, latitude, longitude, auto_login)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((users) => {
    for (const user of users) {
      insert.run(
        user.username,
        user.nickname || null,
        user.password,
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
  findUserById,
  insertUser,
  updateUser,
  removeUser,
  insertUsers,
};
