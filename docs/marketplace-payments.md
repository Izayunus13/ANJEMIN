# Biaya pasang lapak Marketplace

Customer Anjem dan Penganjem membayar **Rp3.000 per produk** untuk memasang lapak. Harga barang dibayar langsung oleh pembeli kepada penjual melalui chat atau COD. Tidak ada komisi penjualan, penahanan dana barang, atau kredit saldo penjual untuk transaksi baru.

Alur baru: isi barang dan foto → simpan lapak belum tayang → bayar invoice QRIS Rp3.000 → gateway mengonfirmasi settlement → lapak tayang. Nominal ditentukan server dan tidak mengikuti harga barang. Reservasi dapat dibatalkan tanpa menagih biaya upload lagi; biaya ini melekat pada satu lapak.

Pembayaran tertunda dapat dibuka kembali dari bagian **Lapak menunggu pembayaran** di Marketplace. Lapak belum lunas tidak muncul di daftar publik dan tidak dapat direservasi atau dihubungi melalui endpoint chat. Publikasi dan pencatatan fee dilakukan dalam satu transaksi database; notifikasi berulang tidak menambah pendapatan lagi.

## Konfigurasi QRIS

Gunakan integrasi Midtrans yang sudah dipakai pembayaran layanan:

- Lokal: `PAYMENT_MODE=SIMULATION`. Tidak menampilkan QRIS bank dan tidak menarik uang sungguhan.
- Pengujian gateway: `PAYMENT_MODE=MIDTRANS_SANDBOX` dan `MIDTRANS_SERVER_KEY` sandbox di environment server.
- Produksi: `PAYMENT_MODE=MIDTRANS_LIVE` dan server key live milik merchant yang sudah mengaktifkan QRIS.
- Notification URL: `https://DOMAIN-ANJEMIN/api/payments/midtrans/notification`.

Server memverifikasi tanda tangan notifikasi, lalu mengambil status langsung dari gateway. Publikasi hanya terjadi untuk QRIS IDR Rp3.000 yang sudah settlement. Tombol Cek status pembayaran juga melakukan verifikasi ini. QRIS memakai expiry 15 menit. Pada hasil charge yang tidak pasti, invoice disimpan dan direkonsiliasi tanpa membuat charge kedua. Invoice kedaluwarsa/gagal memerlukan bantuan Pengelola; jangan membayar ulang tanpa pemeriksaan.

Referensi resmi: [QRIS](https://docs.midtrans.com/reference/qris), [notifikasi HTTP](https://docs.midtrans.com/docs/https-notification-webhooks).

## Data dan kompatibilitas

- Kolom `listings.publication_required` bernilai 1 untuk upload baru. Listing lama tetap tayang tanpa tagihan retroaktif.
- `listing_fee_payments` menyimpan invoice tetap Rp3.000, QRIS, status dan waktu pembayaran.
- Fee upload masuk ledger `MARKET_UPLOAD`, dengan mode simulasi/sandbox/live terpisah. Volume pendapatan upload adalah Rp3.000, bukan harga jual barang.
- Reservasi baru memakai `payment_required=0`; endpoint pembayaran harga barang menolak konversi transaksi COD menjadi pembayaran website.
- Pembayaran website lama tetap dapat diselesaikan dengan serah terima, konfirmasi pembeli dan saldo lama. Riwayat dan penarikan saldo lama dipertahankan.

## Endpoint

- `POST /api/listings`: simpan lapak belum tayang dan buat invoice upload. Respons berisi `id`, `fee`, `payment`, `published` dan bila perlu `paymentError`.
- `GET /api/listings/mine`: daftar lapak sendiri beserta `publication_payment`.
- `GET /api/listings/:id/publication-payment`: cek gateway dan status publikasi (khusus pemilik).
- `POST /api/listings/:id/publication-payment`: dapatkan/buat invoice yang sama, tanpa charge kedua.
- `POST /api/listings/:id/publication-payment/simulate`: hanya pemilik, hanya mode simulasi nonproduksi.
- `POST /api/listings/:id/buy`: reservasi barang untuk chat/COD tanpa invoice harga barang.
- `POST /api/listings/:id/complete`: penjual menyelesaikan transaksi COD tanpa komisi tambahan.

Pengujian: `npm test`, `npm run check`, `npm run build`. Pengujian otomatis gateway menggunakan respons tiruan; pembayaran merchant live harus diuji dengan konfigurasi merchant sendiri.
