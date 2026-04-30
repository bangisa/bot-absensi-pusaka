const { createUser, getAllUsers, deleteUser } = require("../models/user.model");
const { restartScheduler } = require("../services/scheduler.service");

function getAll(req, res) {
  const users = getAllUsers();
  res.json(users);
}

function create(req, res) {
  try {
    const data = req.body;

    const result = createUser(data);
    restartScheduler();

    res.json({
      success: true,
      message: "User berhasil ditambahkan",
      id: result.lastInsertRowid,
    });
  } catch (err) {
    res.status(400).json({
      error: err.message,
    });
  }
}

function bulkCreate(req, res) {
  const users = req.body;

  if (!Array.isArray(users)) {
    return res.status(400).json({
      error: "Body harus array",
    });
  }

  let success = 0;
  let failed = [];

  users.forEach((user, index) => {
    try {
      createUser(user);
      success++;
    } catch (err) {
      failed.push({
        index,
        error: err.message,
      });
    }
  });

  restartScheduler();
  res.json({
    message: "Bulk insert selesai",
    success,
    failed,
  });
}

function update(req, res) {
  updateUser(req.params.id, req.body);

  restartScheduler();

  res.json({ success: true, message: "User berhasil diupdate" });
}

function remove(req, res) {
  deleteUser(req.params.id);
  restartScheduler();
  res.json({ success: true, message: "User berhasil dihapus" });
}

module.exports = {
  create,
  getAll,
  bulkCreate,
  update,
  remove,
};
