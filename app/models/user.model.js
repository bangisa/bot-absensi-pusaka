const db = require("../../database/db");
// const bcrypt = require("bcrypt");

// 🔍 VALIDASI
function validateUser(data) {
  if (!data.username || !data.password) {
    throw new Error("Username & password wajib");
  }

  if (data.latitude == null || data.longitude == null) {
    throw new Error("Lokasi wajib");
  }

  if (!data.masuk || !data.pulang || !data.jumat || !data.sabtu) {
    throw new Error("Jam wajib diisi");
  }
}

// 📥 GET ALL
function getAllUsers() {
  return db.prepare("SELECT * FROM users").all();
}

// 📥 GET BY ID
function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// ➕ CREATE
function createUser(data) {
  validateUser(data);

  // const hashed = bcrypt.hashSync(data.password, 10);

  return db
    .prepare(
      `
    INSERT INTO users 
    (username, password, latitude, longitude, masuk, pulang, jumat, sabtu, auto_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      data.username,
      data.password,
      data.latitude,
      data.longitude,
      data.masuk,
      data.pulang,
      data.jumat,
      data.sabtu,
      data.auto_login ?? 1,
    );
}

// ➕ BULK CREATE
function bulkCreate(req, res) {
  const users = req.body;

  if (!Array.isArray(users)) {
    return res.status(400).json({ error: "Body harus array" });
  }

  const insert = db.prepare(`
    INSERT INTO users 
    (username, password, latitude, longitude, masuk, pulang, jumat, sabtu, auto_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((users) => {
    for (const user of users) {
      insert.run(
        user.username,
        user.password,
        user.latitude,
        user.longitude,
        user.masuk,
        user.pulang,
        user.jumat,
        user.sabtu,
        user.auto_login ?? 1,
      );
    }
  });

  try {
    transaction(users);

    res.json({
      message: "Bulk insert berhasil",
      total: users.length,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}

// ✏️ UPDATE
function updateUser(id, data) {
  return db
    .prepare(
      `
    UPDATE users SET
      latitude = ?,
      longitude = ?,
      masuk = ?,
      pulang = ?,
      jumat = ?,
      sabtu = ?,
      auto_login = ?
    WHERE id = ?
  `,
    )
    .run(
      data.latitude,
      data.longitude,
      data.masuk,
      data.pulang,
      data.jumat,
      data.sabtu,
      data.auto_login ?? 1,
      id,
    );
}

// ❌ DELETE
function deleteUser(id) {
  return db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

module.exports = {
  getAllUsers,
  getUserById,
  bulkCreate,
  createUser,
  updateUser,
  deleteUser,
};
