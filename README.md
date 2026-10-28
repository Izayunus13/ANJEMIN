# ANJEMIN — MVP Full-Stack (Customer · Penganjem · Pengelola)

> **Migrasi Next.js + Supabase:** jalankan `npm ci` lalu `npm run dev`. Build produksi: `npm run build` dan `npm start`. Baca [panduan migrasi](docs/NEXTJS-SUPABASE.md) untuk konfigurasi dan batas API SQLite di Vercel. Panduan server Node lama di bawah masih berlaku melalui `npm run dev:legacy` / `npm run start:legacy`.

**Tagline:** *Mager? Anjemin Aja!*  
**Watermark:** `by ANJEMINAJA`  
**Versi:** `0.1.0` — **prototipe fungsional untuk pengembangan lokal**, bukan sistem transportasi komersial siap produksi.

Satu folder ini memuat **frontend**, **backend**, **database otomatis**, serta dokumentasi untuk pengembangan lanjutan di VS Code. Tidak perlu npm install untuk menjalankan inti sistem. Stack: HTML5, CSS3, JavaScript modular tanpa framework, Node.js `http` native, SQLite bawaan `node:sqlite`, EventSource/SSE, dan Web API browser.

> Persyaratan Node.js **22.13+** (direkomendasikan Node.js 22 LTS). Modul `node:sqlite` masih memiliki peringatan eksperimental pada sebagian versi Node. Untuk deployment serius, pindahkan data ke PostgreSQL dan tinjau ulang keamanan/kepatuhan.

## 1. Cara menjalankan di VS Code (Windows PowerShell)

1. Extract file ZIP proyek. Buka folder `anjemin-fullstack` menggunakan **File → Open Folder** di VS Code.
2. Install **Node.js 22 LTS / versi 22.13+** dari nodejs.org bila belum ada; verifikasi:

   ```powershell
   node -v
   npm -v
   ```

3. Duplikasi `.env.example` menjadi `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env` terlebih dahulu, khususnya:
   - `ADMIN_EMAIL` — email pengelola yang kamu pilih.
   - `ADMIN_USERNAME` — username pengelola.
   - `ADMIN_PASSWORD` — **password unik minimal 12 karakter**, jangan gunakan teks placeholder.
   - `ADMIN_PHONE` — satu nomor pengelola yang benar (format `628...`).
   - Pada tahap awal, biarkan `NODE_ENV=development`.

5. Buka terminal VS Code di **folder root** `anjemin-fullstack` dan jalankan:

   ```powershell
   npm start
   ```

   Atau untuk reload backend saat mengedit:

   ```powershell
   npm run dev
   ```

6. Buka browser `http://localhost:3000`.
7. Popup login muncul pertama kali bila belum ada sesi. Kamu dapat klik **Daftar akun** untuk menjadi Customer/Penganjem. Akun **Pengelola tidak dibuat dari signup**, hanya bootstrap saat server pertama kali dijalankan menggunakan `.env`.
8. Pendaftaran melalui **OTP development**: setelah klik *Kirim kode OTP*, lihat **terminal tempat `npm start` berjalan**; kode 6 digit akan muncul dalam log terminal. Masukkan kode itu di web lalu verifikasi. Mode ini **hanya untuk eksperimen lokal** dan sama sekali **tidak membuktikan nomor tersebut aktif**.
9. Untuk mencoba akun Pengelola, login dengan `ADMIN_EMAIL`/`ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.env`.
10. Untuk menghentikan server: `Ctrl+C`.

**Catatan:** Tidak perlu menjalankan frontend terpisah. Satu server Node mengirim HTML/CSS/JS dan API dari port `3000`.

## 2. File dan fungsinya

