# Batas pembayaran layanan: 5 menit

Setelah Penganjem menerima order Anjem, Jastip atau Anjem Barang, server menyimpan payment_deadline = waktu penerimaan + 5 menit. Kedua pihak melihat countdown yang sama. Membuat invoice belakangan tidak mereset batas waktu. Invoice QRIS menggunakan sisa waktu dari batas tersebut.

Jika belum ada invoice atau pembayaran simulasi belum lunas, order dibatalkan dengan cancel_reason=PAYMENT_TIMEOUT. Voucher dikembalikan apabila masih terikat pada order tersebut. Order yang sudah HELD/RELEASED tidak dibatalkan dan tidak terjadi refund/penarikan saldo.

Untuk Midtrans, server memeriksa status secara terautentikasi. Pembayaran settlement tetap dilindungi, termasuk saat webhook terlambat. Invoice pending dibatalkan di gateway, lalu status dibaca kembali sebelum order dibatalkan secara atomik. Jika status belum pasti atau gateway tidak merespons, order tetap menunggu verifikasi; sistem tidak menganggapnya belum dibayar hanya berdasarkan timer browser. Notifikasi service juga dikonfirmasi melalui status gateway.

Server persisten (lokal/VPS) memeriksa order lewat interval 15 detik, termasuk saat tab ditutup. Pada hosting serverless, timer proses tidak dijamin berjalan ketika tidak ada request: daftar pesanan dan endpoint pembayaran tetap merekonsiliasi deadline saat diakses. Scheduler eksternal yang memanggil expireDuePayments diperlukan bila pencatatan pembatalan harus berlangsung tanpa trafik. Batas pembayaran tetap diperiksa server sebelum invoice dibuat.

Migrasi versi 4 memberikan satu jendela 5 menit kepada pesanan CLAIMED lama yang belum lunas. Pesanan lama yang sudah lunas tidak dikenai batas pembayaran baru.

Referensi: [Custom expiry Midtrans](https://docs.midtrans.com/reference/custom-expiry-object), [Cancel transaction](https://docs.midtrans.com/reference/cancel-transaction).
