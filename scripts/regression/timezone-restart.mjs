import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.argv.includes('--worker')) {
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'pusaka-timezone-'));
  for(const dir of ['app','scripts'])fs.cpSync(path.join(root,dir),path.join(sandbox,dir),{recursive:true});
  fs.mkdirSync(path.join(sandbox,'database'));
  fs.copyFileSync(path.join(root,'database/db.js'),path.join(sandbox,'database/db.js'));
  fs.copyFileSync(path.join(root,'package.json'),path.join(sandbox,'package.json'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(sandbox,'node_modules'),'junction');
  const result=spawnSync(process.execPath,['--import','./scripts/regression/hooks.mjs','scripts/regression/timezone-restart.mjs','--worker'],{
    cwd:sandbox,env:{...process.env,REGRESSION_ROOT:sandbox,pm_id:'timezone-test',TZ:'Asia/Jakarta',AUTO_START:'false',BASE_URL_PUSAKA:'https://pusaka.invalid',APP_BASE_URL:'http://127.0.0.1:3000',ADMIN_USERNAME:'test-admin',ADMIN_PASSWORD_HASH:bcrypt.hashSync('dummy-only',4),APP_SECRET:crypto.randomBytes(32).toString('hex'),CREDENTIAL_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),DB_BACKUP_ENABLED:'false',STRUCTURED_LOG_DIR:'logs'},encoding:'utf8',timeout:40000,
  });
  console.log(result.stdout);console.error(result.stderr);console.log(`Evidence: ${sandbox}`);process.exitCode=result.status??1;
} else {
  assert.equal(process.cwd(),process.env.REGRESSION_ROOT);
  const {default:db}=await import('../../database/db.js');
  const {insertUser}=await import('../../app/models/user.model.js');
  const {setSystemSetting,getSystemSetting,deleteSystemSetting}=await import('../../app/models/system-setting.model.js');
  const {getZonedDate}=await import('../../app/helpers/time.helper.js');
  const {timeConfig}=await import('../../app/config/time.config.js');
  const {requestTimezoneRestart,initializeTimezoneRestart}=await import('../../app/services/timezone-restart.service.js');
  const {getTimezoneSetting,initializeRuntimeTimezone}=await import('../../app/services/timezone-setting.service.js');
  const {recordTimezoneChangeAttempt,checkTimezoneChangeCooldown,getTimezoneChangeProtection}=await import('../../app/services/timezone-protection.service.js');
  const {getSchedulerStatus,stopScheduler}=await import('../../app/services/scheduler.service.js');
  const {getDailyScheduleGeneratorStatus}=await import('../../app/services/daily-schedule-generator.service.js');
  const {addToQueue,getQueueStatus}=await import('../../app/services/queue.service.js');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async fn=>{for(let i=0;i<80;i++){if(fn())return;await sleep(50);}throw new Error('Condition timed out');};
  const results=[];
  const test=async(id,fn)=>{try{await fn();results.push({id,result:'PASS'});}catch(e){results.push({id,result:'FAIL',evidence:e.message});}console.log(`${results.at(-1).result} ${id}`);};
  let signals=0;process.on('SIGTERM',()=>{signals++;});
  let seedIndex=0;
  const seed=(attempt=0)=>{
    const id=Number(insertUser({username:`timezone-dummy-${++seedIndex}`,password:'dummy-only',nickname:'Demo',latitude:0,longitude:0}).lastInsertRowid);
    return Number(db.prepare("INSERT INTO daily_schedules(user_id,schedule_date,type,scheduled_time,status,attempt_count,max_attempts,next_retry_at) VALUES(?,?,'pulang','23:59:59','pending',?,3,?)").run(id,getZonedDate(),attempt,attempt?`${getZonedDate()} 23:59:59`:null).lastInsertRowid);
  };
  const terminal=schedule=>db.prepare("UPDATE daily_schedules SET status='success' WHERE id=?").run(schedule);
  await test('TZ-no-PM2-no-side-effects',async()=>{
    delete process.env.pm_id;
    assert.throws(()=>requestTimezoneRestart('Asia/Makassar'),e=>e.code==='TIMEZONE_RESTART_UNAVAILABLE');
    assert.equal(getSystemSetting('timezone_restart_pending'),null);process.env.pm_id='timezone-test';
  });
  await test('TZ-idle-auto-restart-and-persistence',async()=>{
    assert.equal(requestTimezoneRestart('Asia/Makassar').pendingRestart,true);
    assert.equal(timeConfig.timeZone,'Asia/Jakarta');
    await wait(()=>signals===1);assert.equal(getSystemSetting('timezone_restart_pending'),null);
    assert.equal(getSchedulerStatus().running,false);initializeRuntimeTimezone();assert.equal(timeConfig.timeZone,'Asia/Makassar');
  });
  await test('TZ-cooldown-survives-reload-and-expires',async()=>{
    assert.ok(getTimezoneChangeProtection().retryAfterSeconds>86000);
    assert.throws(()=>requestTimezoneRestart('Asia/Jakarta'),e=>e.code==='TIMEZONE_CHANGE_COOLDOWN');
    assert.equal(getSystemSetting('timezone_restart_pending'),null);
    const probe=spawnSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';
      const {checkTimezoneChangeCooldown}=await import('./app/services/timezone-protection.service.js');
      assert.throws(()=>checkTimezoneChangeCooldown(),e=>e.code==='TIMEZONE_CHANGE_COOLDOWN');
      const {default:db}=await import('./database/db.js');db.close();
    `],{env:process.env,encoding:'utf8',timeout:10000});
    assert.equal(probe.status,0,probe.stderr);
    setSystemSetting('timezone_change_allowed_after',Date.now()-1);
    assert.doesNotThrow(()=>checkTimezoneChangeCooldown());
  });
  await test('TZ-attempt-window-persists-and-resets',async()=>{
    for(let i=0;i<3;i++)recordTimezoneChangeAttempt();
    assert.throws(()=>recordTimezoneChangeAttempt(),e=>e.code==='TIMEZONE_RATE_LIMIT'&&e.audit&&e.retryAfterSeconds>0);
    assert.throws(()=>recordTimezoneChangeAttempt(),e=>e.code==='TIMEZONE_RATE_LIMIT'&&!e.audit);
    const probe=spawnSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';
      const {recordTimezoneChangeAttempt}=await import('./app/services/timezone-protection.service.js');
      assert.throws(()=>recordTimezoneChangeAttempt(),e=>e.code==='TIMEZONE_RATE_LIMIT');
      const {default:db}=await import('./database/db.js');db.close();
    `],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(probe.status,0,probe.stderr);
    setSystemSetting('timezone_change_attempts',JSON.stringify({startedAt:Date.now()-900001,attempts:3,notified:true}));
    assert.doesNotThrow(()=>recordTimezoneChangeAttempt());
    assert.equal(JSON.parse(getSystemSetting('timezone_change_attempts').value).attempts,1);
  });
  await test('TZ-future-schedule-preserved',async()=>{
    const schedule=seed();requestTimezoneRestart('Asia/Jakarta');
    await sleep(1300);assert.equal(signals,1);assert.equal(timeConfig.timeZone,'Asia/Makassar');
    assert.equal(getSchedulerStatus().running,true);assert.equal(getDailyScheduleGeneratorStatus().running,false);
    const row=db.prepare('SELECT scheduled_time,status FROM daily_schedules WHERE id=?').get(schedule);
    assert.deepEqual(row,{scheduled_time:'23:59:59',status:'pending'});
    terminal(schedule);await wait(()=>signals===2);initializeRuntimeTimezone();
    assert.equal(timeConfig.timeZone,'Asia/Jakarta');
  });
  await test('TZ-running-pending-and-retry-gap',async()=>{
    setSystemSetting('timezone_change_allowed_after',Date.now()-1);
    let release;const gate=new Promise(r=>{release=r;});const completed=[];
    const jobs=[1,2,3].map(user=>addToQueue(`dummy-${user}`,async()=>{await gate;completed.push(user);}));
    await wait(()=>getQueueStatus().running>0);const retry=seed(1);
    requestTimezoneRestart('Asia/Makassar');await sleep(1200);assert.equal(signals,2);
    release();await Promise.all(jobs);assert.equal(completed.length,3);
    await sleep(1200);assert.equal(signals,2);assert.equal(getQueueStatus().running,0);
    assert.equal(timeConfig.timeZone,'Asia/Jakarta');
    terminal(retry);await wait(()=>signals===3);initializeRuntimeTimezone();
    assert.equal(timeConfig.timeZone,'Asia/Makassar');
  });
  await test('TZ-resume-persisted-request-with-auto-start-false',async()=>{
    const schedule=seed();stopScheduler();setSystemSetting('timezone_restart_pending','Asia/Jakarta');
    assert.equal(initializeTimezoneRestart(),true);assert.equal(getSchedulerStatus().running,true);
    await sleep(1200);assert.equal(signals,3);assert.equal(getTimezoneSetting().pendingRestart,true);
    terminal(schedule);await wait(()=>signals===4);initializeRuntimeTimezone();assert.equal(timeConfig.timeZone,'Asia/Jakarta');
  });
  stopScheduler();deleteSystemSetting('timezone_restart_pending');
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
  fs.writeFileSync('timezone-results.json',JSON.stringify(results,null,2));
  process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
}
