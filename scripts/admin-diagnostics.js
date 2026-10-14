import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { listDatabaseBackups } from "../app/helpers/database-backup.helper.js";
import { root, configuration, openReadonly, backupOptions, checkIntegrity, checkCredentials, safeFailure } from "./admin-cli/common.js";

function httpStatus(port, endpoint) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: endpoint, headers: { "X-Forwarded-Proto": "https" }, timeout: 2000 }, (response) => {
      response.resume(); resolve(response.statusCode);
    });
    request.on("error", () => resolve("UNAVAILABLE"));
    request.on("timeout", () => { request.destroy(); resolve("UNAVAILABLE"); });
  });
}

let database;
try {
  if (process.argv.includes("--help")) {
    console.log("npm run admin:diagnostics\nMembaca konfigurasi, integritas database, kecocokan key, jumlah backup, dan endpoint live/ready loopback. Tidak menginisialisasi aplikasi.");
  } else {
    if (process.argv.length > 2) throw new Error("Argumen diagnostics tidak dikenali. Gunakan --help.");
    const config = configuration();
    console.log(`VERSION = ${JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version}`);
    console.log(`ENV_FILE = ${fs.existsSync(path.join(root, ".env")) ? "PRESENT" : "MISSING"}`);
    for (const key of ["APP_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "BASE_URL_PUSAKA", "APP_BASE_URL"]) {
      console.log(`${key} = ${config[key] ? "PRESENT" : "MISSING"}`);
      if (!config[key]) process.exitCode = 1;
    }
    for (const [key, fallback, valid] of [
      ["NODE_ENV", "production", (v) => ["production", "development", "test"].includes(v)],
      ["AUTO_START", "false", (v) => ["true", "false"].includes(v)],
      ["MAX_CONCURRENT", "2", (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5],
      ["DB_BACKUP_RETENTION_COUNT", "4", (v) => Number.isSafeInteger(Number(v)) && Number(v) >= 1],
    ]) {
      const status = valid(config[key] ?? fallback) ? (config[key] === undefined ? "DEFAULT" : "VALID") : "INVALID";
      console.log(`${key} = ${status}`);
      if (status === "INVALID") process.exitCode = 1;
    }
    database = openReadonly();
    checkIntegrity(database);
    console.log("DATABASE_INTEGRITY = OK");
    try { console.log(`CREDENTIAL_VAULT = ${checkCredentials(database, config) ? "READY" : "NO_USERS"}`); }
    catch { console.log("CREDENTIAL_VAULT = INVALID_OR_MISSING"); process.exitCode = 1; }
    const options = backupOptions(config, database);
    console.log(`TIMEZONE_ACTIVE = ${options.timezone}`);
    console.log(`BACKUP_FILES = ${listDatabaseBackups(options.directory).length}\nBACKUP_RETENTION = ${options.retentionCount}`);
    console.log(`BACKUP_LOCK = ${fs.existsSync(path.join(options.directory, ".snapshot-lock.tmp")) ? "PRESENT" : "NONE"}`);
    console.log(`RESTORE_LOCK = ${fs.existsSync(path.join(root, "database/.admin-restore-lock.tmp")) ? "PRESENT" : "NONE"}`);
    const port = Number(config.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Tidak dapat membaca runtime: PORT tidak valid.");
    console.log(`LIVE_HTTP = ${await httpStatus(port, "/api/system/live")}\nREADY_HTTP = ${await httpStatus(port, "/api/system/ready")}`);
    console.log("Ready 503 dapat terjadi saat scheduler/generator nonaktif. UNAVAILABLE dapat berarti aplikasi sedang berhenti.");
  }
} catch (error) { safeFailure(error); }
finally { database?.close(); }
