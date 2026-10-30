# Perbaikan performa

Log server pengembangan menunjukkan pembacaan daftar pesanan memerlukan sekitar 16?33 detik di kode aplikasi, dengan permintaan yang mengantre mencapai 50?68 detik. Penyebab yang ditemukan: setiap order mengambil pembayaran dan dua profil lewat query terpisah, sementara adapter PostgreSQL menjalankan query secara sinkron dan polling dapat mengirim permintaan baru sebelum yang lama selesai.

Perubahan:
- orderViews membaca seluruh daftar, pembayaran, dan dua profil publik dengan satu query JOIN; tidak menyertakan kontak atau password.
- GET identik dan loadOrders berbagi permintaan yang masih berjalan. Pemanggilan loadOrders ganda setelah navigasi dihapus.
- Daftar pesanan tidak dibangun ulang jika data tetap sama; countdown tetap diperbarui setiap detik. Ini menghindari mengunduh ulang avatar privat saat polling.
- Saldo Penganjem memakai snapshot singkat; pembayaran dan penarikan tetap memaksa refresh. Polling inbox umum menjadi 15 detik, chat aktif tetap 3 detik, dan tab tersembunyi tidak menjalankan polling inbox. Pemeriksaan sesi menjadi 30 detik.
- Dua gambar dashboard turun dari 4.326.195 menjadi 555.546 byte. Ilustrasi transparan turun dari 794.117 menjadi 96.256 byte. PNG asli tetap tersedia; frontend memakai WebP. Hasil encoding disimpan di client/public dan disalin oleh assets seperti aset lain.

Mode npm run dev tetap memiliki overhead kompilasi dan pengawasan berkas. Untuk mengukur pengalaman produksi gunakan npm run build lalu npm start. Query PostgreSQL masih memakai adapter sinkron lama; optimasi ini mengurangi jumlah perjalanan database, bukan mengganti arsitektur database.

Pengujian mencakup batas satu query untuk banyak pesanan, bentuk data publik, dan satu permintaan in-flight meskipun polling berjalan ketika respons lambat.
