import {
  insertUser,
  findAllPublicUsers,
  removeUser,
  findPublicUserById,
  createAuditLog,
} from "../models/index.js";
import { logger } from "../helpers/index.js";
import { restartScheduler } from "../services/index.js";

function findAll(req, res) {
  res.json(findAllPublicUsers());
}

function create(req, res) {
  try {
    const data = req.body;

    const result = insertUser(data);
    restartScheduler();
    createAuditLog({
      action: "user.create",
      actor: "local-api",
      target_type: "user",
      target_id: result.lastInsertRowid,
      metadata: { nickname: data.nickname || null, username: data.username },
    });
    logger.info("audit.user_create", "User ditambahkan", { userId: result.lastInsertRowid });

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

function remove(req, res) {
  const existing = findPublicUserById(req.params.id);
  removeUser(req.params.id);
  restartScheduler();
  createAuditLog({
    action: "user.delete",
    actor: "local-api",
    target_type: "user",
    target_id: req.params.id,
    metadata: { nickname: existing?.nickname || null, username: existing?.usernameMasked || null },
  });
  res.json({ success: true, message: "User berhasil dihapus" });
}

export default {
  create,
  findAll,
  remove,
};