```text
anjemin-fullstack/
├── .env.example                 # Daftar konfigurasi, tanpa kunci pribadi
├── .gitignore                   # Data, gambar privat, kredensial tidak masuk Git
├── package.json                 # Scripts npm, tanpa dependency eksternal
├── README.md                    # Panduan ini
├── client/
│   ├── index.html               # Struktur web + ikon SVG
│   ├── styles.css               # UI lavender-peach, responsive, light/dark, animasi
│   ├── app.js                   # Halaman, interaksi, REST, popup, peta, SSE
│   ├── favicon.svg              # Favicon brand
│   └── public/
│       └── anjemin-logo.png     # Logo ANJEMIN pilihan final percakapan
├── server/
│   ├── src/
│   │   ├── index.js             # HTTP server, REST endpoint, Google Places, SSE, aturan order
│   │   ├── db.js                # Tabel otomatis + bootstrap admin
│   │   ├── security.js          # Hash password, login cookie, validasi, rate-limit
│   │   └── upload.js            # Simpan gambar listing/KTM dengan path privat
│   ├── data/                    # SQLite terbuat otomatis (jangan commit)
│   ├── uploads/                 # Foto terbuat otomatis (jangan commit)
│   └── tests/security.test.js   # Unit test dasar Node
└── docs/
    ├── FITUR-DAN-ALUR.md        # Status, hak akses, rencana lanjut
    └── API.md                   # Daftar endpoint
```

## 3. Kebutuhan yang telah dimasukkan

| Area | Isi MVP | Status |
|---|---|---|
| Landing | Banner utama, ilustrasi/logo motor, mockup HP, promo/referral, animasi | Berfungsi |
| Navigasi | Menu tiga garis kiri atas, hide/unhide sidebar, responsif mobile | Berfungsi |
| Tema | Light/dark mode disimpan di browser | Berfungsi |
| Akun | Popup login pertama, login username/email, daftar Customer/Driver | Berfungsi |
| Telepon | Nomor unik di database, OTP development / integrasi Twilio opsional | Dev berjalan, SMS perlu penyedia |
| Driver | Foto KTM dan SIM privat, email kampus, kendaraan, pilihan SIM A/C, deklarasi SIM, admin approval | Berfungsi untuk uji |
| Pemesanan | Form Anjem, Anjemin Barang + foto/berat, Jastip + barang | Berfungsi untuk uji |
| Ready driver | Saklar hijau/merah, SSE event order baru, klaim cepat database atomic | Berfungsi untuk uji |
| Marketplace | Upload foto, nama, kategori, harga, keterangan, daftar produk | Berfungsi untuk uji |
| Negosiasi | Chat dua arah, penawaran nominal, reservasi barang/COD | Berfungsi untuk uji |
| Google Maps | Peta, GPS, titik tujuan, Google Places rating + urut popularitas | Menunggu API key aktif |
| Referral | Kode otomatis per akun, voucher Rp500 pengguna baru + Rp300 pengajak | Berfungsi untuk uji |
| Komisi | Anjem/Barang/Jastip 6%; Lapak 3% maks Rp20.000 | Pencatatan, bukan pemungutan dana |
| Pengelola | Persetujuan driver, statistik, ledger komisi, konfirmasi penerimaan manual | Berfungsi untuk uji |
| Legal | Kebijakan privasi dan syarat orisinal berbentuk draf | Perlu ditinjau sebelum rilis |

## 4. Google Maps dan Google Places

Pada tahap awal peta akan menampilkan instruksi jika belum ada kredensial. Agar peta dan rekomendasi tempat benar-benar aktif:

1. Buka **Google Cloud Console** → buat project → sambungkan akun billing dan atur **budget alerts/quotas**.
2. Aktifkan **Maps JavaScript API**, **Geocoding API**, dan **Places API (New)**.
3. Buat **dua API key terpisah**:
   - Key browser, batasi pada HTTP referrers `http://localhost:3000/*` dan domain produksimu, serta restrict ke Maps JavaScript API/Geocoding sesuai pemakaian.
   - Key server, batasi penggunaan pada Places API (New); untuk deployment gunakan server IP restriction bila memungkinkan, dan jangan pernah menaruh key server di JavaScript klien.
4. Isi `.env`:

   ```ini
   GOOGLE_MAPS_BROWSER_KEY=KUNCI_BROWSER_MU
   GOOGLE_PLACES_SERVER_KEY=KUNCI_SERVER_MU
   ```

5. Restart server. Masuk sebagai Customer → klik Anjemin, Anjemin Barang, atau Jasa Titip. Form memiliki peta; ketuk titik peta untuk lokasi tujuan atau klik tombol GPS untuk lokasi jemput.
6. Pada Jasa Titip, sistem otomatis mencari kata “makanan” dan kamu bisa mencari tempat lain secara manual. Endpoint `/api/places` memakai **Google Places Text Search (New)** dan meminta `rating` serta `userRatingCount`.
7. Urutan rekomendasi transparan: **65% rating bintang** + **20% volume ulasan Google** + **15% popularitas Jastip ANJEMIN yang selesai**. Ini rancangan algoritma internal, bukan klaim algoritma Google. Relevansi kategori, jarak, ulasan ekstrem, dan perlindungan manipulasi skor akan ditambahkan di tahap berikutnya.

