import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pusaka-dashboard-'));
for (const dir of ['app', 'public', 'scripts']) fs.cpSync(path.join(root, dir), path.join(sandbox, dir), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'database'));
fs.copyFileSync(path.join(root, 'database/db.js'), path.join(sandbox, 'database/db.js'));
for (const file of ['package.json', 'index.js']) fs.copyFileSync(path.join(root, file), path.join(sandbox, file));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction');
const portProbe = http.createServer();
await new Promise(r => portProbe.listen(0, '127.0.0.1', r));
const port = portProbe.address().port;
await new Promise(r => portProbe.close(r));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), AUTO_START: 'false',
  TZ: 'Asia/Jakarta', BASE_URL_PUSAKA: 'https://pusaka.invalid', APP_BASE_URL: base, APP_SECRET: crypto.randomBytes(32).toString('hex'),
  ADMIN_USERNAME: 'dashboard-test', ADMIN_PASSWORD_HASH: bcrypt.hashSync('DummyOnly123!', 4),
  CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), MAX_CONCURRENT: '1',
  DB_BACKUP_ENABLED: 'true', DB_BACKUP_RETENTION_COUNT: '4', STRUCTURED_LOG_DIR: 'logs', DB_BACKUP_DIR: 'backups',
  HOLIDAY_CACHE_FILE: 'data/cache.json', HOLIDAY_OVERRIDES_FILE: 'data/overrides.json',
  SESSION_COOKIE_SECURE: 'false', SESSION_SAME_SITE: 'lax', SESSION_COOKIE_NAME: 'dashboard_test_sid',
  SECURITY_HEADERS_ENABLED: 'true', CSRF_PROTECTION_ENABLED: 'true', REGRESSION_ROOT: sandbox };
