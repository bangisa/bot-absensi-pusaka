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
  DB_BACKUP_ENABLED: 'false', STRUCTURED_LOG_DIR: 'logs', DB_BACKUP_DIR: 'backups',
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
  await page.setRequestInterception(true);
  page.on('request', async req => {
    const url=new URL(req.url());
    if(url.origin!==base) return req.abort();
    trace.push({path:url.pathname,method:req.method(),csrf:Boolean(req.headers()['x-csrf-token'])});
    if(mockDraining && ['/api/system/health','/api/system/diagnostics'].includes(url.pathname)) {
      const cookie=(await page.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
      const original=await fetch(req.url(),{headers:{Cookie:cookie}}); const body=await original.json();
      body.lifecycle={...body.lifecycle,state:'DRAINING',shutdownRequested:true};
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
