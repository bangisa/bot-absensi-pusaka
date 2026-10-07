import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv.includes('--worker')) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pusaka-generator-recovery-'));
  for (const dir of ['app', 'scripts']) fs.cpSync(path.join(root, dir), path.join(sandbox, dir), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'database'));
  fs.copyFileSync(path.join(root, 'database/db.js'), path.join(sandbox, 'database/db.js'));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(sandbox, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, ['--import', './scripts/regression/hooks.mjs', './scripts/regression/generator-recovery.mjs', '--worker'], {
    cwd: sandbox, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NODE_ENV: 'production', TZ: 'Asia/Jakarta', AUTO_START: 'false',
      APP_SECRET: crypto.randomBytes(32).toString('hex'), BASE_URL_PUSAKA: 'https://pusaka.invalid', APP_BASE_URL: 'http://localhost:3000',
      ADMIN_USERNAME: 'dummy', ADMIN_PASSWORD_HASH: '$2b$12$dummy', CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
      STRUCTURED_LOG_DIR: 'logs', DB_BACKUP_ENABLED: 'false' },
  });
  fs.writeFileSync(path.join(sandbox, 'test-output.txt'), result.stdout + result.stderr);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  console.log(`Evidence: ${sandbox}`);
  process.exit(result.status ?? 1);
}

const RealDate = Date;
let clock = RealDate.parse('2026-10-01T00:01:00+07:00');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const at = value => { clock = RealDate.parse(value); };
const timers = [];
const nativeInterval = globalThis.setInterval;
const nativeClear = globalThis.clearInterval;
globalThis.setInterval = (callback, ms, ...args) => {
  if (ms !== 300000) return nativeInterval(callback, ms, ...args);
  const timer = { callback, active: true, unref() {} }; timers.push(timer); return timer;
};
globalThis.clearInterval = timer => {
  if (timers.includes(timer)) timer.active = false;
  else nativeClear(timer);
};
let calls = 0;
let holiday = async date => ({ available: true, isHoliday: false, date });
globalThis.__holiday = date => { calls++; return holiday(date); };
registerHooks({ load(url, context, next) {
  if (url.endsWith('/app/services/holiday.service.js')) return {
    format: 'module', shortCircuit: true,
    source: 'export async function checkNationalHoliday(date) { return globalThis.__holiday(date); }',
  };
  return next(url, context);
} });

const g = await import('../../app/services/daily-schedule-generator.service.js');
const { default: db, closeDatabase } = await import('../../database/db.js');
const { insertUser } = await import('../../app/models/user.model.js');
const addUser = name => insertUser({ username: name, nickname: name, password: 'DummyOnly', latitude: 0, longitude: 0, auto_login: 1 });
const rows = date => db.prepare('SELECT * FROM daily_schedules WHERE schedule_date=? ORDER BY id').all(date);
const activeTimer = () => timers.findLast(t => t.active);
async function idle() {
  for (let i = 0; i < 100 && g.getDailyScheduleGeneratorStatus().generationRunning; i++) await new Promise(r => setImmediate(r));
  assert.equal(g.getDailyScheduleGeneratorStatus().generationRunning, false);
}
async function tick() { activeTimer().callback(); await idle(); }
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

