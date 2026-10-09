import {
  findAllPublicUsers,
  removeUser,
  findPublicUserById,
  createAuditLog,
} from "../models/index.js";
import { logger } from "../helpers/index.js";
import { restartScheduler } from "../services/index.js";
import { createManagedUser, updateUser } from "../models/user.model.js";
import { clearCookies } from "../services/cookies.service.js";

function findAll(req, res) {
  res.json(findAllPublicUsers());
}

function create(req, res) {
  try {
    const data = req.body;

    const result = createManagedUser(data);
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

async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "ID user tidak valid." });
  try {
    const result = updateUser(id, req.body);
    // Persisted version invalidates even an old cookie file that cannot be deleted.
    if (result.credentialsChanged) await clearCookies(id);
    return res.json({ success: true, id });
  } catch (error) {
    const duplicate = error.code?.startsWith("SQLITE_CONSTRAINT");
    return res.status(duplicate ? 409 : error.status || 400).json({ error: duplicate ? "Username sudah digunakan." : error.message });
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
  update,
  create,
  findAll,
  remove,
};
