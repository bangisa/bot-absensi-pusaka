# Bot Absensi Pusaka

Bot Absensi Pusaka adalah aplikasi automation privat untuk mengelola jadwal dan menjalankan presensi melalui browser terkontrol. Dashboard internal menyediakan pemantauan antrean, hasil eksekusi, pengguna, dan kesehatan runtime.

## Fitur

- Jadwal acak per pengguna, pemulihan pemicu generator yang terlewat, dan retry dengan jitter.
- Antrean per pengguna dengan batas concurrency yang dapat diatur dari dashboard.
- Dashboard responsif untuk scheduler, browser, jadwal harian, audit, dan kesehatan sistem.
- Tambah, edit, dan hapus user dengan nickname serta credential terenkripsi. Password lama tidak dikirim ke frontend.
- Paket 1, 7, 30, 90 hari layanan atau tak terbatas. Masuk dan pulang pada hari yang sama dihitung satu hari; hari libur tidak mengurangi kuota.
- Kalender libur dengan provider fallback dan pengaturan URL kalender JSON yang didukung.
- Pengaturan timezone dengan tanggal dan jam sesuai wilayah, konfirmasi restart aplikasi melalui PM2, serta layar tunggu sampai aplikasi kembali tersedia.
- Pengaturan operasional tersimpan di database: radius geolokasi 0-200 meter, backup aktif/nonaktif, retention 1-8 file, dan retensi log presensi 3 atau 7 hari.
- Log dengan pagination, filter, normalisasi status, dan redaksi data sensitif.
- Backup SQLite mingguan dan manual, dengan default retention 4 file.
- Login admin, CSRF protection, pembatasan percobaan login, dan dukungan HTTPS melalui reverse proxy.
- Graceful shutdown yang menunggu antrean dan retry selesai sebelum menutup resource.

## Tampilan

Screenshot menggunakan data demo, bukan identitas atau hasil presensi produksi.

### Dashboard

![Dashboard](docs/screenshots/dashboard.png)

### Users

![Users](docs/screenshots/users.png)

### Edit User

![Edit User](docs/screenshots/user-edit.png)

### Logs

![Logs](docs/screenshots/logs.png)

## Teknologi

- Node.js
- Express
- SQLite via `better-sqlite3`
- Puppeteer
- node-cron
- PM2 untuk deployment production

## Persiapan

```bash
npm ci
cp .env.example .env
npm run admin:hash
```

Pada PowerShell, gunakan `Copy-Item .env.example .env`. Jangan menimpa konfigurasi yang sudah digunakan.

Sesuaikan konfigurasi sebelum menjalankan:

| Konfigurasi | Fungsi |
| --- | --- |
| `BASE_URL_PUSAKA` | URL upstream Pusaka, bukan alamat dashboard |
| `APP_BASE_URL` | Origin aplikasi/dashboard |
| `APP_SECRET` | Secret sesi unik untuk instalasi |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | Login admin; gunakan hash hasil CLI |
| `TZ` | Timezone operasional, default `Asia/Jakarta` |
| `AUTO_START` | Default `false`; aktifkan setelah konfigurasi diverifikasi |
| `MAX_CONCURRENT` | Batas awal antrean, 1 sampai 5 |

`.env.example` menggunakan baseline production HTTPS melalui reverse proxy loopback. Untuk development HTTP lokal, ikuti blok penyesuaian di akhir file tersebut; jangan hanya mengubah `NODE_ENV`.

Pertahankan credential key yang sama saat deploy atau restore agar credential tersimpan tetap dapat dibaca. Simpan `.env`, key, database, cookies, dan backup secara privat, di luar Git.

## Menjalankan

```bash
npm start
```

Mode development:

```bash
npm run dev
```

Aplikasi berjalan pada port yang ditentukan oleh `PORT`, default `3000`.

Perubahan timezone dari dashboard memerlukan scheduler berhenti, queue/browser selesai, dan tidak ada jadwal pending/processing. Setelah disimpan, konfirmasikan restart atau gunakan tombol Restart Aplikasi kemudian. Restart otomatis memerlukan PM2 dengan autorestart aktif; jadwal dan log lama tidak dikonversi. Dengan `AUTO_START=false`, jalankan scheduler kembali setelah restart.

## Pengaturan Operasional

Pengaturan pada dashboard tersimpan di `system_settings` dan tetap tersedia setelah restart. Concurrency, kalender JSON, serta pengaturan operasional diterapkan tanpa restart; timezone diterapkan setelah restart.

| Pengaturan | Pilihan | Penerapan |
| --- | --- | --- |
| Radius geolokasi | 0-200 meter | Proses automation berikutnya; 0 tanpa offset acak |
| Backup otomatis | Aktif atau nonaktif | Mengatur layanan backup runtime, termasuk ketersediaan tombol Backup |
| Jumlah backup disimpan | 1-8 file, default 4 | Pembersihan setelah snapshot baru berhasil dibuat |
| Retensi log presensi | 3 atau 7 hari, default 3 | Cleanup berikutnya; tidak mengubah retensi audit atau log server |

Nilai database mengambil prioritas atas default `.env` tanpa menulis ulang file tersebut. Cron dan folder backup, credential, pengaturan sesi, serta `AUTO_START` tetap dikelola melalui `.env`. CLI `admin:backup` masih memakai retention dari `.env`, bukan pengaturan runtime dashboard.

Dashboard menampilkan enam card ringkasan dalam satu baris pada desktop dan menyesuaikan menjadi 3, 2, atau 1 kolom pada layar lebih kecil. Card operasional menggunakan dua kolom pada desktop dan satu kolom pada layar kecil.

## Pengujian Lokal

Suite berikut menggunakan sandbox/data dummy tanpa menjalankan presensi nyata:

```bash
node scripts/regression/dashboard.mjs
node scripts/regression/user-service.mjs
node scripts/regression/calendar-settings.mjs
node scripts/regression/generator-recovery.mjs
```

Perbarui screenshot dari frontend aktual dengan API simulasi:

```bash
node scripts/documentation-screenshots.mjs
```
