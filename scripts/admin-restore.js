import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Database from "better-sqlite3";
import {
  root, databasePath, configuration, openReadonly, checkSnapshot,
  checkCredentials, assertApplicationStopped, acquireRestoreLock, safeFailure,
} from "./admin-cli/common.js";

async function restore(args) {
  if (args.includes("--help")) {
    console.log('npm run admin:restore -- "path/snapshot.sqlite"\nUntuk terminal noninteraktif: tambahkan --confirm RESTORE.\nAplikasi wajib berhenti. Snapshot harus memakai schema v2.2 dan credential key instalasi yang sesuai. Data aktif disimpan untuk rollback; cookies lama diarsipkan agar login ulang. Tidak menyalakan aplikasi setelah restore.');
    return;
  }
  if (![1, 3].includes(args.length) || args[0].startsWith("--") ||
      (args.length === 3 && (args[1] !== "--confirm" || args[2] !== "RESTORE"))) {
    throw new Error('Argumen restore tidak valid. Gunakan --help.');
  }
  const config = configuration();
  const source = fs.realpathSync(path.resolve(args[0]));
  if (!fs.statSync(source).isFile()) throw new Error("File snapshot harus file SQLite biasa.");
  if (source === databasePath || (fs.existsSync(databasePath) && source === fs.realpathSync(databasePath))) {
    throw new Error("Restore tidak boleh memakai database aktif sebagai sumber.");
  }
  if (fs.existsSync(databasePath) && fs.lstatSync(databasePath).isSymbolicLink()) {
    throw new Error("Database aktif berupa symlink; restore memerlukan penanganan admin server.");
  }
  await assertApplicationStopped(config);
  const unlock = acquireRestoreLock();
  const staged = path.join(root, `database/.restore-${crypto.randomUUID()}.tmp`);
  const moved = [];
  let rollbackDirectory;
  let installed = false;
  try {
    const backupLock = path.join(path.resolve(root, config.DB_BACKUP_DIR || "backups/database"), ".snapshot-lock.tmp");
    if (fs.existsSync(backupLock)) throw new Error("Backup lain atau lock backup belum selesai; restore dibatalkan.");
    let snapshot;
    try {
      snapshot = openReadonly(source);
      await snapshot.backup(staged);
    } finally { snapshot?.close(); }
    fs.chmodSync(staged, 0o600);
    let candidate;
    let userCount;
    try {
      candidate = new Database(staged, { fileMustExist: true });
      candidate.pragma("journal_mode = DELETE");
      userCount = checkSnapshot(candidate);
      checkCredentials(candidate, config);
    } finally { candidate?.close(); }
    console.log(`Snapshot siap: ${userCount} user. User, jadwal, kuota, log, dan pengaturan akan kembali ke waktu snapshot.`);
    console.log("Riwayat pada server Pusaka tidak ikut di-rollback. Cookies lokal akan diarsipkan untuk login ulang.");
    if (args.length === 1) {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("Konfirmasi interaktif tidak tersedia. Gunakan --confirm RESTORE setelah memeriksa snapshot.");
      const prompt = readline.createInterface({ input: stdin, output: stdout });
      let answer;
      try { answer = await prompt.question("Ketik RESTORE untuk melanjutkan: "); }
      finally { prompt.close(); }
      if (answer !== "RESTORE") throw new Error("Konfirmasi tidak cocok; restore dibatalkan.");
    }
    await assertApplicationStopped(config);
    const rollbackRoot = path.join(root, "backups/restore");
    fs.mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 });
    rollbackDirectory = fs.mkdtempSync(path.join(rollbackRoot, "restore-"));
    fs.chmodSync(rollbackDirectory, 0o700);
    const manifest = {
      createdAt: new Date().toISOString(),
      projectVersion: JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
      files: [], completed: false,
    };
    const manifestPath = path.join(rollbackDirectory, "manifest.json");
    const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    saveManifest();
    // Preserve SQLite and its sidecars as a set; never pair a restored DB with old WAL files.
    for (const file of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, path.join(root, "cookies")]) {
      if (!fs.existsSync(file)) continue;
      const destination = path.join(rollbackDirectory, path.basename(file));
      fs.renameSync(file, destination);
      moved.push({ file, destination });
      manifest.files.push(path.relative(root, file));
      saveManifest();
    }
    fs.renameSync(staged, databasePath);
    installed = true;
    manifest.completed = true;
    saveManifest();
    console.log(`Restore selesai. Rollback: ${path.relative(root, rollbackDirectory)}\n.env dan credential key dipertahankan. Aplikasi tetap berhenti; start PM2 secara manual ketika siap.`);
  } catch (error) {
    if (installed) {
      try { fs.renameSync(databasePath, staged); installed = false; }
      catch { throw new Error(`Rollback otomatis tidak selesai. Aplikasi harus tetap berhenti; hubungi admin server. Arsip: ${path.relative(root, rollbackDirectory)}`); }
    }
    for (const entry of moved.reverse()) {
      try { fs.renameSync(entry.destination, entry.file); }
      catch { throw new Error(`Rollback otomatis tidak selesai. Aplikasi harus tetap berhenti; hubungi admin server. Arsip: ${path.relative(root, rollbackDirectory)}`); }
    }
    throw error;
  } finally {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(staged + suffix)) fs.unlinkSync(staged + suffix);
      }
    }
    finally { unlock(); }
  }
}

try { await restore(process.argv.slice(2)); }
catch (error) { safeFailure(error); }
