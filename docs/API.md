# ANJEMIN REST API v0.1

Base URL lokal: `http://localhost:3000/api`. Semua POST mengirim body `Content-Type: application/json`. Sesi dibawa oleh cookie `anjemin_session` HttpOnly. Prototipe menggunakan status HTTP 400/401/403/404/409/429 sesuai kasus.

## Publik / autentikasi

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/config` | Maps key browser dan status koneksi Maps/Places, support |
| POST | `/auth/otp/request` | `{phone}` → SMS Twilio atau OTP di console dev |
| POST | `/auth/otp/verify` | `{phone,code}` |
| POST | `/auth/signup` | Fullname, username, email, phone, password, role; Penganjem: ktm_photo, campus_email, vehicle, sim_type (A/C), sim_photo, sim_declared (true); foto data URI JPG/PNG/WebP, maks 4 MB per foto |
| POST | `/auth/login` | `{identifier,password}` — username/email |
| POST | `/auth/logout` | Hapus cookie & sesi |
| GET | `/auth/me` | Akun saat ini |

## Customer, Marketplace, dan Referral

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/account/vouchers` | Voucher milik user |
| GET | `/listings` | Barang AVAILABLE yang sudah dipublikasikan |
| GET | `/listings/mine` | Barang milik akun login |
| POST | `/listings` | `{title,category,price,description,images}`; simpan belum tayang + invoice biaya upload Rp3.000 |
| GET / POST | `/listings/:id/publication-payment` | Pemilik memeriksa / membuat invoice upload QRIS; invoice yang sama dipakai ulang |
| POST | `/listings/:id/publication-payment/simulate` | Pemilik menguji pembayaran, hanya simulasi nonproduksi |
| POST | `/listings/:id/buy` | Reservasi COD; optional `{agreed_price}` jika seller telah offer lewat chat |
| POST | `/listings/:id/complete` | Seller mengonfirmasi COD selesai, tanpa komisi penjualan |
| POST | `/listings/:id/cancel` | Batalkan reservasi |
| POST | `/chat/start` | `{listing_id}` membuat / memperoleh conversation |
| GET | `/chat` | Daftar chat user |
| GET | `/chat/:id/messages` | Riwayat pesan dua pihak |
| POST | `/chat/:id/messages` | `{body,offer_amount?}` |
| GET | `/orders/mine` | Order milik customer atau driver |
| POST | `/orders` | `{type,pickup,destination,fare,notes?,voucher_id?, ...}`; `type=DELIVERY` perlu `item_name,item_category,item_weight,image`; `type=JASTIP` perlu `item_name`, `place_id` opsional |
| POST | `/orders/:id/cancel` | Customer batalkan saat OPEN, voucher dikembalikan |
| GET | `/places?q=...&lat=...&lng=...` | Google Places Text Search & skor internal |
| GET | `/image/:filename` | File gambar listing publik; KTM privat hanya admin |

## Driver

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/driver/ready` | `{ready:true/false}` hanya APPROVED |
| GET | `/driver/jobs` | Order OPEN untuk driver APPROVED+Ready |
| GET | `/driver/stream` | Server Sent Events `new-order` khusus driver siap |
| POST | `/orders/:id/claim` | Claim atomik, hanya satu driver menang |
| POST | `/orders/:id/complete` | Menandai COMPLETED, catat komisi dan trigger referral |

## Admin / Pengelola

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/admin/overview` | Statistik, driver, ledger (admin only) |
| POST | `/admin/drivers/:id/status` | `{status:'APPROVED'|'REJECTED'}` |
| POST | `/admin/ledger/:id/collected` | `{amount}`; catat penerimaan komisi setelah diverifikasi manual |

## Skema database

`users`, `sessions`, `signup_otp`, `listings`, `conversations`, `messages`, `vouchers`, `service_orders`, `ledger`, `referral_awards`.

> Foto KTM dan SIM tidak dipublikasikan di website. Akses `/api/image/private-*` memerlukan sesi ADMIN dan nama berkas yang terhubung ke dokumen KTM atau SIM pengguna. Pendaftaran menerima total payload hingga 12 MB untuk dua foto dalam format base64. Jenis SIM juga muncul pada rekap data pengguna khusus ADMIN.


## Profil Customer dan Penganjem

