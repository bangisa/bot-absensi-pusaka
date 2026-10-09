import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://documentation.invalid';
const output = path.join(root, 'docs/screenshots');
const timestamp = '2026-10-09T09:00:00+07:00';
const users = [30, 7, null, 1].map((total, index) => ({
  id: index + 1, nickname: `Demo ${String.fromCharCode(65 + index)}`,
  usernameMasked: 'demo****', latitude: 0, longitude: 0, auto_login: 1,
  service_days_total: total, service_days_used: index === 3 ? 1 : 0,
  service_days_remaining: total === null ? null : total - (index === 3 ? 1 : 0),
  service_status: index === 3 ? 'completed' : 'active',
}));
const fixtures = {
  '/api/users': users,
  '/api/system/status': { running: true, totalJobs: 1 },
  '/api/system/health': {
    status: 'HEALTHY', timezone: 'Asia/Jakarta', uptimeSeconds: 3600,
    lifecycle: { state: 'RUNNING', shutdownRequested: false },
    checks: {
      scheduler: { status: 'HEALTHY', running: true, generator: { running: true }, lastTickAt: timestamp },
      queue: { status: 'HEALTHY', running: 0, pending: 0, maxConcurrent: 1 },
      browser: { status: 'HEALTHY', connected: false, activeContexts: 0, pageCount: 0 },
      databaseBackup: { status: 'HEALTHY', enabled: true, lastSuccessAt: timestamp, lastDurationMs: 120, retentionCount: 4 },
      holidayProvider: { status: 'HEALTHY', available: true, source: 'primary', isHoliday: false },
      database: { status: 'HEALTHY', latencyMs: 1 },
      credentialVault: { status: 'HEALTHY', keyAvailable: true },
      logging: { status: 'HEALTHY', writable: true },
      memory: { systemUsedPercent: 24, rssMb: 80 }, disk: { available: true, freeMb: 12000 },
      automation: { lastSuccessType: 'masuk', lastSuccessAt: timestamp, recentFailuresLast60Minutes: 0 },
    },
  },
  '/api/system/diagnostics': { dailySchedules: { success: 3, pending: 3, processing: 0, failed: 0, skipped: 0, retry: { waiting: 0 } } },
  '/api/system/audit-logs': [{ action: 'database.backup.completed', actor: 'demo-admin', status: 'success', created_at: timestamp }],
  '/api/system/settings/max-concurrent': { value: 1, source: 'runtime' },
  '/api/system/settings/holiday-calendar': { url: '', enabled: false },
  '/api/system/settings/timezone': { value: 'Asia/Jakarta', active: 'Asia/Jakarta', restartRequired: false },
  '/api/system/logs': ['success', 'skipped', 'failed'].map((status, index) => ({
    id: index + 1, nickname: users[index].nickname, type: 'masuk', status, created_at: timestamp,
    message: ['Presensi masuk berhasil (data demo)', 'Sudah presensi masuk (data demo)', 'Koneksi terputus (simulasi)'][index],
  })),
};
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const browser = await puppeteer.launch({ headless: true });
try {
  await fs.mkdir(output, { recursive: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.emulateTimezone('Asia/Jakarta');
  await page.evaluateOnNewDocument(value => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [value])); }
      static now() { return new NativeDate(value).getTime(); }
    };
  }, timestamp);
  // Serve repository frontend assets and dummy APIs without a server or real network.
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') return request.abort();
    if (Object.hasOwn(fixtures, url.pathname)) {
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures[url.pathname]) });
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(root, 'public', relative);
    if (!file.startsWith(path.join(root, 'public') + path.sep)) return request.abort();
    try {
      await request.respond({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) });
    } catch { await request.respond({ status: 404, body: 'Not found' }); }
  });
  for (const [route, name, ready] of [
    ['/', 'dashboard', '#refresh-status'],
    ['/users.html', 'users', '#users-list tr'],
    ['/logs.html', 'logs', '#logs tr'],
  ]) {
    await page.goto(origin + route, { waitUntil: 'networkidle0' });
    await page.waitForSelector(ready);
    if (name === 'dashboard') await page.waitForFunction(() => document.getElementById('refresh-status').textContent.startsWith('Terakhir diperbarui'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    if (name === 'users') {
      await page.click('#users-list .btn.secondary');
      await page.screenshot({ path: path.join(output, 'user-edit.png'), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Created 4 documentation screenshots using demo data only.');
} finally {
  await browser.close();
}
