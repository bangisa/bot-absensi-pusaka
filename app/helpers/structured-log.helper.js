import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.config.js';
import { getZonedDate, nowSQL } from './time.helper.js';
import { redactSensitive } from './redact.helper.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = String(env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LEVELS[configuredLevel] ?? LEVELS.info;
const logDir = path.resolve(process.cwd(), env.STRUCTURED_LOG_DIR || 'logs');

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function getRuntimeLogPath(date = new Date()) {
  return path.join(logDir, `runtime-${getZonedDate(date)}.jsonl`);
}

function shouldWrite(level) {
  return (LEVELS[level] ?? LEVELS.info) >= minLevel;
}

function writeStructured(level, event, message, context = {}) {
  if (!shouldWrite(level)) return null;

  const entry = redactSensitive({
    timestamp: nowSQL(),
    level,
    event,
    message,
    ...context,
  });

  ensureLogDir();
  fs.appendFileSync(getRuntimeLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');

  const concise = `[${level.toUpperCase()}] ${event}: ${entry.message}`;
  if (level === 'error') console.error(concise);
  else if (level === 'warn') console.warn(concise);
  else console.log(concise);

  return entry;
}

function cleanupStructuredLogs(retentionDays = env.STRUCTURED_LOG_RETENTION_DAYS) {
  ensureLogDir();
  const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const name of fs.readdirSync(logDir)) {
    if (!/^runtime-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
    const fullPath = path.join(logDir, name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(fullPath);
      deleted += 1;
    }
  }

  return deleted;
}

const logger = {
  debug: (event, message, context) => writeStructured('debug', event, message, context),
  info: (event, message, context) => writeStructured('info', event, message, context),
  warn: (event, message, context) => writeStructured('warn', event, message, context),
  error: (event, message, context) => writeStructured('error', event, message, context),
};

export { cleanupStructuredLogs, getRuntimeLogPath, logger, writeStructured };
