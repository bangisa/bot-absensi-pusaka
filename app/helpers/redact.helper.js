import { maskUsername } from './credential.helper.js';

const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pwd', 'token', 'access_token', 'refresh_token',
  'authorization', 'cookie', 'cookies', 'secret', 'app_secret',
  'credential', 'credentials', 'credential_key', 'encryption_key',
  'username_hash',
]);

function redactString(value) {
  return String(value)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|pwd|token|access_token|refresh_token|secret|cookie|cookies|username|credential|credential_key|encryption_key)\s*[:=]\s*)[^&\s,}]+/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^,\s]+/gi, '$1[REDACTED]')
    .replace(/encv1:[A-Za-z0-9_:-]+/g, '[ENCRYPTED_CREDENTIAL]');
}

function redactValue(value, key = '', seen = new WeakSet()) {
  if (value == null) return value;

  const normalizedKey = String(key).toLowerCase();

  if (normalizedKey === 'username') {
    try {
      return maskUsername(value);
    } catch {
      return '[MASKED]';
    }
  }

  if (SENSITIVE_KEYS.has(normalizedKey)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message || ''),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, '', seen));
  }

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactValue(childValue, childKey, seen);
  }
  return output;
}

function redactSensitive(value) {
  return redactValue(value);
}

export { redactSensitive, redactString };
