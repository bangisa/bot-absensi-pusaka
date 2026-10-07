import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Import configuration and middleware only: no database, browser or scheduler.
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: 'production', APP_SECRET: 'dummy-only-secret-for-url-tests-32-chars',
  ADMIN_USERNAME: 'dummy', ADMIN_PASSWORD_HASH: '$2b$12$dummy',
  BASE_URL_PUSAKA: 'https://pusaka.invalid', APP_BASE_URL: 'https://dashboard.invalid',
  TRUST_PROXY: 'loopback', FORCE_HTTPS: 'true', SESSION_COOKIE_SECURE: 'true',
  SESSION_SAME_SITE: 'lax', LOGIN_RATE_LIMIT_WINDOW_MS: '900000',
  LOGIN_RATE_LIMIT_MAX: '5', LOGIN_LOCKOUT_MS: '900000', HSTS_MAX_AGE_SECONDS: '31536000',
};
delete env.BASE_URL;
const prelude = `
  import assert from 'node:assert/strict';
  const { validateProductionSecurityConfig } = await import('./app/services/production-security.service.js');
  const { browserConfig } = await import('./app/config/browser.config.js');
  const { enforceHttps } = await import('./app/middleware/proxy-security.middleware.js');
`;
let count = 0;
function check(name, overrides, code, expectedError) {
  const childEnv = { ...env, ...overrides };
  for (const key of Object.keys(childEnv)) if (childEnv[key] === null) delete childEnv[key];
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', prelude + code], {
    cwd: root, env: childEnv, encoding: 'utf8', timeout: 10000,
  });
  if (expectedError) {
    assert.notEqual(result.status, 0, name);
    assert.ok(result.stderr.includes(expectedError), name);
  } else assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  count++;
  console.log(`PASS ${name}`);
}
check('separate origins and safe HTTPS redirect', {}, `
  assert.equal(validateProductionSecurityConfig().ok, true);
  assert.equal(browserConfig.baseUrl, 'https://pusaka.invalid');
  const res = { redirect(status, url) {
    assert.equal(status, 308);
    assert.equal(url, 'https://dashboard.invalid/login?next=%2F');
  }};
  enforceHttps({method:'GET',secure:false,originalUrl:'/login?next=%2F'},res,()=>assert.fail());
`);
check('HTTP mutations are not redirected', {}, `
  let rejected = 0;
  for (const method of ['POST','PUT','DELETE']) {
    enforceHttps({method,secure:false}, {
      status(code) { assert.equal(code,426); return this; },
      json(body) { assert.equal(body.code,'HTTPS_REQUIRED'); rejected++; }
    },()=>assert.fail());
  }
  assert.equal(rejected,3);
`);
check('HTTPS passes through', {}, `
  let passed = false;
  enforceHttps({method:'GET',secure:true},{},()=>passed=true);
  assert.equal(passed,true);
`);
check('upstream HTTP independent of dashboard HTTPS', {BASE_URL_PUSAKA:'http://pusaka.invalid'}, 'validateProductionSecurityConfig();');
check('dashboard HTTP rejected with FORCE_HTTPS', {APP_BASE_URL:'http://dashboard.invalid'}, 'validateProductionSecurityConfig();', 'APP_BASE_URL must use https');
check('secure cookie validates dashboard URL independently', {APP_BASE_URL:'http://dashboard.invalid',FORCE_HTTPS:'false'}, 'validateProductionSecurityConfig();', 'APP_BASE_URL must use https when SESSION_COOKIE_SECURE=true');
check('local HTTP profile', {APP_BASE_URL:'http://localhost:3000',FORCE_HTTPS:'false',SESSION_COOKIE_SECURE:'false',TRUST_PROXY:'false'}, 'validateProductionSecurityConfig();');
for (const url of ['invalid','ftp://dashboard.invalid','https://user:pass@dashboard.invalid','https://dashboard.invalid/path','https://dashboard.invalid/?a=1','https://dashboard.invalid/#part']) {
  check('invalid dashboard origin', {APP_BASE_URL:url}, 'validateProductionSecurityConfig();', 'APP_BASE_URL');
}
check('invalid upstream rejected', {BASE_URL_PUSAKA:'invalid'}, 'validateProductionSecurityConfig();', 'BASE_URL_PUSAKA');
check('no legacy upstream fallback', {BASE_URL_PUSAKA:null,BASE_URL:'https://legacy.invalid'}, '', 'Missing required env: BASE_URL_PUSAKA');
check('no dashboard fallback', {APP_BASE_URL:null,BASE_URL:'https://legacy.invalid'}, '', 'Missing required env: APP_BASE_URL');
console.log(`${count} URL configuration checks passed; no external requests performed.`);
