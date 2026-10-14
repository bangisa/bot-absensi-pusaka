import path from "node:path";
import fs from "node:fs";
import { createDatabaseSnapshot } from "../app/helpers/database-backup.helper.js";
import { root, databasePath, configuration, openReadonly, backupOptions, safeFailure } from "./admin-cli/common.js";

let database;
try {
  if (process.argv.includes("--help")) {
    console.log("npm run admin:backup\nMembuat snapshot saat aplikasi aktif atau berhenti. Mengikuti folder/retention .env; backup manual tetap tersedia walau jadwal backup disabled.");
  } else {
    if (process.argv.length > 2) throw new Error("Argumen backup tidak dikenali. Gunakan --help.");
    const assertNotRestoring = () => {
      if (fs.existsSync(path.join(root, "database/.admin-restore-lock.tmp"))) throw new Error("Restore sedang berlangsung; backup dibatalkan.");
    };
    assertNotRestoring();
    database = openReadonly(databasePath);
    const result = await createDatabaseSnapshot(database, {
      ...backupOptions(configuration(), database), beforeSnapshot: assertNotRestoring,
    });
    console.log(`Backup berhasil: ${path.relative(root, result.file)}\nUkuran: ${result.sizeBytes} byte\nArsip lama dihapus sesuai retention: ${result.oldBackupsDeleted}\nSnapshot hanya berisi database; simpan .env dan key secara privat untuk restore.`);
  }
} catch (error) { safeFailure(error); }
finally { database?.close(); }
