import {
  insertUser,
  findAllUsers,
  updateUser,
  removeUser,
  insertUsers,
} from "../models/index.js";
import { restartScheduler } from "../services/index.js";

function findAll(req, res) {
  const users = findAllUsers();
  res.json(users);
}

function create(req, res) {
  try {
    const data = req.body;

    const result = insertUser(data);
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

function update(req, res) {
  updateUser(req.params.id, req.body);

  restartScheduler();

  res.json({ success: true, message: "User berhasil diupdate" });
}

function remove(req, res) {
  removeUser(req.params.id);
  restartScheduler();
  res.json({ success: true, message: "User berhasil dihapus" });
}

async function bulkCreate(req, res) {
  try {
    const result = insertUsers(req.body);

    restartScheduler();

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    res.status(400).json({
      error: err.message,
    });
  }
}

export default {
  create,
  findAll,
  bulkCreate,
  update,
  remove,
};
