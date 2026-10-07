import bcrypt from 'bcrypt';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

try {
  const password = await rl.question('Password admin: ');
  if (!password || password.length < 8) {
    throw new Error('Password admin minimal 8 karakter.');
  }

  const confirm = await rl.question('Ulangi password admin: ');
  if (password !== confirm) {
    throw new Error('Konfirmasi password tidak cocok.');
  }

  const hash = await bcrypt.hash(password, 12);
  output.write(`\nADMIN_PASSWORD_HASH=${hash}\n`);
} catch (err) {
  console.error(`\nGagal: ${err.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