const child = spawn(process.execPath, ['--import', './scripts/regression/hooks.mjs', 'index.js'], { cwd: sandbox, env, stdio: ['ignore','pipe','pipe','ipc'] });
let output = '';
child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
const results = [], trace = [], browserErrors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn) { for (let i=0;i<100;i++) { if(fn()) return; await sleep(100); } throw new Error('Timed out'); }
async function test(id, fn) {
  try { results.push({ id, result:'PASS', evidence:await fn() || 'Assertions passed' }); }
  catch(e) { results.push({ id, result:'FAIL', evidence:e.message }); }
  console.log(`${results.at(-1).result} ${id}`);
}
let browser, page;
try {
  await wait(() => output.includes('Server running'));
  const acknowledged = new Promise(r=>child.once('message',r)); child.send('regression-holiday'); await acknowledged;
  browser = await puppeteer.launch({ headless:true });
  page = await browser.newPage();
  page.on('pageerror', e=>browserErrors.push(e.message));
  let mockDraining=false;
  let mockTimezone=null;
  await page.setRequestInterception(true);
  page.on('request', async req => {
    const url=new URL(req.url());
    if(url.origin!==base) return req.abort();
    trace.push({path:url.pathname,method:req.method(),csrf:Boolean(req.headers()['x-csrf-token'])});
    if((mockDraining || mockTimezone) && ['/api/system/health','/api/system/diagnostics'].includes(url.pathname)) {
      const cookie=(await page.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
      const original=await fetch(req.url(),{headers:{Cookie:cookie}}); const body=await original.json();
      if(mockDraining) body.lifecycle={...body.lifecycle,state:'DRAINING',shutdownRequested:true};
      if(mockTimezone) body.timezone=mockTimezone;
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
    }
    return req.continue();
  });
  await page.goto(base+'/login');
  await page.evaluate(async()=>{
    const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'dashboard-test',password:'DummyOnly123!'})});
    if(!r.ok)throw new Error('Dummy login failed');
  });
  await page.goto(base+'/');
  await page.waitForFunction(()=>document.getElementById('refresh-status').textContent.startsWith('Terakhir diperbarui'));
  await test('HEADER-timezone-date-boundary',async()=>{
    try {
      const source=fs.readFileSync(path.join(root,'public/js/dashboard.js'),'utf8');
      const clock=source.slice(source.indexOf('function updateClock()'),source.indexOf('async function refreshDashboard'));
      for(const [zone,label,date,day,hour] of [
        ['Asia/Jakarta','WIB','8 Oktober 2026','Kamis','23'],
        ['Asia/Makassar','WITA','9 Oktober 2026','Jumat','00'],
        ['Asia/Jayapura','WIT','9 Oktober 2026','Jumat','01'],
      ]) {
        const result=await page.evaluate((clock,zone)=>{
          const OriginalDate=Date;
          const FixedDate=class extends OriginalDate {constructor(){super('2026-10-08T16:30:00Z');}};
          new Function('Date','dashboardTimeZone','$',clock+';updateClock();')(FixedDate,zone,id=>document.getElementById(id));
          return ['current-timezone','current-date','current-day','current-time'].map(id=>document.getElementById(id).textContent);
        },clock,zone);
        assert.deepEqual(result.slice(0,3),[label,`${day}, ${date}`,'Hari Ini']);assert.ok(result[3].startsWith(hour));
        mockTimezone=zone;
        await page.click('#refresh-dashboard');
        await page.waitForFunction(label=>document.getElementById('current-timezone').textContent===label,{},label);
      }
    } finally {mockTimezone=null;}
  });
  await test('HEADER-responsive',async()=>{
    const sizes=await page.evaluate(()=>['current-date','current-time'].map(id=>getComputedStyle(document.getElementById(id)).fontSize));
    assert.equal(sizes[0],sizes[1]);
    for(const width of [320,390,768,1440]) {
      await page.setViewport({width,height:900});
      const bounds=await page.evaluate(()=>{
        const d=document.querySelector('.dashboard-date').getBoundingClientRect();
        const c=document.querySelector('.dashboard-clock').getBoundingClientRect();
        return {right:d.right,left:c.left,top:d.top,clockTop:c.top,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.ok(bounds.right<=bounds.left);assert.equal(bounds.top,bounds.clockTop);assert.equal(bounds.overflow,false);
      await page.screenshot({path:path.join(sandbox,`header-${width}.png`)});
    }
  });
  await test('FRONTEND-current-static',()=>{
    const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
    assert.match(html,/<title>Dashboard · Bot Absensi Pusaka<\/title>/);
    assert.ok(!html.includes('global-health'));
    assert.match(html,/<section[^>]+id="lifecycle-banner"[^>]+hidden/);
    const js=fs.readFileSync(path.join(root,'public/js/dashboard.js'),'utf8');
    assert.match(js,/const draining = lifecycle.state === "DRAINING"/);
  });
  await test('LIFECYCLE-running-visual',async()=>{
    const state=await page.evaluate(async()=>{
      const h=await (await fetch('/api/system/health')).json();
      const d=await (await fetch('/api/system/diagnostics')).json();
      const e=document.getElementById('lifecycle-banner');
      return {state:h.lifecycle.state,shutdown:h.lifecycle.shutdownRequested,hasDrain:!!d.drain,hidden:e.hidden,display:getComputedStyle(e).display,height:e.getBoundingClientRect().height};
    });
    assert.equal(state.state,'RUNNING'); assert.equal(state.shutdown,false); assert.equal(state.hasDrain,true); assert.equal(state.hidden,true);
    assert.equal(state.display,'none',JSON.stringify(state)); assert.equal(state.height,0);
    return JSON.stringify(state);
  });
  await test('CALENDAR-unchecked',async()=>{
    const text=await page.evaluate(()=>['holiday-source','holiday-available','holiday-status'].map(id=>document.getElementById(id).textContent));
    assert.deepEqual(text,['Belum ada','Belum dicek','Belum dicek']);
  });
  await test('GET-before-CSRF',async()=>{
    const r=await page.evaluate(async()=>{const r=await fetch('/api/system/settings/max-concurrent'); return {status:r.status,body:await r.json()};});
    assert.equal(r.status,200); assert.ok(r.body.value>=1 && r.body.value<=5);
    assert.ok(!trace.some(t=>t.path==='/auth/csrf'));
    return 'GET 200 before any /auth/csrf request; initial value='+r.body.value;
  });
  await test('PUT-no-CSRF',async()=>{
    const status=await page.evaluate(async()=>(await fetch('/api/system/settings/max-concurrent',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:2})})).status);
    assert.equal(status,403);
  });
  await test('PUT-valid-CSRF-UI',async()=>{
    await page.select('#max-concurrent-input','2');
    const response=page.waitForResponse(r=>r.url().endsWith('/settings/max-concurrent') && r.request().method()==='PUT');
    await page.click('#save-max-concurrent'); assert.equal((await response).status(),200);
    await page.waitForFunction(()=>!document.getElementById('save-max-concurrent').disabled);
    const value=await page.evaluate(async()=> (await (await fetch('/api/system/settings/max-concurrent')).json()).value);
    assert.equal(value,2); assert.ok(trace.some(t=>t.method==='PUT' && t.csrf));
    assert.ok(trace.filter(t=>t.method==='GET').every(t=>!t.csrf));
  });
  await test('PUT-invalid-values',async()=>{
    const statuses=await page.evaluate(async()=>{
      const {csrfToken}=await (await fetch('/auth/csrf')).json(); const statuses=[];
      for(const value of [0,6,-1,'abc',null]) {
        const r=await fetch('/api/system/settings/max-concurrent',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({value})});
        statuses.push(r.status);
      } return statuses;
    });
    assert.deepEqual(statuses,[400,400,400,400,400]);
  });
  await test('PUT-restore-initial',async()=>{
    await page.evaluate(async()=>{const api=await import('/js/api.js'); await api.updateMaxConcurrent(1);});
    assert.equal(await page.evaluate(async()=> (await (await fetch('/api/system/settings/max-concurrent')).json()).value),1);
  });
  await test('DASHBOARD-refresh-endpoints',async()=>{
    const statuses=await page.evaluate(async()=>Promise.all(['status','health','diagnostics','audit-logs','settings/max-concurrent'].map(async p=>(await fetch('/api/system/'+p)).status)));
    assert.deepEqual(statuses,[200,200,200,200,200]);
    await page.click('#refresh-dashboard');
    await page.waitForFunction(()=>!document.getElementById('refresh-dashboard').disabled);
    assert.match(await page.$eval('#refresh-status',e=>e.textContent),/^Terakhir diperbarui/);
  });
  await test('SCHEDULER-buttons',async()=>{
    await page.click('#start-btn');
    await page.waitForFunction(()=>document.getElementById('scheduler-status').textContent==='RUNNING');
    const start=await page.$eval('#start-btn',e=>({hidden:e.hidden,display:getComputedStyle(e).display}));
    await page.click('#stop-btn');
    await page.waitForFunction(()=>document.getElementById('scheduler-status').textContent==='STOPPED');
    const stop=await page.$eval('#stop-btn',e=>({hidden:e.hidden,display:getComputedStyle(e).display}));
    assert.equal(start.hidden,true); assert.equal(start.display,'none'); assert.equal(stop.hidden,true); assert.equal(stop.display,'none');
    assert.match(await page.$eval('#scheduler-status',e=>e.className),/mini-status/);
  });
  await test('LIFECYCLE-draining-visual',async()=>{
    mockDraining=true; await page.reload();
    await page.waitForFunction(()=>!document.getElementById('lifecycle-banner').hidden);
    assert.notEqual(await page.$eval('#lifecycle-banner',e=>getComputedStyle(e).display),'none');
    assert.equal(await page.evaluate(async()=>(await fetch('/api/system/settings/max-concurrent')).status),200);
    mockDraining=false; await page.reload();
    await page.waitForFunction(()=>document.getElementById('refresh-status').textContent.startsWith('Terakhir diperbarui'));
    return 'DRAINING response fixture visible; settings GET remains 200; restored real RUNNING responses';
  });
  await test('RESPONSIVE-calendar',async()=>{
    for(const width of [390,1440]) {
      await page.setViewport({width,height:900});
      const state=await page.$eval('#holiday-name',e=>({align:getComputedStyle(e).textAlign,wrap:getComputedStyle(e).overflowWrap,overflow:document.documentElement.scrollWidth>innerWidth+1}));
      assert.equal(state.align,'right'); assert.equal(state.wrap,'anywhere'); assert.equal(state.overflow,false);
      await (await page.$('.holiday-card')).screenshot({path:path.join(sandbox,`calendar-settings-${width}.png`)});
      await (await page.$('#timezone-settings-form')).screenshot({path:path.join(sandbox,`timezone-settings-${width}.png`)});
    }
  });
  await test('CACHE-headers',async()=>{
    const headers=await page.evaluate(async()=>{
      const result={}; for(const url of ['/','/js/dashboard.js','/js/api.js','/css/style.css']) {
        const r=await fetch(url); result[url]={status:r.status,cache:r.headers.get('cache-control'),etag:!!r.headers.get('etag'),lastModified:!!r.headers.get('last-modified')};
      }return result;
    });
    assert.match(headers['/'].cache,/no-store/);
    for(const url of ['/js/dashboard.js','/js/api.js','/css/style.css']){assert.equal(headers[url].status,200);assert.match(headers[url].cache,/max-age=0/);assert.equal(headers[url].etag,true);}
    return JSON.stringify(headers);
  });
  await test('USERS-LOGS-smoke',async()=>{
    for(const url of ['/users.html','/logs.html']){const response=await page.goto(base+url);assert.equal(response.status(),200);}
    assert.deepEqual(browserErrors,[]);
  });
  await test('BACKUP-manual-CSRF-retention-integrity',async()=>{
    await page.goto(base+'/');
    await page.waitForSelector('#backup-now');
    assert.equal(await page.evaluate(async()=>(await fetch('/api/system/backup',{method:'POST'})).status),403);
    await page.click('#backup-now');
    await page.waitForFunction(()=>document.getElementById('backup-now-status').textContent==='Backup berhasil.');
    const statuses=await page.evaluate(async()=>{
      const {csrfToken}=await (await fetch('/auth/csrf')).json();const statuses=[];
      for(let i=0;i<5;i++)statuses.push((await fetch('/api/system/backup',{method:'POST',headers:{'X-CSRF-Token':csrfToken}})).status);
      return statuses;
    });assert.deepEqual(statuses,[200,200,200,200,200]);
    const files=fs.readdirSync(path.join(sandbox,'backups')).filter(f=>f.endsWith('.sqlite'));
    assert.equal(files.length,4);
    const {default:Database}=await import('better-sqlite3');
    for(const file of files){const db=new Database(path.join(sandbox,'backups',file),{readonly:true});assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();}
  });
  await test('USER-PATCH-auth-CSRF-plan-and-edit-UI',async()=>{
    // CSRF middleware precedes the admin guard, so anonymous mutations may fail with 403.
    assert.ok([401,403].includes((await fetch(base+'/api/users/1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'})).status));
    await page.goto(base+'/users.html');
    const id=await page.evaluate(async()=>{
      const {csrfToken}=await (await fetch('/auth/csrf')).json();
      const r=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({nickname:'Test edit',username:'test-edit-dummy',password:'dummy-secret',latitude:0,longitude:0,service_days_total:7})});
      if(!r.ok)throw new Error('Create failed');return (await r.json()).id;
    });
    await page.reload();await page.waitForFunction(()=>[...document.querySelectorAll('#users-list button')].some(b=>b.textContent==='Edit'));
    await page.evaluate(()=>[...document.querySelectorAll('#users-list button')].find(b=>b.textContent==='Edit').click());
    assert.equal(await page.$eval('#username',e=>e.value),'');assert.equal(await page.$eval('#password',e=>e.value),'');
    assert.equal(await page.$eval('#service-plan',e=>e.value),'7');
    for (const width of [320,390,560,1440]) {
      await page.setViewport({width,height:800});
      const layout=await page.evaluate(()=>{
        const form=document.querySelector('#user-form'),modal=document.querySelector('#user-modal');
        const labels=[...form.querySelectorAll(':scope > label')].map(e=>e.getBoundingClientRect());
        const heading=document.querySelector('.users-heading').getBoundingClientRect();
        const count=document.querySelector('#users-summary').getBoundingClientRect();
        return {columns:getComputedStyle(form).gridTemplateColumns.split(' ').length,overflow:modal.scrollWidth>modal.clientWidth,
          pairs:[0,2,4].every(i=>Math.abs(labels[i].top-labels[i+1].top)<1 && labels[i].right<=labels[i+1].left),countRight:Math.abs(heading.right-count.right)<1};
      });
      assert.equal(layout.columns,2);assert.equal(layout.overflow,false);assert.equal(layout.pairs,true);assert.equal(layout.countRight,true);
      await page.screenshot({path:path.join(sandbox,`user-modal-${width}.png`)});
    }
    await page.$eval('#nickname',e=>{e.value='Edited UI';});await page.select('#service-plan','30');
    const patched=page.waitForResponse(r=>r.request().method()==='PATCH');
    await page.click('#user-form button[type=submit]');assert.equal((await patched).status(),200);
    await page.waitForFunction(()=>!document.querySelector('#user-modal').open);
    const result=await page.evaluate(async id=>{
      const headers={'Content-Type':'application/json'};
      const noCsrf=await fetch('/api/users/'+id,{method:'PATCH',headers,body:JSON.stringify({nickname:'Blocked'})});
      const {csrfToken}=await (await fetch('/auth/csrf')).json();headers['X-CSRF-Token']=csrfToken;
      const invalid=await fetch('/api/users/'+id,{method:'PATCH',headers,body:JSON.stringify({latitude:999})});
      const user=(await (await fetch('/api/users')).json()).find(u=>u.id===id);
      return {noCsrf:noCsrf.status,invalid:invalid.status,user};
    },id);
    assert.equal(result.noCsrf,403);assert.equal(result.invalid,400);assert.equal(result.user.nickname,'Edited UI');assert.equal(result.user.service_days_total,30);assert.equal(result.user.service_days_used,0);assert.equal('password' in result.user,false);
    for(const width of [390,1440]){await page.setViewport({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(sandbox,`users-edit-${width}.png`),fullPage:true});}
    await page.evaluate(async id=>{const {csrfToken}=await (await fetch('/auth/csrf')).json();await fetch('/api/users/'+id,{method:'DELETE',headers:{'X-CSRF-Token':csrfToken}});await fetch('/api/system/scheduler/stop',{method:'POST',headers:{'X-CSRF-Token':csrfToken}});},id);
  });
  await test('SETTINGS-auth-CSRF-validation',async()=>{
    assert.equal((await fetch(base+'/api/system/settings/holiday-calendar')).status,401);
    assert.equal((await fetch(base+'/api/system/settings/timezone')).status,401);
    const result=await page.evaluate(async()=>{
      const {csrfToken}=await (await fetch('/auth/csrf')).json();
      const send=(path,method,body,csrf=true)=>fetch('/api/system/'+path,{method,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfToken}:{})},body:JSON.stringify(body)});
      const statuses=[];
      statuses.push((await send('settings/holiday-calendar','PUT',{url:'https://localhost'},false)).status);
      statuses.push((await send('settings/holiday-calendar/test','POST',{url:'https://localhost'})).status);
      statuses.push((await send('settings/holiday-calendar','PUT',{url:'https://localhost'})).status);
      statuses.push((await send('settings/timezone','PUT',{value:'bad-zone'})).status);
      statuses.push((await send('settings/timezone','PUT',{value:'Asia/Makassar'},false)).status);
      const saved=await (await send('settings/timezone','PUT',{value:'Asia/Makassar'})).json();
      statuses.push((await send('scheduler/start','POST',{})).status);
      const restored=await (await send('settings/timezone','PUT',{value:'Asia/Jakarta'})).json();
      return {statuses,saved,restored};
    });
    assert.deepEqual(result.statuses,[403,400,400,400,403,409]);
    assert.equal(result.saved.restartRequired,true);assert.equal(result.saved.active,'Asia/Jakarta');
    assert.equal(result.restored.restartRequired,false);
  });
  for(const file of ['dashboard','api','users','logs','auth-ui']) await test(`SYNTAX-${file}`,()=>{
    assert.equal(spawnSync(process.execPath,['--check',path.join(root,`public/js/${file}.js`)]).status,0);
  });
} finally {
  await browser?.close();
  if(child.exitCode===null){child.send('regression-sigterm');await wait(()=>child.exitCode!==null).catch(()=>child.kill());}
  fs.writeFileSync(path.join(sandbox,'frontend-results.json'),JSON.stringify({results,trace,browserErrors},null,2));
  console.log(JSON.stringify({sandbox,results},null,2));
}
process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
