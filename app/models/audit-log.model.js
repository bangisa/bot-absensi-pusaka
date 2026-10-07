import db from '../../database/db.js';
import { getZonedDateTimeBeforeDays, nowSQL } from '../helpers/time.helper.js';
import { redactSensitive } from '../helpers/redact.helper.js';

function createAuditLog(data) {
  const metadata = redactSensitive(data.metadata || {});

  return db.prepare(`
    INSERT INTO audit_logs
      (action, actor, target_type, target_id, status, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.action,
    data.actor || 'local',
    data.target_type || null,
    data.target_id != null ? String(data.target_id) : null,
    data.status || 'success',
    JSON.stringify(metadata),
    nowSQL(),
  );
}

function getAuditLogs(limit = 100) {
  return db.prepare(`
    SELECT id, action, actor, target_type, target_id, status, metadata, created_at
    FROM audit_logs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit).map((row) => ({
    ...row,
    metadata: (() => {
      try { return JSON.parse(row.metadata || '{}'); } catch { return {}; }
    })(),
  }));
}

function deleteAuditLogsOlderThan(days = 90) {
  const cutoff = getZonedDateTimeBeforeDays(days);
  return db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff);
}

export { createAuditLog, deleteAuditLogsOlderThan, getAuditLogs };
