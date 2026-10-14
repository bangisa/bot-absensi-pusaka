import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pusaka-admin-cli-'));
for (const directory of ['app', 'scripts']) fs.cpSync(path.join(root, directory), path.join(sandbox, directory), {
  recursive: true, filter: (file) => !/\.(?:sqlite|sqlite-wal|sqlite-shm|db)$/.test(file) && !file.endsWith('.tmp'),
});
fs.mkdirSync(path.join(sandbox,'database'));
fs.copyFileSync(path.join(root,'database/db.js'),path.join(sandbox,'database/db.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(sandbox, 'package.json'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const key = crypto.randomBytes(32).toString('base64');
const secrets = ['CLI-dummy-username', 'CLI-dummy-password', 'CLI-dummy-app-secret', key];
const config = {
  NODE_ENV: 'development', AUTO_START: 'false', TZ: 'Asia/Jakarta', PORT: '65534',
  APP_SECRET: secrets[2], ADMIN_USERNAME: 'dummy-admin', ADMIN_PASSWORD_HASH: 'dummy-hash-only',
  BASE_URL_PUSAKA: 'https://pusaka.invalid', APP_BASE_URL: 'http://127.0.0.1:65534',
  MAX_CONCURRENT: '1', DB_BACKUP_ENABLED: 'true', DB_BACKUP_RETENTION_COUNT: '4',
};
const environment = {};
for (const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','HOME']) {
  if (process.env[name] !== undefined) environment[name] = process.env[name];
}
function envFile(overrides = {}) {
  fs.writeFileSync(path.join(sandbox, '.env'), Object.entries({ ...config, ...overrides }).map(([k,v]) => `${k}=${v}`).join('\n'));
}
envFile();
fs.mkdirSync(path.join(sandbox, '.secrets'));
fs.writeFileSync(path.join(sandbox, '.secrets/credential.key'), key, {mode:0o600});
const shim = path.join(sandbox, 'cli-test-boundary.cjs');
fs.writeFileSync(shim, `
const fs=require('fs'),cp=require('child_process'),path=require('path');
const originalExec=cp.execFileSync;
cp.execFileSync=function(executable,args,options){
 if(executable==='powershell.exe'&&args.join(' ').includes('Win32_Process')){
  const records=process.env.CLI_PROCESS==='owned'?[{ProcessId:987654,CommandLine:'node "'+path.join(process.cwd(),'index.js')+'"'}]:process.env.CLI_PROCESS==='unrelated'?[{ProcessId:987654,CommandLine:'node "C:/unrelated-application/index.js"'}]:[];
  return JSON.stringify(records);
 }
 return originalExec.apply(this,arguments);
};
let injected=false;const rename=fs.renameSync,write=fs.writeFileSync;
fs.renameSync=function(from,to){if(!injected&&process.env.CLI_FAULT==='install'&&path.basename(to)==='db.sqlite'&&path.basename(from).startsWith('.restore-')){injected=true;throw Object.assign(new Error('Injected install error'),{code:'EIO'});}return rename.apply(this,arguments);};
fs.writeFileSync=function(file,data){if(!injected&&process.env.CLI_FAULT==='manifest'&&String(file).endsWith('manifest.json')&&String(data).includes('"completed": true')){injected=true;throw Object.assign(new Error('Injected manifest error'),{code:'EIO'});}return write.apply(this,arguments);};
require('module').syncBuiltinESMExports();
`);
async function run(script, args = [], extra = {}, useShim = true) {
  const child = spawn(process.execPath, [...(useShim ? ['--require',shim] : []), ...script, ...args], {
    cwd: sandbox, env: { ...environment, ...extra }, windowsHide: true, stdio:['ignore','pipe','pipe'],
  });
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const timer=setTimeout(()=>child.kill(),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  clearTimeout(timer);
  if(!script.includes('-e')) for(const value of secrets) assert.ok(!output.includes(value),'Secret leaked in command output');
  if(script.includes('-e')) for(const value of secrets) output=output.split(value).join('[DUMMY_REDACTED]');
  return {code,output};
}
const initialize = `import 'dotenv/config';const {default:db}=await import('./database/db.js');const v=await import('./app/helpers/credential.helper.js');db.prepare('INSERT INTO users(username,password,username_hash,nickname,latitude,longitude,service_days_total,service_days_used,service_status) VALUES(?,?,?,?,0,0,7,2,?)').run(v.encryptCredential('CLI-dummy-username'),v.encryptCredential('CLI-dummy-password'),v.createCredentialLookup('CLI-dummy-username'),'Snapshot User','active');db.prepare('INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)').run('timezone_active','Asia/Makassar','2026-10-14 08:00:00');db.close();`;
const initialized=await run(['--input-type=module','-e',initialize]);assert.equal(initialized.code,0,initialized.output);
const active=path.join(sandbox,'database/db.sqlite');
const baseline=path.join(sandbox,'baseline.sqlite');fs.copyFileSync(active,baseline);
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function reset(overrides = {}) {
  for(const suffix of ['','-wal','-shm']){const f=active+suffix;if(fs.existsSync(f))fs.unlinkSync(f);}
  fs.copyFileSync(baseline,active);envFile(overrides);
  fs.writeFileSync(path.join(sandbox,'.secrets/credential.key'),key);
  fs.mkdirSync(path.join(sandbox,'cookies'),{recursive:true});
  fs.writeFileSync(path.join(sandbox,'cookies/1.json'),'dummy-cookie-file');
}
const results=[];
async function test(name, fn) {
  try {await fn();results.push({name,result:'PASS'});}
  catch(error){results.push({name,result:'FAIL',evidence:error.message});}
  console.log(`${results.at(-1).result} ${name}`);
}
const cli=(name,args=[],extra={})=>run([`scripts/admin-${name}.js`],args,extra);
const files=()=>fs.existsSync(path.join(sandbox,'backups/database'))?fs.readdirSync(path.join(sandbox,'backups/database')).filter(f=>f.endsWith('.sqlite')):[];
function noRestoreTemps(){assert.ok(!fs.readdirSync(path.join(sandbox,'database')).some(n=>n.startsWith('.restore-')||n==='.admin-restore-lock.tmp'));}
function assertUnchanged(before){assert.equal(hash(active),before);assert.equal(fs.readFileSync(path.join(sandbox,'cookies/1.json'),'utf8'),'dummy-cookie-file');noRestoreTemps();}

for(const name of ['diagnostics','backup','restore'])await test(`help-${name}`,async()=>{assert.equal((await cli(name,['--help'])).code,0);});
await test('diagnostics-offline-readonly-and-redaction',async()=>{
 reset();const before=hash(active);const r=await cli('diagnostics');assert.equal(r.code,0,r.output);assert.match(r.output,/CREDENTIAL_VAULT = READY/);assert.match(r.output,/TIMEZONE_ACTIVE = Asia\/Makassar/);assert.match(r.output,/LIVE_HTTP = UNAVAILABLE/);assert.equal(hash(active),before);
});
await test('diagnostics-missing-key-does-not-generate-key',async()=>{
 reset();fs.unlinkSync(path.join(sandbox,'.secrets/credential.key'));const r=await cli('diagnostics');assert.equal(r.code,1);assert.match(r.output,/INVALID_OR_MISSING/);assert.equal(fs.existsSync(path.join(sandbox,'.secrets/credential.key')),false);
});
await test('diagnostics-invalid-config',async()=>{reset({MAX_CONCURRENT:'6'});const r=await cli('diagnostics');assert.equal(r.code,1);assert.match(r.output,/MAX_CONCURRENT = INVALID/);});
await test('diagnostics-runtime-endpoints',async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(req.url.endsWith('ready')?503:200);res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{reset({PORT:String(server.address().port)});const r=await cli('diagnostics');assert.equal(r.code,0,r.output);assert.match(r.output,/LIVE_HTTP = 200/);assert.match(r.output,/READY_HTTP = 503/);}finally{await new Promise(r=>server.close(r));}
});
await test('backup-offline-integrity-retention-and-unique-files',async()=>{
 reset();for(let i=0;i<6;i++){const r=await cli('backup');assert.equal(r.code,0,r.output);}assert.equal(files().length,4);assert.equal(new Set(files()).size,4);
 for(const name of files()){const db=new Database(path.join(sandbox,'backups/database',name),{readonly:true});assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();}
 assert.ok(!fs.readdirSync(path.join(sandbox,'backups/database')).some(n=>/-wal$|-shm$/.test(n)));
 assert.equal(fs.existsSync(path.join(sandbox,'backups/database/.snapshot-lock.tmp')),false);
});
await test('backup-online-WAL-sees-committed-data',async()=>{
 reset();const writer=new Database(active);writer.pragma('journal_mode = WAL');writer.prepare('UPDATE users SET nickname=?').run('Live WAL User');
 try{const r=await cli('backup');assert.equal(r.code,0,r.output);const newest=files().sort((a,b)=>fs.statSync(path.join(sandbox,'backups/database',b)).mtimeMs-fs.statSync(path.join(sandbox,'backups/database',a)).mtimeMs)[0];const db=new Database(path.join(sandbox,'backups/database',newest),{readonly:true});assert.equal(db.prepare('SELECT nickname FROM users').get().nickname,'Live WAL User');db.close();}finally{writer.close();}
});
await test('backup-manual-allowed-when-scheduler-backup-disabled',async()=>{reset({DB_BACKUP_ENABLED:'false'});const r=await cli('backup');assert.equal(r.code,0,r.output);});
await test('backup-invalid-retention',async()=>{reset({DB_BACKUP_RETENTION_COUNT:'0'});const before=files().length;assert.equal((await cli('backup')).code,1);assert.equal(files().length,before);});
await test('backup-shared-lock-refusal',async()=>{reset();const lock=path.join(sandbox,'backups/database/.snapshot-lock.tmp');fs.writeFileSync(lock,'dummy-owner');try{const r=await cli('backup');assert.equal(r.code,1);assert.equal(fs.readFileSync(lock,'utf8'),'dummy-owner');}finally{fs.unlinkSync(lock);}});
await test('backup-restore-lock-refusal',async()=>{reset();const lock=path.join(sandbox,'database/.admin-restore-lock.tmp');fs.writeFileSync(lock,'dummy-owner');try{assert.equal((await cli('backup')).code,1);}finally{fs.unlinkSync(lock);}});

for(const [name,make,overrides,args] of [
 ['wrong-key',()=>baseline,{CREDENTIAL_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64')},['--confirm','RESTORE']],
 ['missing-key',()=>{fs.unlinkSync(path.join(sandbox,'.secrets/credential.key'));return baseline;},{},['--confirm','RESTORE']],
 ['corrupt-file',()=>{const f=path.join(sandbox,'corrupt.sqlite');fs.writeFileSync(f,'not-sqlite');return f;},{},['--confirm','RESTORE']],
 ['incompatible-schema',()=>{const f=path.join(sandbox,'old-schema.sqlite');const db=new Database(f);db.exec('CREATE TABLE unrelated(id INTEGER)');db.close();return f;},{},['--confirm','RESTORE']],
 ['plaintext-credential',()=>{const f=path.join(sandbox,'plaintext.sqlite');fs.copyFileSync(baseline,f);const db=new Database(f);db.prepare('UPDATE users SET password=?').run('dummy-plaintext');db.close();return f;},{},['--confirm','RESTORE']],
 ['missing-confirmation',()=>baseline,{},[]],
 ['active-db-as-source',()=>active,{},['--confirm','RESTORE']],
])await test(`restore-reject-${name}`,async()=>{reset(overrides);const before=hash(active),source=make();const r=await cli('restore',[source,...args]);assert.equal(r.code,1,r.output);assertUnchanged(before);});
await test('restore-reject-active-port',async()=>{
 const server=http.createServer((req,res)=>res.end('dummy'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{reset({PORT:String(server.address().port)});const before=hash(active);const r=await cli('restore',[baseline,'--confirm','RESTORE']);assert.equal(r.code,1);assertUnchanged(before);}finally{await new Promise(r=>server.close(r));}
});
await test('restore-reject-backup-lock',async()=>{
 reset();const before=hash(active);const lock=path.join(sandbox,'backups/database/.snapshot-lock.tmp');fs.writeFileSync(lock,'other-owner');
 try{assert.equal((await cli('restore',[baseline,'--confirm','RESTORE'])).code,1);assertUnchanged(before);assert.equal(fs.readFileSync(lock,'utf8'),'other-owner');}finally{fs.unlinkSync(lock);}
});
await test('restore-reject-existing-restore-lock',async()=>{
 reset();const before=hash(active);const lock=path.join(sandbox,'database/.admin-restore-lock.tmp');fs.writeFileSync(lock,'other-owner');
 try{assert.equal((await cli('restore',[baseline,'--confirm','RESTORE'])).code,1);assert.equal(hash(active),before);assert.equal(fs.readFileSync(lock,'utf8'),'other-owner');}finally{fs.unlinkSync(lock);}
});
if(process.platform==='win32'){
 await test('restore-reject-owned-process',async()=>{reset();const before=hash(active);assert.equal((await cli('restore',[baseline,'--confirm','RESTORE'],{CLI_PROCESS:'owned'})).code,1);assertUnchanged(before);});
 await test('restore-ignore-unrelated-absolute-process',async()=>{reset();const r=await cli('restore',[baseline,'--confirm','RESTORE'],{CLI_PROCESS:'unrelated'});assert.equal(r.code,0,r.output);});
}
await test('restore-rollback-preserves-active-data-on-install-failure',async()=>{
 reset();const before=hash(active);const r=await cli('restore',[baseline,'--confirm','RESTORE'],{CLI_FAULT:'install'});assert.equal(r.code,1);assertUnchanged(before);
});
await test('restore-rollback-preserves-active-data-after-install',async()=>{
 reset();const before=hash(active);const r=await cli('restore',[baseline,'--confirm','RESTORE'],{CLI_FAULT:'manifest'});assert.equal(r.code,1);assertUnchanged(before);
});
await test('restore-success-data-cookies-env-key-and-archive',async()=>{
 reset();const db=new Database(active);db.prepare('UPDATE users SET nickname=?,service_days_used=?').run('New Active User',5);db.close();
 const envHash=hash(path.join(sandbox,'.env')),keyHash=hash(path.join(sandbox,'.secrets/credential.key'));
 const r=await cli('restore',[baseline,'--confirm','RESTORE']);assert.equal(r.code,0,r.output);
 const restored=new Database(active,{readonly:true});assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');assert.equal(restored.prepare('SELECT nickname FROM users').get().nickname,'Snapshot User');assert.equal(restored.prepare('SELECT service_days_used FROM users').get().service_days_used,2);restored.close();
 assert.equal(hash(path.join(sandbox,'.env')),envHash);assert.equal(hash(path.join(sandbox,'.secrets/credential.key')),keyHash);assert.equal(fs.existsSync(path.join(sandbox,'cookies')),false);
 const directories=fs.readdirSync(path.join(sandbox,'backups/restore')).map(n=>path.join(sandbox,'backups/restore',n));
 const archive=directories.find(d=>{
   if(!JSON.parse(fs.readFileSync(path.join(d,'manifest.json'))).completed)return false;
   const old=new Database(path.join(d,'db.sqlite'),{readonly:true});
   try{return old.prepare('SELECT nickname FROM users').get().nickname==='New Active User';}finally{old.close();}
 });
 assert.ok(archive);assert.equal(fs.readFileSync(path.join(archive,'cookies/1.json'),'utf8'),'dummy-cookie-file');noRestoreTemps();
});
fs.writeFileSync(path.join(sandbox,'test-results.json'),JSON.stringify(results,null,2));
const failures=results.filter(r=>r.result==='FAIL');console.log(`${results.length-failures.length} PASS / ${failures.length} FAIL\nEvidence: ${sandbox}`);
for(const failure of failures)console.log(`${failure.name}: ${failure.evidence}`);
if(failures.length)process.exitCode=1;
