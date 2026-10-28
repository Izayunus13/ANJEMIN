# Next.js dan Supabase PostgreSQL

ANJEMIN memakai Next.js App Router untuk halaman dan API adapter untuk aturan bisnis yang ada.
Akun, sesi, pesanan, saldo, dan unggahan disimpan di PostgreSQL jika DATABASE_URL dikonfigurasi.
Tidak ada pemblokiran akun atau API berdasarkan Vercel.

## Konfigurasi server

Simpan DATABASE_URL dari Supabase Connect → Transaction pooler di .env.local dan
Environment Variables Production Vercel. URI ini mengandung password; jangan memakai
awalan NEXT_PUBLIC dan jangan commit file env.

Database aplikasi berada pada skema privat anjemin (bisa diganti dengan ANJEMIN_DB_SCHEMA).
Hak akses publik pada skema tersebut dicabut; API server tetap memeriksa sesi dan peran.
Sertifikat CA Supabase di server/certs/supabase-ca.crt adalah sertifikat publik.
Koneksi memverifikasi TLS dan memakai pengaturan transaksi lokal agar sesuai dengan transaction pooler.

## Migrasi data lokal

Preview: npm run migrate:postgres
Terapkan ke database tujuan kosong: npm run migrate:postgres -- --apply

Migrasi menyalin akun dan password hash yang ada, nomor akun, sesi, pesanan, saldo,
serta gambar/media lokal. Penyalinan data berada dalam satu transaksi, jumlah baris
diverifikasi, dan sumber SQLite tetap utuh. Migrasi berhenti jika tabel pengguna
tujuan sudah terisi.

Media disimpan sebagai bytea pada tabel stored_files agar tidak bergantung pada disk
sementara Vercel. Hak akses dokumen, profil, dan chat tetap diperiksa oleh endpoint yang ada.

## Menjalankan

npm ci
npm run dev

Build produksi: npm run build
Server produksi: npm start

Tanpa DATABASE_URL, pengembangan lokal dapat memakai SQLite.
ANJEMIN_DB_DRIVER=sqlite memilih SQLite secara eksplisit.
Driver pglite hanya dipakai pengujian PostgreSQL di memori.

## Pemeriksaan

npm run check
npm test
npm run test:e2e
npm run test:vercel

Tes Vercel menjalankan build produksi dengan PostgreSQL terisolasi dan memastikan
form masuk/daftar serta API autentikasi tidak diblokir oleh platform.
Untuk SMS OTP produksi dan pembayaran nyata, konfigurasi penyedia yang digunakan
aplikasi masih diperlukan.

## SDK Supabase

NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY digunakan oleh
helper SDK browser/server dan proxy sesi Supabase. Variabel tersebut terpisah dari
DATABASE_URL. Akun ANJEMIN menggunakan tabel aplikasi, password hash dan cookie
anjemin_session yang dipertahankan selama migrasi. Supabase Auth memiliki sesi terpisah.

## Vercel

Framework: Next.js. Root Directory: root repositori.
Build Command: npm run build. Output Directory: default Next.js atau .next.
Isi DATABASE_URL dengan URI pooler yang sudah diuji, kemudian redeploy.
APP_URL dapat diisi domain utama; origin deployment dan domain produksi Vercel
yang disediakan melalui variabel sistem juga diterima.
