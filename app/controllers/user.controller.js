const { createUser, getAllUsers, deleteUser } = require("../models/user.model");

function getAll(req, res) {
  const users = getAllUsers();
  res.json(users);
}

function create(req, res) {
  try {
    const data = req.body;

    const result = createUser(data);

    res.json({
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

  res.json({
    message: "Bulk insert selesai",
    success,
    failed,
  });
}

function remove(req, res) {
  deleteUser(req.params.id);
  res.json({ message: "deleted" });
}

module.exports = {
  create,
  getAll,
  bulkCreate,
  remove,
};