try {
  addUser('one');
  await test('startup and concurrent starts register one cron and one interval', async () => {
    await Promise.all([g.startDailyScheduleGenerator(), g.startDailyScheduleGenerator()]);
    assert.equal(rows('2026-10-01').length, 2);
    assert.equal(timers.filter(t => t.active).length, 1);
    assert.equal(globalThis.__regression.jobs.filter(j => !j.stopped).length, 1);
  });
  await test('existing terminal and processing schedules are not overwritten', async () => {
    const existing = rows('2026-10-01');
    db.prepare("UPDATE daily_schedules SET status='success', attempt_count=1 WHERE id=?").run(existing[0].id);
    db.prepare("UPDATE daily_schedules SET status='processing', attempt_count=2 WHERE id=?").run(existing[1].id);
    const before = rows('2026-10-01'); await tick();
    assert.deepEqual(rows('2026-10-01'), before);
  });
  await test('missed midnight cron recovered by interval using Jakarta date', async () => {
    at('2026-10-01T17:05:00Z');
    await tick(); assert.equal(rows('2026-10-02').length, 2);
    assert.equal(g.getDailyScheduleGeneratorStatus().lastTrigger, 'periodic-recheck');
  });
  await test('partial schedules repaired without changing existing row', async () => {
    const before = rows('2026-10-02');
    db.prepare('DELETE FROM daily_schedules WHERE id=?').run(before[1].id);
    await tick();assert.equal(rows('2026-10-02').length, 2);
    assert.deepEqual(rows('2026-10-02')[0], before[0]);
  });
  await test('new user receives missing schedules only', async () => {
    addUser('two'); await tick();assert.equal(rows('2026-10-02').length, 4);
  });
  await test('expired ranges are not backfilled', async () => {
    at('2026-10-02T20:00:00+07:00');addUser('late'); await tick();
    assert.equal(rows('2026-10-02').length, 4);
  });
  await test('Sunday remains unscheduled', async () => {
    at('2026-10-04T00:05:00+07:00'); const before = calls;
    await tick();assert.equal(rows('2026-10-04').length, 0);assert.equal(calls,before);
  });
  await test('national holiday remains unscheduled', async () => {
    at('2026-10-05T00:05:00+07:00');
    holiday=async date=>({available:true,isHoliday:true,name:'Dummy holiday',date});
    await tick();assert.equal(rows('2026-10-05').length,0);
  });
  await test('startup error retains recovery timer and later succeeds', async () => {
    g.stopDailyScheduleGenerator(); at('2026-10-06T00:05:00+07:00');
    holiday=async()=>{throw new Error('Simulated generator failure');};
    const status=await g.startDailyScheduleGenerator();
    assert.equal(status.running,true);assert.equal(status.healthy,false);assert.equal(status.recheckRunning,true);
    holiday=async date=>({available:true,isHoliday:false,date});
    await tick();assert.equal(rows('2026-10-06').length,6);assert.equal(g.getDailyScheduleGeneratorStatus().healthy,true);
  });
  await test('cron and periodic callbacks share one in-flight generation', async () => {
    at('2026-10-07T00:05:00+07:00');let release;
    holiday=date=>new Promise(resolve=>{release=()=>resolve({available:true,isHoliday:false,date});});
    const before=calls;activeTimer().callback();activeTimer().callback();
    const cron=globalThis.__regression.jobs.findLast(j=>!j.stopped).callback();
    assert.equal(calls,before+1);release();await cron;await idle();assert.equal(rows('2026-10-07').length,6);
  });
  await test('stop cancels pending writes and stale timer callbacks', async () => {
    at('2026-10-08T00:05:00+07:00');let release;
    holiday=date=>new Promise(resolve=>{release=()=>resolve({available:true,isHoliday:false,date});});
    const old=activeTimer();old.callback();g.stopDailyScheduleGenerator();release();await idle();
    assert.equal(rows('2026-10-08').length,0);const before=calls;old.callback();assert.equal(calls,before);
    assert.equal(timers.filter(t=>t.active).length,0);
  });
  await test('midnight rollover during provider request cannot write yesterday', async () => {
    at('2026-10-08T23:59:59+07:00');let release;
    holiday=date=>new Promise(resolve=>{release=()=>resolve({available:true,isHoliday:false,date});});
    const starting=g.startDailyScheduleGenerator();at('2026-10-09T00:00:01+07:00');release();await starting;
    assert.equal(rows('2026-10-08').length,0);
    holiday=async date=>({available:true,isHoliday:false,date});await tick();assert.equal(rows('2026-10-09').length,6);
  });
  await test('shutdown with provider in flight does not touch closed database', async () => {
    at('2026-10-10T00:05:00+07:00');let release;
    holiday=date=>new Promise(resolve=>{release=()=>resolve({available:true,isHoliday:false,date});});
    activeTimer().callback();
    const {requestShutdown}=await import('../../app/services/lifecycle.service.js');requestShutdown('TEST');
    g.stopDailyScheduleGenerator();closeDatabase();release();await idle();
    assert.equal((await g.startDailyScheduleGenerator()).running,false);
  });
  console.log(`${passed} recovery tests passed; dummy database only, no external requests.`);
} finally {
  g.stopDailyScheduleGenerator(); if (db.open) closeDatabase();
  globalThis.Date=RealDate;globalThis.setInterval=nativeInterval;globalThis.clearInterval=nativeClear;
}
