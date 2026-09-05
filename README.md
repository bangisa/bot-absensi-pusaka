# Bot Absensi Pusaka

Dashboard lokal untuk mengelola pengguna, membuat jadwal presensi harian, menjalankan antrean automation, dan memantau status bot.

## Fitur

- Generator jadwal harian dengan waktu acak per pengguna.
- Executor berbasis antrean dengan batas concurrency.
- Dashboard status scheduler, browser, queue, memory, dan jadwal harian.
- Manajemen user dengan nickname.
- Log presensi dengan pagination dan filter.
- Deteksi hari libur nasional Indonesia melalui API eksternal.
- Penyimpanan lokal menggunakan SQLite.

## Teknologi

- Node.js
- Express
- SQLite via `better-sqlite3`
- Puppeteer
- node-cron
- PM2 untuk deployment production

## Persiapan

```bash
npm install
cp .env.example .env
```

Isi `.env` sesuai environment lokal atau server. Jangan commit `.env`, database runtime, cookie browser, atau file credential.

## Menjalankan

```bash
npm start
```

Mode development:

```bash
npm run dev
```

Aplikasi berjalan pada port yang ditentukan oleh `PORT`, default `3000`.

## Struktur Penting

```text
app/
  config/       Konfigurasi environment
  controllers/  Handler request
  helpers/      Helper umum
  models/       Query SQLite
  routes/       Route Express
  services/     Scheduler, queue, browser, dan automation
database/       Inisialisasi SQLite
public/         Dashboard frontend
scripts/        Script utilitas
```

## Keamanan Repo Publik

File berikut sengaja tidak disimpan di Git:

- `.env`
- `cookies/`
- `database/*.sqlite`
- `database/*.db`
- `*.pem`, `*.key`, dan file credential lain
- file catatan lokal seperti `element-pusaka.txt`

Jika sebelumnya file sensitif pernah terlanjur masuk commit, bersihkan juga history Git sebelum mengubah repository menjadi public.
