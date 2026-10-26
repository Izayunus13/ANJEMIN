# ANJEMIN — Peta Fitur, Alur, dan Prioritas Iterasi

## Pengguna dan hak akses

| Aktor | Masuk | Dashboard | Hak utama |
|---|---|---|---|
| CUSTOMER | username/email + password | Dashboard customer | Order, GPS, marketplace, jual, chat, referral |
| DRIVER | username/email + password | Dashboard penganjem | Upload KTM saat daftar, admin approval, Ready, claim order, marketplace |
| ADMIN | username/email + password dari bootstrap env | Dashboard pengelola | Verifikasi KTM, persetujuan, ledger komisi |

Tidak ada cara mendaftarkan akun ADMIN lewat request signup API. Driver belum disetujui tidak bisa mengaktifkan Ready maupun menarik order.

## Flow daftar akun

Landing → login popup → Daftar → Pilih Customer/Driver → Masukkan nomor → Kirim OTP → Verifikasi → Lengkapi data (Penganjem perlu foto KTM/email kampus/kendaraan/pilihan SIM A atau C/foto SIM/deklarasi SIM) → Akun dibuat → Masuk sesuai role → Driver menunggu APPROVED → Ready.

## Flow layanan

1. Customer klik Anjem/Barang/Jastip.
2. Isi pickup dan destination; GPS opsional. Barang mewajibkan nama, kategori, berat, dan foto. Jastip mengisi barang yang akan dititip, dapat mencari tempat melalui Places.
3. Pilih voucher, tambahkan catatan dan tarif simulasi.
4. Order OPEN masuk realtime ke Driver APPROVED+Ready.
5. Driver tercepat yang menjalankan klaim berhasil → status CLAIMED.
6. Driver menyelesaikan → COMPLETED → ledger komisi 6% dibuat.
7. Untuk promo referral, setelah order RIDE pertama pengguna undangan selesai, pengajak diberikan voucher Rp300.

## Flow marketplace

Seller upload foto, judul, tipe, harga, keterangan → AVAILABLE → Buyer Beli/Reservasi atau Tawar → Jika tawar, start chat + pesan + penawaran harga → Seller dapat menawarkan nominal deal lewat chat → Buyer reservasi di harga deal → status RESERVED → COD offline → Seller konfirmasi selesai → SOLD dan ledger 3% maksimal Rp20.000.

Batasan: reservasi tidak sama dengan pembayaran, dan komisi masih perlu ditagih; belum ada payment gateway, moderasi otomatis, escrow, atau logistik otomatis dari marketplace.

## Rekomendasi tempat Jastip

- Query pencarian melalui Places Text Search API (New), hasil disertai bintang/rating dan jumlah ulasan Google.
- Penjumlahan popularitas internal berdasarkan `service_orders` JASTIP berstatus COMPLETED dengan `place_id` sama.
- Formula: `0.65*(rating/5) + 0.20*min(log10(ulasan+1)/4,1) + 0.15*min(pesanan_selesai/25,1)`.
- Jangan mengklaim skor sebagai peringkat resmi Google; hindari cache data Places melebihi ketentuan layanan. Pada MVP tidak menyimpan rating ke database.

## Sprint berikutnya (belum dibangun)

1. Integrasi payment gateway partner berizin (QRIS/VA split settlement) dan rekonsiliasi otomatis.
2. Moderasi listing (laporan pengguna, admin takedown, konten terlarang, counterfeit).
3. Tracking posisi driver live selama perjalanan, mekanisme SOS, rating driver, kode penyelesaian dan audit sengketa.
4. Otomatis menghitung harga perjalanan menggunakan Directions/Routes API dan tarif legal, bukan pengguna mengisi nominal secara manual.
5. Verifikasi identitas lebih kuat: pemeriksaan KTM, SIM, STNK yang sah dan persetujuan operator.
6. Ongkir dan kapasitas kendaraan, pembatasan barang berbahaya, perlindungan pesanan jastip.
7. Refund, pemrosesan tiket dan riwayat komplain, tampilan riwayat transaksi marketplace.
8. Migrasi PostgreSQL + penyimpanan privat cloud, backup dan auto-deletion.
9. Komponen desain visual spesifik brand, custom illustrations & gerakan scooter terpisah, halaman kampanye referral, PWA install/offline.
10. Notifikasi push nyata saat website ditutup: membutuhkan service worker, VAPID, backend push provider, izin pengguna.

## Kriteria sebelum MVP dianggap layak rilis publik

- Pendaftaran PSE yang berlaku, kewajiban marketplace menurut Permendag 19/2026, persyaratan transportasi dan izin usaha sesuai model.
- Kebijakan privasi final mencantumkan pengendali data yang jelas, kontak nyata, dasar hukum, retensi, dan akses pengguna.
- Provider SMS sudah aktif; tidak pakai OTP console.
- Backend berada pada hosting persisten, HTTPS, backup, disaster recovery, audit dan keamanan diuji.
- SOP penumpang/driver dan asuransi/penanganan insiden disiapkan.


## Profil akun

Customer dan Penganjem memiliki menu Profil Saya. Akun baru diarahkan untuk mengonfirmasi nama lengkap, username, nomor telepon aktif, email aktif, dan mengunggah foto profil sebelum menggunakan fitur transaksi. Data kontak dari pendaftaran otomatis terisi. Mengganti nomor telepon memerlukan OTP ke nomor baru. Nama, username, dan foto ditampilkan pada identitas pesanan dan chat, sedangkan kontak tetap hanya untuk pemilik akun dan Pengelola.


## Tampilan Jasa Titip Customer

Halaman Jasa Titip Customer memakai tiga tahap: Lokasi belanja, Titipan & antar, lalu Cek pesanan. Customer dapat mencari toko jika pencarian tersedia atau mengisi nama/alamat secara manual. Memilih hasil pencarian hanya mengisi toko, bukan mengirim pesanan. Mengubah nama/alamat toko menghapus identitas dan koordinat hasil pencarian yang sudah tidak sesuai.

GPS pada tahap kedua khusus alamat antar. Alamat dan koordinat toko tetap terpisah dari lokasi Customer. Alamat manual tetap bisa dipakai jika GPS atau pencarian tidak tersedia. Ringkasan mengikuti isian, tarif jasa, dan voucher; harga barang dijelaskan terpisah dari tarif jasa. Customer dapat kembali atau menekan Ubah untuk mengecek detail sebelum Cari Penganjem membuat pesanan melalui API yang sudah ada. Alur ini tetap menggunakan pembayaran simulasi yang berlaku saat ini.