Google memerlukan billing dan menerapkan biaya menurut API dan field yang diminta. Jangan memakai API key tanpa restriction dan batas penggunaan. Lihat dokumentasi resmi Google di bagian referensi.

## 5. SMS OTP nyata dengan Twilio Verify

Tanpa Twilio, kode OTP hanya ada di terminal saat `NODE_ENV=development`; karena itu **belum cocok untuk publik**. Untuk SMS sungguhan, daftarkan Twilio Verify Service dan isi:

```ini
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
```

Backend memanggil endpoint Twilio Verify (send/check), bukan mengirim SMS dari browser. Dalam `NODE_ENV=production`, signup akan ditolak bila provider belum tersedia. Penggunaan SMS memerlukan saldo provider, kebijakan antifraud dan rate limiting tambahan.

## 6. Perbedaan hak akses

- **Customer:** mengakses dashboard, memesan Anjem/Anterin/Jastip, mencari tempat, memasang dan membeli barang, bernegosiasi, menggunakan voucher, serta memantau order.
- **Penganjem:** registrasi KTM, menunggu approval admin; setelah disetujui dapat mengaktifkan Ready, melihat order terbuka, melakukan klaim, menyelesaikan order; juga dapat bertransaksi marketplace.
- **Pengelola:** hanya akun yang ditanam dari `.env`, dapat melihat KTM, menyetujui/menolak driver, membaca ringkasan usaha, dan mencatat pembayaran komisi yang benar-benar sudah diterima.

**Klaim order:** SQL `UPDATE ... WHERE status='OPEN' ...` dilakukan di dalam transaksi `BEGIN IMMEDIATE`. Hanya satu driver berhasil; driver kedua memperoleh HTTP `409 Conflict`.

## 7. Referral dan simulasi komisi

- ANJEM: `Math.round(fare * 0.06)` → perjalanan nominal Rp6.000 menghasilkan komisi tercatat Rp360.
- Lapak: `Math.min(Math.round(actualPrice * 0.03), 20000)` → barang Rp200.000 pada harga deal Rp180.000 menghasilkan komisi Rp5.400.
- Pemilik kode mengajak pengguna baru → pengguna baru mendapat voucher Rp500 untuk 7 hari.
- Setelah pengguna undangan **menyelesaikan order RIDE pertama** → pengajak mendapat voucher Rp300, tidak lebih dari sekali untuk pengguna undangan tersebut.
- Voucher diterapkan ke jumlah yang dibayar pembeli; bagian driver (dalam simulasi) tetap berdasarkan tarif asli. Subsidi voucher dicatat sebagai pengeluaran promosi yang dapat membuat margin platform negatif.
- **Ledger tidak terhubung ke payment gateway**: angka komisi sebagai *piutang/kewajiban penagihan*, bukan otomatis uang masuk rekening. Pengelola baru menekan *Catat diterima* setelah transaksi pembayaran telah diverifikasi di luar sistem.

## 8. Menjalankan pengujian

```powershell
npm run check
npm test
```

Pengujian `npm test` memeriksa hashing password, normalisasi telepon, nominal, dan keberadaan tabel. Kami juga menguji manual alur HTTP: admin login, nomor duplikat ditolak, driver pending ditolak Ready, persetujuan admin, menerima/menyelesaikan order, klaim kedua ditolak `409`, listing, chat tawar, reservasi dan komisi marketplace. Semua alur inti tersebut berjalan di server lokal dalam pemeriksaan ini.

## 9. Konfigurasi penyimpanan / deployment

**MVP ini memakai SQLite lokal dan file upload lokal.** Cocok untuk belajar dan uji coba di laptop, VPS/VM tunggal, atau mesin yang memiliki volume persisten. Jangan deploy langsung ke **Vercel Functions** dengan SQLite/uploads lokal yang dianggap permanen: serverless filesystem bersifat sementara, sehingga gambar dan database berisiko hilang.

Untuk produksi sesungguhnya, disarankan:

