import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export function listDatabaseBackups(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^db-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-[a-f0-9-]{36})?\.sqlite$/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function cleanupDatabaseBackups(directory, retentionCount) {
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) {
    throw new Error("Retention backup harus bilangan bulat positif.");
  }
  const obsolete = listDatabaseBackups(directory).slice(retentionCount);
  for (const file of obsolete) fs.unlinkSync(file.fullPath);
  return obsolete.length;
}

export async function createDatabaseSnapshot(database, { directory, retentionCount, timestamp, beforeSnapshot }) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
    throw new Error("Timestamp backup tidak valid.");
  }
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) {
    throw new Error("Retention backup harus bilangan bulat positif.");
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, ".snapshot-lock.tmp");
  let lock;
  try {
    lock = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(lock, String(process.pid));
  } catch (error) {
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); }
    if (error.code === "EEXIST") throw new Error("Backup lain atau lock backup belum selesai. Periksa proses sebelum membersihkan lock.");
    throw error;
  }
  const file = path.join(directory, `db-${timestamp.replace(/:/g, "-").replace(" ", "_")}-${randomUUID()}.sqlite`);
  try {
    beforeSnapshot?.();
    await database.backup(file);
    fs.chmodSync(file, 0o600);
    const sizeBytes = fs.statSync(file).size;
    if (!sizeBytes) throw new Error("Backup database kosong.");
    const snapshot = new Database(file, { fileMustExist: true });
    try {
      // The new snapshot is private to this operation; make it a standalone file without WAL sidecars.
      snapshot.pragma("journal_mode = DELETE");
      const rows = snapshot.pragma("integrity_check");
      if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") throw new Error("Integritas backup tidak valid.");
    } finally { snapshot.close(); }
    const oldBackupsDeleted = cleanupDatabaseBackups(directory, retentionCount);
    return { file, sizeBytes, oldBackupsDeleted };
  } catch (error) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix); } catch { /* Preserve the original error. */ }
    }
    throw error;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
