import db from "../../database/db.js";
import { nowSQL } from "../helpers/time.helper.js";

export function canUseServiceDay(userId, date) {
  const user = db.prepare("SELECT service_days_total, service_days_used FROM users WHERE id = ?").get(userId);
  if (!user) return false;
  return user.service_days_total === null || user.service_days_used < user.service_days_total ||
    Boolean(db.prepare("SELECT 1 FROM user_service_days WHERE user_id = ? AND service_date = ?").get(userId, date));
}

export function consumeServiceDay(userId, date) {
  return db.transaction(() => {
    if (!canUseServiceDay(userId, date)) return false;
    const now = nowSQL();
    const inserted = db.prepare("INSERT OR IGNORE INTO user_service_days (user_id, service_date, used_at) VALUES (?, ?, ?)").run(userId, date, now);
    if (inserted.changes) {
      db.prepare(`UPDATE users SET service_days_used = service_days_used + 1,
        service_started_at = COALESCE(service_started_at, ?),
        service_status = CASE WHEN service_days_total IS NOT NULL AND service_days_used + 1 >= service_days_total THEN 'completed' ELSE 'active' END,
        service_completed_at = CASE WHEN service_days_total IS NOT NULL AND service_days_used + 1 >= service_days_total THEN ? ELSE NULL END
        WHERE id = ?`).run(now, now, userId);
    }
    return true;
  })();
}
