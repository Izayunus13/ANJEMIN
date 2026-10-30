# Pemilih lokasi OpenStreetMap

Popup peta dipakai untuk jemput, antar, lokasi belanja Jastip, dan lokasi Penganjem untuk pengurutan jarak. Pengguna dapat mengetuk peta, menggeser pin, memilih tengah peta setelah menggeser tampilan, atau memakai GPS perangkat. Perubahan baru masuk ke formulir setelah tombol **Gunakan lokasi ini** ditekan. Batal dan Escape mempertahankan isian sebelumnya. Perubahan alamat secara manual menghapus koordinat lama agar titik tidak tertukar.

Alamat/patokan ditulis pengguna. Aplikasi tidak memanggil Nominatim, autocomplete, atau reverse geocoding. GPS memerlukan HTTPS atau localhost dan izin perangkat; saat izin ditolak pengguna tetap dapat memilih titik secara manual.

## Aset dan penyedia peta

Leaflet 1.9.4 disajikan dari origin aplikasi melalui skrip sinkronisasi aset (termasuk lisensinya). Tidak memerlukan Google Maps API key atau akun billing. Google Places yang sudah ada tetap merupakan integrasi terpisah dan hanya aktif jika server key dikonfigurasi.

Tile standar: https://tile.openstreetmap.org/{z}/{x}/{y}.png

Atribusi OpenStreetMap tetap terlihat pada peta. Tile hanya diminta saat pengguna membuka popup, menggunakan cache browser dan Referer biasa. Tidak ada unduhan offline, prefetch area, atau pengambilan tile oleh backend. Pembukaan peta mengirim IP, Referer origin, dan area peta yang dilihat ke penyedia tile; alamat yang diketik tidak dikirim untuk geocoding.

Tile publik adalah layanan komunitas dengan kapasitas terbatas dan tanpa SLA, bukan jaminan akses tanpa batas. Patuhi [kebijakan tile OSM](https://operations.osmfoundation.org/policies/tiles/). Untuk trafik besar gunakan penyedia yang sesuai atau hosting tile sendiri.

## Konfigurasi opsional

Variabel server **MAP_TILE_URL** mengganti endpoint tile raster tanpa perubahan kode. Gunakan template HTTPS dengan placeholder {z}, {x}, dan {y}. Nilainya dikirim ke browser melalui /api/config; jangan masukkan secret server. Tetap gunakan data OpenStreetMap dan penyedia yang menerima atribusi OSM yang ditampilkan aplikasi. Redeploy setelah mengganti environment variable di Vercel.

Tanpa konfigurasi tambahan popup langsung memakai tile standar OSM.

## Verifikasi

npm run check
npm run test:e2e
npm run build

Pengujian browser memakai Leaflet asli dan tile SVG lokal yang diintersep, sehingga tidak membebani server tile komunitas. API akun/pesanan dan GPS pada pengujian pemilih lokasi menggunakan fixture; tidak membuat pesanan produksi. Skenario mencakup pembatalan, tap, geser pin, payload koordinat, alamat manual, Jastip, penolakan GPS, akurasi GPS, hasil GPS terlambat, dan tampilan seluler.

## Rute Jemput untuk Penganjem

Pada Riwayat pesanan, tombol opsional **Rute Jemput** muncul untuk Penganjem yang menerima pesanan ketika status pesanan CLAIMED, pembayaran HELD (lunas), dan pengantaran belum dilaporkan selesai. Customer, Penganjem lain, order belum dibayar, dibatalkan, serta selesai tidak memperoleh tautan navigasi dari API.

Tombol membuka navigasi Google Maps di aplikasi yang terpasang atau tab browser. Tujuan memakai koordinat **pickup**, bukan koordinat antar. Maps memakai lokasi perangkat sebagai titik awal agar garis rute dan navigasi mengikuti GPS Penganjem; koordinat pengurutan jarak yang mungkin sudah lama tidak digunakan. Mode Motor/Barang/Jastip memakai two-wheeler dan Mobil memakai driving. Tujuan adalah titik jemput yang disimpan ketika Customer membuat pesanan, bukan pelacakan lokasi Customer secara langsung.

Jika pin GPS tidak ada atau tidak valid, Maps memakai alamat jemput dan UI meminta Penganjem memastikan titik lewat chat. Jika izin lokasi tidak diberikan atau perangkat tidak mendukung navigasi langsung, Maps dapat menampilkan pratinjau rute dan meminta titik awal. Fitur tidak menandai pesanan selesai atau mengubah pembayaran.

Tidak memerlukan API key atau backend routing baru. Lokasi tujuan dikirim ke Google hanya setelah Penganjem membuka tautan; lokasi perangkat dikelola oleh izin Google Maps. ANJEMIN tidak menambahkan penyimpanan perjalanan GPS. Referensi: [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
