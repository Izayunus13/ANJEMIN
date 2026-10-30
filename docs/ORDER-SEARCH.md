# Countdown pencarian Penganjem

Berlaku untuk pemesanan ANJEMIN, Jasa Titip dan ANJEMIN Barang. Setelah order dibuat, Customer melihat countdown **03:00** di Riwayat pesanan. Jika belum ada Penganjem menerima ketika waktu habis, pencarian berhenti dan tombol **Order Ulang** muncul. Menekan tombol memulai putaran 3 menit berikutnya; dapat diulangi sampai diterima atau dibatalkan.

Batas waktu disimpan di server melalui service_orders.search_expires_at dan search_attempt. Reload atau pindah tab tidak memberi waktu baru. Respons GET /api/orders/mine menyertakan server_time dan search; browser menghitung waktu dari jam server dan waktu monotonik perangkat. Tampilan diperbarui setiap detik, sedangkan status pesanan diperbarui melalui polling yang sudah tersedia.

Order Ulang memperbarui pesanan yang sama. Rute, foto, rincian barang, nominal, dan voucher dipertahankan; tidak membuat invoice, menduplikasi pesanan, atau mereset pembayaran. Order tetap OPEN saat waktu pencarian habis, sehingga Customer dapat melanjutkan pencarian atau membatalkan. Penganjem tidak dapat melihat/mengambil pencarian yang kedaluwarsa sampai Customer menekan Order Ulang. Setelah order diterima, dibatalkan, atau selesai, countdown dan tombol hilang.

POST /api/orders/:id/retry menerima {search_attempt: <putaran yang tampil>}. Hanya pemilik pesanan yang dapat melanjutkan pencarian. Request sebelum waktunya ditolak. Pengulangan request putaran yang sama bersifat idempoten: hanya satu permintaan memperpanjang batas waktu, termasuk dua klik bersamaan. Pemeriksaan ini berada dalam transaksi database bersama pembaruan status, sehingga retry tidak dapat menghidupkan kembali order yang sudah diambil atau dibatalkan.

Migrasi skema versi 3 memberi pesanan OPEN yang sudah ada satu jendela pencarian baru saat pertama migrasi. Riwayat selain OPEN tidak diubah. Penerimaan Penganjem memeriksa batas waktu secara atomik. Voucher tetap terikat sepanjang putaran pencarian dan dapat kembali melalui pembatalan pesanan seperti sebelumnya.
