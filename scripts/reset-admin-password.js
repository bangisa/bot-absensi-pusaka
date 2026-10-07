import bcrypt from 'bcrypt';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const ENV_PATH = path.resolve('.env');
const rl = readline.createInterface({ input, output });

function replaceOrAppendEnv(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, line);
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : '\n';
  return `${source}${suffix}${line}\n`;
}

try {
  let envText;
  try {
    envText = await fs.readFile(ENV_PATH, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error('File .env tidak ditemukan. Jalankan command ini dari root project.');
    }
    throw err;
  }

  output.write('Reset Password Admin — Bot Absensi Pusaka\n');
  output.write('Aplikasi sebaiknya dalam keadaan STOP sebelum reset.\n\n');

  const password = await rl.question('Password admin baru: ');
  if (!password || password.length < 8) {
    throw new Error('Password admin minimal 8 karakter.');
  }

  const confirm = await rl.question('Ulangi password admin baru: ');
  if (password !== confirm) {
    throw new Error('Konfirmasi password tidak cocok.');
  }

  const hash = await bcrypt.hash(password, 12);
  const updated = replaceOrAppendEnv(envText, 'ADMIN_PASSWORD_HASH', hash);
  await fs.writeFile(ENV_PATH, updated, { encoding: 'utf8', mode: 0o600 });

  output.write('\n✅ Password admin berhasil direset di .env.\n');
  output.write('Jalankan/restart aplikasi agar hash baru aktif.\n');
} catch (err) {
  console.error(`\n❌ Reset gagal: ${err.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
