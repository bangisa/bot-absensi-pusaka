import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { decryptCredential, createCredentialLookup, loadCredentialKey, isEncryptedCredential } from "../../app/helpers/credential.helper.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const databasePath = path.join(root, "database/db.sqlite");

export function configuration() {
  const file = path.join(root, ".env");
  const values = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  return { ...values, ...process.env };
}

export function openReadonly(file = databasePath) {
  return new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 });
}

export function backupOptions(config, database) {
  let timezone = config.TZ || "Asia/Jakarta";
  const hasSettings = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'system_settings'").get();
  if (hasSettings) {
    const saved = database.prepare("SELECT key, value FROM system_settings WHERE key IN ('timezone', 'timezone_active')").all();
    timezone = saved.find((s) => s.key === "timezone_active")?.value ?? timezone;
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const retentionCount = config.DB_BACKUP_RETENTION_COUNT === undefined ? 4 : Number(config.DB_BACKUP_RETENTION_COUNT);
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) throw new Error("DB_BACKUP_RETENTION_COUNT tidak valid.");
  return {
    directory: path.resolve(root, config.DB_BACKUP_DIR || "backups/database"),
    retentionCount, timezone,
    timestamp: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

export function checkIntegrity(database) {
  const rows = database.pragma("integrity_check");
  if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") {
    throw new Error("Integritas database tidak valid; operasi dibatalkan.");
  }
}

export function checkSnapshot(database) {
  checkIntegrity(database);
  const required = {
    users: ["id", "username", "password", "username_hash", "nickname", "latitude", "longitude", "auto_login", "credential_version", "service_days_total", "service_days_used", "service_status", "service_started_at", "service_completed_at"],
    logs: ["id", "user_id", "nickname", "type", "status", "created_at"],
    daily_schedules: ["id", "user_id", "schedule_date", "type", "scheduled_time", "status", "attempt_count", "max_attempts", "next_retry_at"],
    audit_logs: ["action", "actor", "target_type", "target_id", "status", "metadata", "created_at"],
    system_settings: ["key", "value", "updated_at"],
    user_service_days: ["user_id", "service_date", "used_at"],
  };
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(database.pragma(`table_info(${table})`).map((c) => c.name));
    if (columns.some((c) => !actual.has(c))) throw new Error(`Schema snapshot tidak kompatibel pada tabel ${table}.`);
  }
  return database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
}

export function checkCredentials(database, config) {
  const users = database.prepare("SELECT username, password, username_hash FROM users").all();
  if (!users.length) return 0;
  let raw = config.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    const keyFile = path.join(root, ".secrets/credential.key");
    if (!fs.existsSync(keyFile)) throw new Error("Credential key yang sesuai belum tersedia.");
    raw = fs.readFileSync(keyFile, "utf8").trim();
  }
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  // Supplying the existing key explicitly prevents the vault from generating a new file.
  process.env.CREDENTIAL_ENCRYPTION_KEY = raw;
  try {
    loadCredentialKey();
    for (const user of users) {
      if (!isEncryptedCredential(user.username) || !isEncryptedCredential(user.password)) throw new Error("Not encrypted");
      const username = decryptCredential(user.username);
      decryptCredential(user.password);
      if (createCredentialLookup(username) !== user.username_hash) throw new Error("Lookup mismatch");
    }
  } catch {
    throw new Error("Credential snapshot tidak terenkripsi, rusak, atau tidak cocok dengan key instalasi ini.");
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
  return users.length;
}

export function safeFailure(error) {
  // Only deliberate operational messages are printed; never SQLite rows or raw exception details.
  const known = /^(Retention |Timestamp |Backup lain |Backup database |DB_BACKUP_|Integritas |Schema |Credential |Format credential |Restore |Aplikasi |Platform |Tidak |File |Konfirmasi |Argumen |Database aktif |Lock restore |Rollback )/;
  console.error(known.test(error.message) ? error.message : `Operasi gagal (${error.code || error.name || "ERROR"}). Periksa akses file dan konfigurasi server.`);
  process.exitCode = 1;
}

export function acquireRestoreLock() {
  const file = path.join(root, "database/.admin-restore-lock.tmp");
  let fd;
  try {
    fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, String(process.pid));
  } catch (error) {
    if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(file); }
    if (error.code === "EEXIST") throw new Error("Lock restore masih ada; pastikan proses sebelumnya berhenti sebelum membersihkannya.");
    throw error;
  }
  return () => { fs.closeSync(fd); fs.unlinkSync(file); };
}

export async function assertApplicationStopped(config) {
  let found = false;
  if (process.platform === "linux") {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
      let args, cwd;
      try {
        args = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0").filter(Boolean);
        if (args.join(" ").includes(path.join(root, "index.js"))) { found = true; continue; }
        if (!/^node(?:js)?$/.test(path.basename(args[0] || ""))) continue;
        cwd = fs.realpathSync(`/proc/${entry}/cwd`);
      } catch (error) {
        if (args?.some((a) => a.endsWith("index.js")) && error.code === "EACCES") {
          throw new Error("Tidak dapat memastikan proses aplikasi berhenti; gunakan akun admin server yang sesuai.");
        }
        continue;
      }
      if (args.slice(1).some((arg) => path.resolve(cwd, arg) === path.join(root, "index.js")) ||
          (cwd === fs.realpathSync(root) && args.some((arg) => /ProcessContainer(?:Fork)?\.js$/.test(arg)))) found = true;
    }
  } else if (process.platform === "win32") {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true });
    const processes = JSON.parse(output.trim() || "[]");
    found = [].concat(processes).some((p) => {
      if (p.ProcessId === process.pid) return false;
      const command = p.CommandLine || "";
      const match = command.match(/(?:^|\s)(?:"([^"]*index\.js)"|'([^']*index\.js)'|(\S*index\.js))(?=\s|$)/i);
      if (match) {
        const script = match[1] || match[2] || match[3];
        if (!path.win32.isAbsolute(script)) {
          throw new Error("Tidak dapat menentukan direktori proses index.js; hentikan proses tersebut sebelum restore.");
        }
        return path.resolve(script).toLowerCase() === path.join(root, "index.js").toLowerCase();
      }
      return /ProcessContainer(?:Fork)?\.js/i.test(command);
    });
  } else {
    throw new Error("Platform restore belum didukung; gunakan admin server pada Linux atau Windows.");
  }
  if (found) throw new Error("Aplikasi masih berjalan. Stop PM2/aplikasi terlebih dahulu.");
  const port = Number(config.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Tidak dapat memeriksa aplikasi: PORT tidak valid.");
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(2000);
    socket.on("connect", () => { socket.destroy(); reject(new Error("Aplikasi atau layanan pada PORT masih aktif. Restore dibatalkan.")); });
    socket.on("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else reject(new Error("Tidak dapat memastikan port aplikasi sudah berhenti."));
    });
    socket.on("timeout", () => { socket.destroy(); reject(new Error("Tidak dapat memastikan port aplikasi sudah berhenti.")); });
  });
}
