import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENCRYPTION_PREFIX = "encv1";
const KEY_DIR = path.resolve(process.cwd(), ".secrets");
const KEY_PATH = path.join(KEY_DIR, "credential.key");

let cachedKey = null;

function decodeConfiguredKey(value) {
  if (!value) return null;

  const normalized = String(value).trim();

  // Prefer base64, but also accept a 64-char hex key for convenience.
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  try {
    const key = Buffer.from(normalized, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function loadCredentialKey() {
  if (cachedKey) return cachedKey;

  const configuredKey = decodeConfiguredKey(
    process.env.CREDENTIAL_ENCRYPTION_KEY,
  );

  if (configuredKey) {
    cachedKey = configuredKey;
    return cachedKey;
  }

  if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY harus berupa 32-byte base64 atau 64 karakter hex",
    );
  }

  fs.mkdirSync(KEY_DIR, { recursive: true });

  if (fs.existsSync(KEY_PATH)) {
    const raw = fs.readFileSync(KEY_PATH, "utf8").trim();
    const storedKey = decodeConfiguredKey(raw);

    if (!storedKey) {
      throw new Error(`Credential key tidak valid: ${KEY_PATH}`);
    }

    cachedKey = storedKey;
    return cachedKey;
  }

  const generatedKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, generatedKey.toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  console.log(`[SECURITY] Credential key dibuat di ${KEY_PATH}`);
  console.log(
    "[SECURITY] Simpan file key ini dengan aman. Tanpanya credential terenkripsi tidak dapat dipulihkan.",
  );

  cachedKey = generatedKey;
  return cachedKey;
}

function isEncryptedCredential(value) {
  return typeof value === "string" && value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

function encryptCredential(value) {
  if (value == null) return value;

  const plaintext = String(value);

  if (isEncryptedCredential(plaintext)) {
    return plaintext;
  }

  const key = loadCredentialKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptCredential(value) {
  if (value == null) return value;

  const encoded = String(value);

  // Backward compatibility during migration / rollback windows.
  if (!isEncryptedCredential(encoded)) {
    return encoded;
  }

  const parts = encoded.split(":");

  if (parts.length !== 4 || parts[0] !== ENCRYPTION_PREFIX) {
    throw new Error("Format credential terenkripsi tidak valid");
  }

  try {
    const key = loadCredentialKey();
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    throw new Error(
      "Credential tidak dapat didekripsi. Pastikan credential key yang digunakan adalah key yang sama saat data dienkripsi.",
      { cause: err },
    );
  }
}

function createCredentialLookup(value) {
  const plaintext = decryptCredential(value);
  const key = loadCredentialKey();

  return crypto
    .createHmac("sha256", key)
    .update(String(plaintext).trim().toLowerCase(), "utf8")
    .digest("hex");
}

function maskUsername(value) {
  if (value == null || value === "") return null;

  const username = decryptCredential(value);
  const text = String(username);

  if (text.length <= 4) {
    return `${text.slice(0, 1)}***`;
  }

  if (text.length <= 8) {
    return `${text.slice(0, 2)}***${text.slice(-1)}`;
  }

  return `${text.slice(0, 4)}****${text.slice(-2)}`;
}

function hydrateUserCredentials(user) {
  if (!user) return user;

  return {
    ...user,
    username: decryptCredential(user.username),
    password: decryptCredential(user.password),
  };
}

function toPublicUser(user) {
  if (!user) return user;

  const hydrated = hydrateUserCredentials(user);

  return {
    id: hydrated.id,
    nickname: hydrated.nickname,
    usernameMasked: maskUsername(hydrated.username),
    credentialConfigured: Boolean(hydrated.username && hydrated.password),
    latitude: hydrated.latitude,
    longitude: hydrated.longitude,
    auto_login: hydrated.auto_login,
  };
}

export {
  createCredentialLookup,
  decryptCredential,
  encryptCredential,
  hydrateUserCredentials,
  isEncryptedCredential,
  loadCredentialKey,
  maskUsername,
  toPublicUser,
};