- Migrasi SQLite → **PostgreSQL** ber-backup; penyimpanan file → **S3-compatible object storage** yang privat untuk KTM.
- Gunakan **HTTPS**, domain resmi, environment secrets, rotasi password, perangkat admin dengan MFA, proteksi CSRF lintas origin yang ketat, upload scanning dan monitoring.
- Implementasi penghapusan data, perubahan password, pemulihan akun, moderasi produk, pembatasan usia, audit log, dispute/refund, perlindungan pembayaran, dan penanganan darurat keselamatan driver.
- Siapkan SOP operasional dan review legalitas perdagangan/transportasi. Tarif Rp6.000 **hanya contoh UI**, bukan jaminan sesuai tarif yang diperbolehkan.
- Keandalan realtime multi-server: pindahkan SSE ke sistem event pub/sub (Redis / message broker), atur rate limiter terpusat.

## 10. Referensi teknis / regulasi untuk kajian lanjutan

- Google Maps JavaScript API — https://developers.google.com/maps/documentation/javascript/get-api-key
- Google Places API New — https://developers.google.com/maps/documentation/places/web-service/text-search
- Google Maps Pricing — https://developers.google.com/maps/billing-and-pricing/pricing
- Pendaftaran PSE Privat — https://pse.komdigi.go.id/panduan/kriteria-pendaftaran-pse-lingkup-privat
- **Permendag No. 19 Tahun 2026** (menggantikan Permendag No. 31 Tahun 2023) — https://jdih.kemendag.go.id/peraturan/peraturan-menteri-perdagangan-republik-indonesia-nomor-19-tahun-2026-tentang-penyelenggaraan-usaha-perdagangan-melalui-sistem-elektronik-1
- UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi — https://peraturan.go.id/

### Tentang halaman referensi yang dikirim

Halaman privasi `anjem.me` digunakan untuk memahami **jenis topik yang perlu ada** (data penumpang, driver, lokasi, hak pengguna). Teks kebijakan dalam kode ANJEMIN **ditulis baru dan disesuaikan** dengan sistem yang benar-benar dibangun. **Jangan** memakai identitas pengelola, alamat kontak, dan nama badan layanan lain; isilah milik pengelola ANJEMIN sendiri.

---

**Developed by ANJEMINAJA** · ANJEMIN prototype 2026.


## Pembayaran layanan dan saldo penganjem

Pesanan layanan baru: penganjem menerima -> customer membuat invoice -> pembayaran
terverifikasi -> dana tertahan -> penganjem melaporkan pengantaran selesai ->
customer mengonfirmasi -> pendapatan bersih tercatat di saldo tersedia.

Default lokal: PAYMENT_MODE=SIMULATION. Tidak menghasilkan QRIS bank dan tidak
memindahkan uang. Customer menggunakan tombol simulasi pada detail pembayaran.
Simulasi tidak dapat dipakai dengan NODE_ENV=production. Saldo simulasi,
sandbox, dan live dipisahkan. Pesanan lama tetap memakai catatan sebelumnya.

Integrasi Midtrans:
https://docs.midtrans.com/reference/qris
https://docs.midtrans.com/docs/https-notification-webhooks

Buat akun Midtrans, aktifkan QRIS, isi PAYMENT_MODE=MIDTRANS_SANDBOX dan
MIDTRANS_SERVER_KEY di .env (jangan di chat), lalu restart server.
Atur Notification URL di dashboard Midtrans:
https://DOMAIN-ANJEMIN/api/payments/midtrans/notification
URL harus dapat dijangkau publik; localhost tidak dapat menerima webhook.
Cek status di aplikasi juga memverifikasi langsung ke gateway.
MIDTRANS_LIVE hanya digunakan setelah akun merchant dan operasional siap.

Invoice berlaku 15 menit. Invoice gagal/kedaluwarsa atau request gateway yang
belum menghasilkan transaksi memerlukan penanganan pengelola; pembuatan ulang
otomatis belum tersedia. Sistem tidak mengirim charge kedua ketika respons
gateway tidak pasti. Refund, sengketa, biaya gateway, dan transfer saldo ke
rekening belum diimplementasikan. Saldo tersedia adalah pencatatan internal,
bukan bukti transfer bank atau layanan escrow dari gateway.
Komisi layanan tetap 6%; voucher disubsidi platform sehingga bagian penganjem
adalah fare-platform_fee. Dana promo harus tersedia saat pencairan sungguhan.

Komisi simulasi dan sandbox tidak masuk ke ledger komisi sungguhan.
