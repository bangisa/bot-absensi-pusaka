import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchCalendar, validateCalendar, validateCalendarUrl } from '../../app/helpers/holiday-calendar.helper.js';

const url='https://api.kemendesa.link/libur-nasional/api/holidays/2026.json';
const fixture={metadata:{year:2026},data:[{date:'2026-08-17',name:'Test holiday',is_cuti_bersama:false}]};
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}

if(process.argv.includes('--worker')) {
  const service=await import('../../app/services/holiday-calendar.service.js');
  const tz=await import('../../app/services/timezone-setting.service.js');
  const {timeConfig}=await import('../../app/config/time.config.js');
  const {default:db}=await import('../../database/db.js');
  globalThis.fetch=async()=>new Response(JSON.stringify(fixture),{headers:{'content-type':'application/json'}});
  await test('save-and-lookup',async()=>{
    await service.saveHolidayCalendar(url);
    assert.equal(service.getHolidayCalendarSetting().count,1);
    assert.equal(service.checkSavedHolidayCalendar('2026-08-17').isHoliday,true);
    assert.equal(service.checkSavedHolidayCalendar('2026-08-18').isHoliday,false);
    assert.equal(service.checkSavedHolidayCalendar('2027-08-17'),null);
  });
  await test('failed-save-preserves-setting',async()=>{
    globalThis.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
    await assert.rejects(service.saveHolidayCalendar(url));
    assert.equal(service.getHolidayCalendarSetting().count,1);
  });
  await test('timezone-pending-and-apply',()=>{
    tz.saveTimezoneSetting('Asia/Makassar');
    assert.equal(tz.getTimezoneSetting().restartRequired,true);
    assert.equal(timeConfig.timeZone,'Asia/Jakarta');
    tz.initializeRuntimeTimezone();
    assert.equal(timeConfig.timeZone,'Asia/Makassar');
    assert.equal(tz.getTimezoneSetting().restartRequired,false);
  });
  await test('timezone-reject-invalid',()=>assert.throws(()=>tz.saveTimezoneSetting('bad-zone')));
  db.prepare("INSERT INTO users (username,password,latitude,longitude) VALUES ('dummy','dummy',0,0)").run();
  db.prepare("INSERT INTO daily_schedules (user_id,schedule_date,type,scheduled_time,status) VALUES (1,'2026-10-08','masuk','06:00:00','pending')").run();
  await test('timezone-pending-schedule-guard',()=>assert.throws(()=>tz.saveTimezoneSetting('Asia/Jayapura')));
  await test('timezone-restart-same-applied-zone',()=>{
    timeConfig.timeZone='Asia/Jakarta';
    tz.initializeRuntimeTimezone();
    assert.equal(timeConfig.timeZone,'Asia/Makassar');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_schedules').get().n,1);
  });
  await test('reset-calendar',()=>{service.resetHolidayCalendar();assert.equal(service.getHolidayCalendarSetting().enabled,false);});
  await test('database-integrity',()=>assert.equal(db.pragma('integrity_check',{simple:true}),'ok'));
  db.close();
} else {
  await test('URL-allowlist',()=>{
    assert.equal(validateCalendarUrl(url),url);
    for(const bad of ['http://127.0.0.1','https://localhost/a','https://api.kemendesa.link.evil.test/libur-nasional/api/holidays/latest',url+'?x=1',url+'#hash','https://user:pass@api.kemendesa.link/libur-nasional/api/holidays/latest']) assert.throws(()=>validateCalendarUrl(bad));
  });
  await test('valid-schema',()=>assert.equal(validateCalendar(fixture,url).year,2026));
  await test('invalid-schema',()=>{
    for(const value of [{}, {...fixture,data:[]},{...fixture,data:[...fixture.data,...fixture.data]}, {...fixture,metadata:{year:2027}}, {...fixture,data:[{...fixture.data[0],date:'2026-02-30'}]}, {...fixture,data:[{...fixture.data[0],is_cuti_bersama:'false'}]}]) assert.throws(()=>validateCalendar(value,url));
  });
  await test('download-valid-no-redirect',async()=>{
    const result=await fetchCalendar(url,async(u,options)=>{
      assert.equal(options.redirect,'error');assert.ok(options.signal);
      return new Response(JSON.stringify(fixture),{headers:{'content-type':'application/json'}});
    });assert.equal(result.holidays.length,1);
  });
  await test('download-rejections',async()=>{
    for(const r of [new Response('oops',{status:500}),new Response('<html>'),new Response('{',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}})]) await assert.rejects(fetchCalendar(url,async()=>r));
  });
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'pusaka-calendar-'));
  for(const dir of ['app','scripts']) fs.cpSync(path.join(root,dir),path.join(sandbox,dir),{recursive:true});
  fs.mkdirSync(path.join(sandbox,'database'));
  fs.copyFileSync(path.join(root,'database/db.js'),path.join(sandbox,'database/db.js'));
  fs.copyFileSync(path.join(root,'package.json'),path.join(sandbox,'package.json'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(sandbox,'node_modules'),'junction');
  const result=spawnSync(process.execPath,['scripts/regression/calendar-settings.mjs','--worker'],{cwd:sandbox,encoding:'utf8',timeout:30000,env:{...process.env,NODE_ENV:'development',TZ:'Asia/Jakarta',APP_SECRET:'test-only-secret-that-is-long-enough',BASE_URL_PUSAKA:'https://pusaka.invalid',APP_BASE_URL:'http://localhost:3000',ADMIN_USERNAME:'dummy',ADMIN_PASSWORD_HASH:'dummy',CREDENTIAL_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')}});
  console.log(result.stdout);assert.equal(result.status,0,result.stderr);
}
console.log(`${count} checks passed in this process`);
