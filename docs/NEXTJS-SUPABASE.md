# Next.js dan Supabase

ANJEMIN sekarang memakai Next.js App Router untuk halaman, metadata, CSS, dan aset.
Tampilan JavaScript yang ada dimuat setelah hidrasi. Sumber tampilannya tetap
`client/app.js`, `client/styles.css`, dan `client/index.html` (ikon dan tema).

## Menjalankan

Gunakan Node.js 22.13+:

```sh
npm ci
npm run dev
```

Buka http://localhost:3000. Untuk build produksi:

```sh
npm run build
npm start
```

`predev` dan `prebuild` menyalin aset sumber ke `public/` yang diabaikan Git.
Setelah mengubah `client/app.js` atau gambar saat dev, jalankan `npm run assets`
dan muat ulang browser. CSS dan komponen Next.js memakai hot reload.
Server lama masih dapat dijalankan terpisah dengan `npm run dev:legacy`.

## Konfigurasi Supabase

Isi `.env.local` (diabaikan Git):

```ini
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Kedua nilai ini memang dapat dipakai browser. Jangan gunakan service-role atau
secret key sebagai variabel `NEXT_PUBLIC_*`.

- `utils/supabase/client.ts`: client untuk komponen browser.
- `utils/supabase/server.ts`: client per request untuk Server Components/Route Handlers,
  dengan cookie store opsional.
- `utils/supabase/middleware.ts`: verifikasi dan refresh sesi melalui `getClaims()`;
  meneruskan cookie baru ke request dan response serta header anti-cache.
- `proxy.ts`: menjalankan helper tersebut pada Next.js 16, kecuali aset statis.
- `GET /api/supabase/session`: memeriksa konfigurasi dan status sesi Supabase
  tanpa mengembalikan token atau mewajibkan tabel contoh.

Contoh Server Component:

```tsx
import { createClient } from '@/utils/supabase/server';

export default async function Example() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('todos').select('id, name');
  if (error) throw error;
  return <ul>{data.map(todo => <li key={todo.id}>{todo.name}</li>)}</ul>;
}
```

Contoh ini baru bisa digunakan setelah tabel `todos` dibuat dan aksesnya diatur
dengan Row Level Security di Supabase. Halaman utama tetap menampilkan ANJEMIN.

## Batas migrasi database dan akun

Pemasangan SDK tidak memindahkan tabel, akun, password hash, sesi, atau unggahan.
API ANJEMIN masih menggunakan SQLite, cookie `anjemin_session`, dan file lokal.
Adapter `pages/api/[...path].js` mempertahankan API tersebut pada Next.js lokal
atau host Node dengan disk persisten. Body parser dinonaktifkan agar parsing JSON,
unggahan, dan webhook tetap ditangani kode server yang ada.

Supabase Auth menggunakan cookie sendiri; login ANJEMIN belum membuat sesi
Supabase, dan sesi Supabase belum memberikan peran CUSTOMER/DRIVER/ADMIN ANJEMIN.
Pemeriksaan sesi Supabase tidak menggantikan otorisasi API ANJEMIN.

Pada Vercel, adapter API lama mengembalikan HTTP 503 dengan kode
`PERSISTENT_BACKEND_REQUIRED`, agar tidak membuat database sementara yang
kehilangan data. Halaman Next.js dan endpoint sesi Supabase dapat dideploy.
Untuk seluruh fitur produksi, langkah berikutnya harus dilakukan:

1. Buat skema PostgreSQL Supabase, kebijakan RLS, dan storage bucket privat/publik.
2. Ubah query SQLite sinkron dan transaksi menjadi akses PostgreSQL yang sesuai;
   pertahankan klaim order atomik, peran admin, dan aturan saldo/pembayaran.
3. Migrasikan data serta unggahan, dan tentukan alur perpindahan akun/password.
4. Ganti adapter API lama setelah endpoint Supabase selesai diuji.

Publishable key saja tidak memberi hak membuat skema atau memigrasikan data.
Jangan menonaktifkan RLS untuk menghindari pembatasan tersebut.

## Vercel

- Root Directory: root repositori.
- Framework Preset: Next.js.
- Build Command: `npm run build`.
- Output Directory: `.next` atau default Next.js.
- Tambahkan kedua variabel Supabase di Environment Variables Vercel.
- Konfigurasikan URL aplikasi dan redirect Supabase Auth sesuai domain.
- Redeploy setelah variabel diubah; nilai `NEXT_PUBLIC_*` dimasukkan saat build.

`.env.local` hanya dipakai lokal dan tidak otomatis tersedia pada Vercel.
Jangan menjalankan `npm run dev` sebagai build command.

## Pemeriksaan

Jalankan `npm run check`, `npm test`, dan `npm run test:e2e`. Pengujian browser memakai Edge pada Windows, atau Chromium Playwright pada sistem lain (`npx playwright install chromium`). API pengujian memakai folder sementara terpisah dari data lokal.

Build dan dev menggunakan Webpack agar paket API Node lama tetap dieksekusi sebagai paket eksternal. Data lokal, unggahan, dan file env dikecualikan dari bundel server.

## Akses halaman publik di Vercel

`GET /api/config` adalah Route Handler Next.js yang tidak membuka SQLite. Halaman publik dapat dibuka tanpa database lokal atau variabel Supabase. Ketika backend persisten belum tersedia di Vercel, halaman tidak memanggil API sesi lama atau membuka form login otomatis. Tombol akun memberi tahu pengguna bahwa layanan akun belum tersedia.

Jalankan `npm run test:vercel` untuk membangun dan menguji server produksi dengan `VERCEL=1`, termasuk tidak adanya request startup yang gagal.
