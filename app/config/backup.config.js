import { env } from "./env.config.js";

export const backupConfig = {
  enabled: env.DB_BACKUP_ENABLED,
  cron: env.DB_BACKUP_CRON,
  directory: env.DB_BACKUP_DIR,
  retentionCount: Math.max(1, env.DB_BACKUP_RETENTION_COUNT),
};