- `GET /api/account/profile`: identitas dan kontak akun sendiri; sesi CUSTOMER/DRIVER.
- `POST /api/account/profile`: `full_name`, `username`, `email`, `phone`, opsional `photo` (data URI JPG/PNG/WebP, maksimal 4 MB). Akun baru wajib foto saat menyelesaikan profil. Perubahan telepon memerlukan OTP baru melalui endpoint OTP yang tersedia.
- `GET /api/users/:id/profile`: profil pengguna bagi pengguna yang login: hanya nama, username, role, status Penganjem, dan foto. Email, telepon, password, KTM, serta SIM tidak disertakan.
- Foto `avatar-*` hanya dilayani untuk pengguna yang login dan berkas yang terhubung ke akun, dengan cache `no-store`.
- Akun baru menerima `profile_complete: false` sampai menyimpan profil. Operasi transaksi ditolak dengan `409 PROFILE_INCOMPLETE` selama profil belum selesai. Akses profil, OTP, keluar akun, dan halaman informasi tetap tersedia. Akun yang dibuat sebelumnya tetap dapat menggunakan fitur seperti biasa.

## Chat pesanan dan lampiran

- `GET /api/orders/:id/messages?after=0`: riwayat bertahap, identitas kedua pihak, serta `media_usage` (`used`, `remaining`, `limit`). Batas lampiran 3 * 1024 * 1024 byte untuk gabungan Customer dan Penganjem dalam satu pesanan.
- `POST /api/orders/:id/messages`: teks `body` opsional jika ada `media` berupa data URI JPG/PNG/WebP/GIF/MP4/WebM. Lampiran memakai `request_id` acak 16-80 karakter untuk retry tanpa duplikasi; caption maksimal 1000 karakter.
- `GET /api/orders/:id/media/:filename`: lampiran privat bagi kedua peserta pesanan. Berkas harus terhubung ke pesanan tersebut; bukan URL gambar publik. Respons memakai `no-store` dan mendukung byte range untuk video.
- Kuota diperiksa dalam satu transaksi database agar kiriman bersamaan tidak melewati 3 MB. Media masih dapat dibaca setelah pesanan selesai, sedangkan pesan baru ditolak. Riwayat teks lama tetap tersimpan.

### Status checklist chat pesanan

Setiap pesan menyimpan `delivered_at` dan `read_at` dari waktu server. Satu centang berarti pesan tersimpan; dua centang berarti browser penerima mengakui penerimaan; dua centang biru berarti pesan terlihat dalam chat yang terbuka, tab terlihat, dan dokumen memiliki fokus.

- `GET /api/account/order-chat/inbox`: pesan yang belum dikonfirmasi diterima, khusus akun penerima.
- `POST /api/account/order-chat/delivered`: `{message_ids:[...]}`; hanya penerima, maksimal 200 ID per permintaan.
- `POST /api/orders/:id/messages/read`: `{message_ids:[...]}`; hanya penerima pesan dalam pesanan tersebut. Membaca juga menandai diterima.
- `GET /api/orders/:id/messages`: menyertakan `receipts` untuk pesan milik pengirim, sehingga perubahan checklist tetap diterima walaupun tidak ada pesan baru.
- Waktu konfirmasi pertama tetap dipertahankan, dan status dibaca tidak diturunkan oleh konfirmasi diterima yang terlambat. Pembaruan UI berjalan melalui polling chat dan inbox.


## Pencapaian Penganjem (simulasi)

- `GET /api/driver/achievements`: khusus DRIVER aktif. Mengembalikan jumlah anjeman valid, target berikutnya, nominal sudah diklaim/siap diklaim, serta status dan progres setiap milestone.
- `POST /api/driver/achievements/:milestone/claim`: khusus DRIVER yang disetujui dan sudah melengkapi profil jika diwajibkan. Target dan nominal selalu ditentukan server; body boleh kosong. Respons berisi reward, `alreadyClaimed`, dan pencapaian terbaru. Retry dan permintaan bersamaan tidak menggandakan saldo.
- Milestone satu kali seumur akun: `RIDE_10` Rp5.000, `RIDE_25` Rp7.500, `RIDE_50` Rp10.000, `RIDE_100` Rp15.000, `RIDE_250` Rp25.000, `RIDE_500` Rp50.000. Nominal adalah bonus tambahan per target; total seluruh bonus Rp112.500.
- Hanya RIDE berstatus COMPLETED, pembayaran RELEASED, dan kredit saldo yang cocok dengan driver/pembayaran/mode yang dihitung. Pesanan sendiri, batal, belum dibayar, atau layanan lain tidak dihitung. Progres kumulatif, tanpa reset bulanan.
- Klaim hanya aktif pada PAYMENT_MODE=SIMULATION dan bukan production. Bonus disimpan terpisah dari pendapatan pesanan dan saldo live, masuk riwayat `/api/driver/wallet` sebagai `kind: REWARD`, dan jumlahnya tersedia pada field `rewards`.
- Statistik keuntungan Pengelola menampilkan reward yang diklaim sebagai biaya, mengikuti mode dan tanggal klaim dalam WIB. Reward mengurangi profit tanpa menambah jumlah atau nilai transaksi. Skema nominal ini merupakan konfigurasi uji; evaluasi terhadap komisi layanan 6% serta biaya operasional sebelum mengaktifkan reward nyata.
