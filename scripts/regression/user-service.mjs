import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.argv.includes('--worker')) {
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'pusaka-user-service-'));
  for(const dir of ['app','scripts'])fs.cpSync(path.join(root,dir),path.join(sandbox,dir),{recursive:true});
  fs.mkdirSync(path.join(sandbox,'database'));
  fs.copyFileSync(path.join(root,'database/db.js'),path.join(sandbox,'database/db.js'));
  fs.copyFileSync(path.join(root,'package.json'),path.join(sandbox,'package.json'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(sandbox,'node_modules'),'junction');
  const {default:Database}=await import('better-sqlite3');
  const legacy=new Database(path.join(sandbox,'database/db.sqlite'));
  legacy.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, nickname TEXT, password TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, auto_login INTEGER DEFAULT 1)");
  legacy.prepare('INSERT INTO users (id,username,nickname,password,latitude,longitude) VALUES (-1,?,?,?,?,?)').run('legacy-dummy','Legacy','legacy-secret',0,0);
  legacy.close();
  const env={...process.env,NODE_ENV:'development',TZ:'Asia/Jakarta',APP_SECRET:'dummy-only-long-secret',BASE_URL_PUSAKA:'https://pusaka.invalid',APP_BASE_URL:'http://localhost:3000',ADMIN_USERNAME:'dummy',ADMIN_PASSWORD_HASH:'dummy',CREDENTIAL_ENCRYPTION_KEY:Buffer.alloc(32,2).toString('base64')};
  for(const extra of [[],['--reopen']]) {
    const result=spawnSync(process.execPath,['--import','./scripts/regression/hooks.mjs','scripts/regression/user-service.mjs','--worker',...extra],{cwd:sandbox,env,encoding:'utf8',timeout:60000});
    console.log(result.stdout);assert.equal(result.status,0,result.stderr);
  }
  console.log('Evidence: '+sandbox);
} else {
  const {default:db}=await import('../../database/db.js');
  const users=await import('../../app/models/user.model.js');
  const days=await import('../../app/models/user-service.model.js');
  const cookies=await import('../../app/services/cookies.service.js');
  const operations=await import('../../app/services/user-operation.service.js');
  const {useServiceDayForExecution}=await import('../../app/services/user-service-day.service.js');
  const {generateDailySchedules}=await import('../../app/services/daily-schedule.service.js');
  let count=0;
  async function test(name,fn){await fn();count++;console.log('PASS '+name);}
  if(process.argv.includes('--reopen')) {
    await test('migration-idempotent-and-usage-persistent',()=>{
      assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
      assert.equal(users.findUserById(1).username,'changed-dummy');
      assert.equal(users.findUserById(1).password,'changed-secret');
      assert.equal(db.prepare('SELECT service_days_used FROM users WHERE id=1').get().service_days_used,1);
      assert.equal(db.prepare('SELECT count(*) n FROM user_service_days WHERE user_id=1').get().n,1);
    });
  } else {
    await test('legacy-user-backward-compatible-unlimited',()=>{
      const legacy=users.findUserById(-1);
      assert.equal(legacy.username,'legacy-dummy');assert.equal(legacy.password,'legacy-secret');
      assert.equal(legacy.service_days_total,null);assert.equal(legacy.service_days_used,0);assert.equal(legacy.service_status,'active');
    });
    let seq=0;
    const create=(plan=null)=>Number(users.createManagedUser({nickname:'Dummy',username:'dummy-'+(++seq),password:'dummy-secret',latitude:0,longitude:0,service_days_total:plan}).lastInsertRowid);
    const id=create(1);
    const row=()=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
    const cookieFile=path.join(process.cwd(),'cookies',id+'.json');
    fs.mkdirSync(path.dirname(cookieFile),{recursive:true});
    fs.writeFileSync(cookieFile,JSON.stringify([{name:'session',value:'dummy'}]));
    const page={setCookie:async()=>{},cookies:async()=>[{name:'session',value:'new-dummy'}]};
    await test('edit-profile-preserves-encrypted-credentials-session',async()=>{
      const before=row();users.updateUser(id,{nickname:'Edited',latitude:0,longitude:110,username:'',password:''});
      const after=row();assert.equal(after.username,before.username);assert.equal(after.password,before.password);assert.equal(after.username_hash,before.username_hash);assert.equal(after.credential_version,0);assert.equal(after.latitude,0);assert.equal(await cookies.loadCookies(page,id),true);
    });
    await test('edit-credential-invalidates-legacy-session',async()=>{
      const before=row();const result=users.updateUser(id,{username:'changed-dummy',password:'changed-secret'});
      assert.equal(result.credentialsChanged,true);assert.notEqual(row().username_hash,before.username_hash);assert.equal(row().credential_version,1);assert.equal(await cookies.loadCookies(page,id),false);
      assert.equal(users.findUserById(id).password,'changed-secret');assert.ok(row().password.startsWith('encv1:'));
      await cookies.saveCookies(page,id);assert.equal(await cookies.loadCookies(page,id),true);
    });
    await test('same-credential-does-not-invalidate',()=>{
      assert.equal(users.updateUser(id,{username:'changed-dummy',password:'changed-secret'}).credentialsChanged,false);assert.equal(row().credential_version,1);
    });
    await test('duplicate-username-rollback',()=>{
      const second=create();assert.throws(()=>users.updateUser(second,{username:'changed-dummy'}));assert.equal(users.findUserById(second).username,'dummy-2');
    });
    await test('busy-user-rejected',()=>{
      operations.beginUserOperation(id);try{assert.throws(()=>users.updateUser(id,{nickname:'Blocked'}));}finally{operations.endUserOperation(id);}
    });
    await test('validation-rejects-invalid-patches',()=>{
      for(const patch of [{latitude:null},{latitude:'NaN'},{longitude:181},{nickname:''},{service_days_total:2},{service_days_total:'7'},{service_days_used:0},{password:123},{username:{}},null])assert.throws(()=>users.updateUser(id,patch));
    });
    await test('public-projection-no-secrets',()=>{
      for(const user of users.findAllPublicUsers())for(const key of ['password','username','username_hash','credential_version'])assert.equal(key in user,false);
      assert.ok(!JSON.stringify(users.findAllPublicUsers()).includes('changed-secret'));
    });
    await test('plans-1-7-30-90-unlimited',()=>{
      for(const plan of [1,7,30,90,null]) {
        const target=create(plan);const n=plan??100;
        for(let i=0;i<n;i++){
          const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
          assert.equal(days.consumeServiceDay(target,date),true);assert.equal(days.consumeServiceDay(target,date),true);
        }
        const u=db.prepare('SELECT * FROM users WHERE id=?').get(target);
        assert.equal(u.service_days_used,n);assert.equal(u.service_status,plan===null?'active':'completed');
        assert.equal(days.canUseServiceDay(target,'2027-01-01'),plan===null);
      }
    });
    await test('masuk-pulang-retry-count-once-and-plan-preserves-usage',()=>{
      assert.equal(days.consumeServiceDay(id,'2026-10-09'),true);
      assert.equal(days.consumeServiceDay(id,'2026-10-09'),true);
      assert.equal(row().service_days_used,1);assert.equal(row().service_status,'completed');
      assert.equal(days.consumeServiceDay(id,'2026-10-10'),false);
      users.updateUser(id,{service_days_total:7});assert.equal(row().service_days_used,1);assert.equal(row().service_status,'active');assert.equal(row().service_completed_at,null);
      users.updateUser(id,{service_days_total:1});assert.equal(row().service_status,'completed');
    });
    globalThis.fetch=async()=>({ok:true,json:async()=>({is_holiday:true,data:{name:'Dummy holiday'}})});
    await test('holiday-and-sunday-do-not-consume',async()=>{
      const target=create(7);assert.equal(await useServiceDayForExecution(target,'2026-10-09'),false);assert.equal(await useServiceDayForExecution(target,'2026-10-11'),false);
      assert.equal(db.prepare('SELECT service_days_used FROM users WHERE id=?').get(target).service_days_used,0);
      const result=await generateDailySchedules(new Date('2026-10-09T00:00:00+07:00'));assert.equal(result.generated,0);
    });
    globalThis.fetch=async()=>({ok:true,json:async()=>({is_holiday:false,data:null})});
    await test('exhausted-plan-stops-new-generation',async()=>{
      await generateDailySchedules(new Date('2026-10-10T00:00:00+07:00'));
      assert.equal(db.prepare('SELECT count(*) n FROM daily_schedules WHERE user_id=?').get(id).n,0);
      assert.equal(await useServiceDayForExecution(id,'2026-10-10'),false);
      assert.equal(row().service_days_used,1);
    });
    await test('same-day-last-pulang-still-eligible',async()=>{
      await generateDailySchedules(new Date('2026-10-09T00:00:00+07:00'));
      assert.equal(db.prepare("SELECT count(*) n FROM daily_schedules WHERE user_id=? AND schedule_date='2026-10-09'").get(id).n,2);
    });
    await test('automation-failure-retry-pulang-single-debit',async()=>{
      const {openPusaka}=await import('../../app/services/automation.service.js');
      const {closeBrowserIfIdle}=await import('../../app/services/browser.service.js');
      const target=create(1);const user=users.findUserById(target);
      globalThis.__regression.failNext=true;
      await assert.rejects(openPusaka('masuk',user,{serviceDate:'2026-10-09'}));
      assert.equal((await openPusaka('masuk',user,{serviceDate:'2026-10-09'})).status,'success');
      assert.equal((await openPusaka('pulang',user,{serviceDate:'2026-10-09'})).status,'success');
      const calls=globalThis.__regression.calls;
      assert.equal((await openPusaka('masuk',user,{serviceDate:'2026-10-10'})).status,'skipped');
      assert.equal(globalThis.__regression.calls,calls);
      assert.equal(db.prepare('SELECT service_days_used FROM users WHERE id=?').get(target).service_days_used,1);
      assert.equal(operations.isUserOperationActive(target),false);
      await closeBrowserIfIdle('test complete');
    });
    await test('audit-no-credential-values-and-plan-recorded',()=>{
      const logs=db.prepare('SELECT * FROM audit_logs').all();const text=JSON.stringify(logs);
      for(const secret of ['changed-secret','changed-dummy','dummy-secret','encv1:'])assert.ok(!text.includes(secret));
      assert.ok(logs.some(l=>l.action==='user.plan_changed'));assert.ok(logs.some(l=>l.action==='user.update'));
    });
  }
  db.close();console.log(count+' user-service tests passed');
}
