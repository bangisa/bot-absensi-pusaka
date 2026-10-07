import { registerHooks } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// This preload is used only by disposable regression copies.
globalThis.__regression = { launches: 0, closes: 0, jobs: [], failNext: false, calls: 0 };
const guard = (host) => {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('REGRESSION_EXTERNAL_NETWORK_BLOCKED');
};
for (const module of [http, https]) {
  const original = module.request;
  module.request = function (url, ...args) {
    guard(typeof url === 'string' || url instanceof URL ? new URL(url).hostname : url.hostname || url.host || 'localhost');
    return original.call(this, url, ...args);
  };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = typeof args[0] === 'object' ? args[0] : { host: args[1] || 'localhost' };
  if (!options.path) guard(options.host || 'localhost');
  return connect.apply(this, args);
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  guard(new URL(url).hostname);
  return nativeFetch(url, options);
};

const modules = {
  cron: `export function schedule(expression, callback, options) {
    const job = { expression, callback, options, stopped: false, stop() { this.stopped = true; } };
    globalThis.__regression.jobs.push(job); return job;
  }`,
  puppeteer: `export async function launch() {
    globalThis.__regression.launches++;
    let connected = true; let disconnected;
    return { get connected() { return connected; }, isConnected: () => connected,
      process: () => null, pages: async () => [], on: (_, fn) => { disconnected = fn; },
      close: async () => { connected = false; globalThis.__regression.closes++; disconnected?.(); },
      createBrowserContext: async () => ({ overridePermissions: async () => {}, close: async () => {},
        newPage: async () => { let closed = false; return {
          setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, setGeolocation: async () => {},
          on() {}, removeAllListeners() {}, isClosed: () => closed,
          close: async () => { closed = true; }
        }; }
      })
    };
  }`,
  auth: `export async function ensureLogin(page, user) {
    if (!user.username || !user.password) throw new Error('MOCK_USER_CONTRACT_INVALID');
  }
  export const autoLogin = ensureLogin, loginWithRetry = ensureLogin, isLoggedIn = async () => true;`,
  presence: `import { logSuccess } from '../helpers/log.helper.js';
  export async function gotoPresence() { return true; }
  export async function handlePresenceFlow(page, type, user, start) {
    globalThis.__regression.calls++;
    await new Promise(r => setTimeout(r, 25));
    if (globalThis.__regression.failNext) { globalThis.__regression.failNext = false; throw new Error('SIMULATED_FAILURE'); }
    logSuccess(type, user, start); return { status: 'success', message: 'SIMULATED_SUCCESS' };
  }
  export const getPresenceStatus = async () => ({}), clickPresensi = async () => ({}),
    clickWithRetry = async () => ({}), handleConfirm = async () => true;`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node-cron' || specifier === 'puppeteer') return { url: `regression:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'regression:node-cron') return { format: 'module', source: modules.cron, shortCircuit: true };
    if (url === 'regression:puppeteer') return { format: 'module', source: modules.puppeteer, shortCircuit: true };
    if (url.endsWith('/app/services/auth.service.js')) return { format: 'module', source: modules.auth, shortCircuit: true };
    if (url.endsWith('/app/services/presence.service.js')) return { format: 'module', source: modules.presence, shortCircuit: true };
    return next(url, context);
  },
});

process.on('message', (message) => {
  if (message === 'regression-sigterm') process.emit('SIGTERM');
  if (message === 'regression-holiday') {
    globalThis.fetch = async () => ({ ok:true, json:async () => ({ is_holiday:true, data:{name:'Test holiday'} }) });
    process.send?.('regression-holiday-ready');
  }
});
