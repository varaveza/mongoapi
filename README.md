# mongoapi-server (Express + TypeScript)

Pengganti `api.js` untuk panel admin: melihat dan mengubah data di MongoDB.
Berjalan di VPS yang sama dengan MongoDB, terhubung langsung ke `localhost` tanpa perantara.

Bot penjualan **tidak** memakai API ini — bot menulis ke MongoDB lewat script terpisah.
Jadi perubahan di sini tidak berdampak ke jalannya bot.

---

## Kenapa ada versi baru

`api.js` yang lama memuat seluruh koleksi ke memory Node sebelum menyaring dan mengurutkan.
Dengan data ratusan juta transaksi, itu bukan sekadar lambat — proses bisa kehabisan memory.

Yang berubah:

| Bagian | api.js lama | Versi ini |
|---|---|---|
| `GET /api/orders` | `find().toArray()` seluruh koleksi, lalu diproses di JavaScript | Aggregation pipeline, semua di database |
| `GET /api/customers/:id_tele/orders` | Muat seluruh dokumen, saring di memory | Aggregation pipeline + pagination di database |
| `GET /api/riwayats` | Muat semua, saring di memory | `$filter` di dalam database |
| Hitung total + ambil data | Dua kali kerja | `$facet`, sekali jalan |
| Cek token tiap request | Selalu query MongoDB | Cache di memory (bisa dimatikan) |
| Bahasa | JavaScript | TypeScript |
| `generate-ids` | Tulis ulang seluruh array variasi | Hanya isi field `_id` yang kosong |

---

## Menjalankan

```bash
npm install
cp .env.example .env
nano .env            # minimal: MONGODB_URI dan API_KEY
npm run build
npm start
```

Untuk pengembangan (muat ulang otomatis):

```bash
npm run dev
```

---

## Dokumentasi Swagger

Ada halaman dokumentasi interaktif berisi seluruh endpoint, lengkap dengan contoh
request/response dan tombol "Try it out" untuk mencoba langsung dari browser.

Bawaannya **mati**. Nyalakan lewat `.env`:

```env
ENABLE_SWAGGER=true
SWAGGER_PATH=/docs
```

Lalu buka `http://localhost:3333/docs`. Spesifikasi mentahnya ada di `/docs.json`
kalau mau diimpor ke Postman atau Insomnia.

Cara memakainya: tekan tombol **Authorize** di kanan atas, isi API key dan token JWT
(dapat dari `POST /api/auth/login`), lalu semua tombol "Try it out" ikut membawa
kredensial itu.

**Kenapa mati secara bawaan:** halaman ini memaparkan peta lengkap endpoint ke siapa pun
yang bisa membukanya. Itu tidak membocorkan data maupun kredensial, tapi kalau API ini
terbuka ke internet, sebaiknya tidak dibiarkan terbuka permanen. Dua cara mengamankannya:

```bash
# Cara 1: nyalakan seperlunya, matikan lagi setelah selesai
# ubah ENABLE_SWAGGER di .env, lalu:
pm2 restart mongoapi-ts
```

```nginx
# Cara 2: biarkan menyala, tapi batasi siapa yang boleh membuka lewat nginx
location /docs {
    allow 1.2.3.4;      # IP kantor/rumah kamu
    deny all;
    proxy_pass http://127.0.0.1:3333;
}
```

Dokumentasinya ditulis di satu berkas `src/docs/openapi.ts`, bukan ditempel sebagai
komentar di tiap route. Ada uji otomatis yang membandingkan daftar endpoint di
dokumentasi dengan route yang benar-benar terdaftar, jadi kalau nanti kamu menambah
endpoint tapi lupa mendokumentasikannya, ketahuan.

---

## Index MongoDB — kerjakan ini lebih dulu

Tanpa index, setiap pencarian menelusuri seluruh koleksi. Di koleksi berisi ratusan juta
dokumen, itu bedanya antara milidetik dan menit.

Membuat index **tidak mengubah, menghapus, atau memindahkan data apa pun** — hanya menambah
struktur pencarian di sampingnya, dan aman dijalankan saat database sedang melayani request.

```bash
# 1. Lihat kondisi sekarang: ukuran koleksi dan index yang sudah ada
npm run indexes -- --stats

# 2. Lihat rencananya dulu (belum membuat apa pun)
npm run indexes -- --plan

# 3. Buat satu per satu, mulai dari yang paling berdampak
npm run indexes -- --yes --only=tokens_token
npm run indexes -- --yes --only=riwayats_id_tele
npm run indexes -- --yes --only=riwayats_data_id_transaksi
npm run indexes -- --yes --only=customers_id_tele
```

Pada koleksi sebesar itu, satu index bisa butuh waktu lama. Jalankan di jam sepi dan
bungkus supaya tidak putus kalau SSH terputus:

```bash
nohup npm run indexes -- --yes --only=riwayats_id_tele > index.log 2>&1 &
tail -f index.log
```

`tokens_token` adalah yang paling mendesak: dicek pada **setiap** request yang butuh login,
dan koleksi `tokens` terus bertambah karena token tidak pernah dibersihkan.

---

## Menguji sebelum dipakai sungguhan

Ada smoke test yang memverifikasi seluruh endpoint terhadap MongoDB sungguhan —
termasuk filter waktu, sorting, dan pagination yang tidak bisa diuji tanpa database.

```bash
SMOKE_MONGODB_URI="mongodb://127.0.0.1:27017/smoketest" npx tsx scripts/smoke-test.ts
```

Pengamannya: variabel yang dibaca `SMOKE_MONGODB_URI` (bukan `MONGODB_URI`), nama database
wajib mengandung kata `test`, database harus kosong, dan dihapus lagi setelah selesai.
Jadi tidak mungkin tidak sengaja mengenai data produksi.

---

## Menjalankan dengan PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Nama prosesnya `mongoapi-ts`, berbeda dari `mongoapi` milik `api.js` lama, supaya
keduanya bisa jalan bersamaan di port berbeda selama masa peralihan.

Cara berpindah dengan aman:

```bash
# 1. Jalankan yang baru di port lain dulu (misal PORT=3334 di .env)
pm2 start ecosystem.config.cjs

# 2. Bandingkan hasilnya dengan yang lama
curl -s "http://localhost:3333/api/orders?limit=5" -H "x-api-key: KEY" -H "Authorization: Bearer TOKEN" > lama.json
curl -s "http://localhost:3334/api/orders?limit=5" -H "x-api-key: KEY" -H "Authorization: Bearer TOKEN" > baru.json
diff <(jq -S . lama.json) <(jq -S . baru.json)

# 3. Kalau sudah cocok: matikan yang lama, pindahkan yang baru ke port 3333
pm2 stop mongoapi
# ubah PORT=3333 di .env
pm2 restart mongoapi-ts

# 4. Kalau sudah yakin beberapa hari
pm2 delete mongoapi
```

---

## Diakses dari luar VPS

API mendengarkan di port lokal; yang dibuka ke internet adalah nginx.

```nginx
server {
    listen 80;
    server_name api.domain.com;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Upload list_akun bisa besar
        client_max_body_size 100M;

        # Aggregation pada koleksi besar bisa lama
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.domain.com
```

Isi `TRUST_PROXY=1` di `.env` supaya alamat IP pengunjung terbaca benar di balik nginx.

---

## Perbedaan perilaku dari `api.js`

Sebagian besar response identik. Yang sengaja diubah:

1. **`PUT /api/products/:id`** tidak lagi mengembalikan `list_akun`. Bentuk responsenya kini
   sama dengan `GET /api/products/:id`. Alasannya: versi lama mengembalikan seluruh isi akun,
   yang pada produk besar bisa puluhan MB untuk satu kali update deskripsi.

2. **Pencarian `?q=`** memperlakukan input sebagai teks biasa, bukan pola regex.
   Sebelumnya `?q=.*` akan mencocokkan semuanya dan memaksa pemindaian penuh.

3. **Pesan error 500** di mode produksi hanya berbunyi `Internal error`. Detailnya tetap
   tercatat di log server, tapi tidak dikirim ke pemanggil — pesan error MongoDB bisa
   membocorkan struktur database ke luar.

4. **Total tanpa filter** memakai perkiraan cepat dari metadata koleksi
   (`estimatedDocumentCount`). Menghitung persis tanpa filter berarti menelusuri
   ratusan juta dokumen setiap kali halaman dibuka. Begitu ada filter, hitungannya persis lagi.

5. **`JWT_SECRET`** masih boleh kosong dan otomatis memakai `API_KEY`, persis seperti
   `api.js` lama, supaya token yang sudah beredar (termasuk `DRIP_TOKEN` milik panel)
   tetap berlaku. Yang dihapus hanya fallback ke string bawaan yang berbahaya.
   Kalau nanti `JWT_SECRET` diisi nilai baru, **semua token lama langsung tidak berlaku**
   dan setiap client harus login ulang.

6. **`reserved_list_akun` tidak pernah ikut di response.** Dokumen variasi di database
   memuat array kedua bernama `reserved_list_akun`, ditulis oleh bot untuk akun yang
   sedang ditahan. Panel tidak memakainya, jadi field itu tidak diambil sama sekali —
   bukan dibuang setelah sampai, tapi memang tidak diminta dari database.

   **Akibat yang perlu diketahui:** `list_akun_count` dan `POST .../ambil` hanya melihat
   `list_akun`. Kalau stok sebuah variasi kebetulan sedang berada di `reserved_list_akun`,
   variasi itu tampil sebagai stok 0 dan `ambil` menolak dengan "Stok kosong" — padahal
   akunnya ada, hanya di array sebelah. Ini disengaja: akun yang ditahan bot memang tidak
   boleh ikut terambil.

---

## Mengelola stok akun: tambah, lihat, hapus

Ini bagian yang paling sering dipakai panel, jadi dijelaskan terpisah.

`PUT` dan `POST` punya tugas berbeda dan tidak bisa saling menggantikan:

| | Kegunaan | Yang dikirim |
|---|---|---|
| `GET /:id/variasi/:variasiId` | **Melihat seluruh isi** (tanpa pagination) | — |
| `PUT /:id/variasi/:variasiId` | **Mengedit** — mengganti seluruh isi | Seluruh daftar akun |
| `POST /:id/variasi/:variasiId/akun` | **Menambah stok** | Hanya akun barunya |
| `POST /:id/variasi/:variasiId/ambil` | **Mengambil N akun** — keluar stok, isinya dikembalikan | Cukup angkanya |
| `DELETE /:id/variasi/:variasiId/akun` | **Menghapus tertentu** | Hanya yang mau dihapus |

Kenapa menambah stok tidak boleh lewat `PUT`: client harus mengunduh dulu seluruh daftar
akun yang ada, menempelkan yang baru di ujungnya, lalu mengirim balik semuanya. Pada variasi
berisi puluhan ribu akun itu berat sekali. Lebih berbahaya lagi, kalau dua proses melakukannya
bersamaan — misal drip worker dan kamu mengedit dari panel — yang belakangan selesai akan
menghapus hasil yang lain tanpa jejak. `POST` hanya mengirim akun barunya, dan penggabungan
dikerjakan MongoDB sendiri, jadi aman walau bersamaan.

### Menambah

```bash
curl -X POST "http://localhost:3333/api/products/PRODUK_ID/variasi/VARIASI_ID/akun" \
  -H "Content-Type: application/json" \
  -H "x-api-key: KEY" -H "Authorization: Bearer TOKEN" \
  -d '{"list_akun":["email1@x.com|pass1","email2@x.com|pass2"]}'
```

```json
{ "ok": true, "appended": 2, "total": 1502, "message": "Menambahkan 2 akun (total sekarang 1502)" }
```

Tambahkan `"unique": true` kalau ingin akun yang sudah ada di daftar dilewati:

```json
{ "list_akun": ["email1@x.com|pass1", "baru@x.com|pass"], "unique": true }
```

```json
{ "ok": true, "appended": 1, "duplicates": 1, "total": 1503 }
```

Tanpa `unique`, akun yang sama akan masuk dua kali — perilaku ini sengaja dipertahankan
sebagai bawaan supaya sama dengan cara drip worker menulis sekarang.

### Melihat (bertahap)

```bash
curl "http://localhost:3333/api/products/PRODUK_ID/variasi/VARIASI_ID/akun?page=1&limit=50" \
  -H "x-api-key: KEY" -H "Authorization: Bearer TOKEN"
```

Pemotongan halaman dilakukan di database, jadi tidak menarik puluhan ribu baris sekaligus.

### Mengambil sejumlah akun (untuk dijual manual / jadi bahan produk lain)

Kirim angkanya saja, dapat akunnya, dan stok langsung berkurang — semuanya dalam satu operasi.

```bash
curl -X POST ".../api/products/PRODUK_ID/variasi/VARIASI_ID/ambil" \
  -H "Content-Type: application/json" \
  -H "x-api-key: KEY" -H "Authorization: Bearer TOKEN" \
  -d '{"jumlah":100}'
```

```json
{
  "ok": true,
  "diminta": 100,
  "diambil": 100,
  "items": ["email1@x.com|pass1", "... 99 lainnya"],
  "sisa": 1402
}
```

Yang diambil selalu dari urutan terdepan (stok paling lama keluar duluan).

Bedanya dengan "lihat dulu lalu hapus": kalau dilakukan dua langkah terpisah, ada jeda antara
kamu melihat akun dan menghapusnya. Kalau bot kebetulan menjual akun yang sama pada jeda itu,
akun tersebut keluar dua kali ke dua pembeli berbeda. Endpoint ini tidak punya jeda itu —
MongoDB mengeluarkan dan mengembalikannya sebagai satu tindakan yang tidak bisa disela.
Aman dipanggil bersamaan, dari beberapa perangkat sekaligus, selagi bot tetap jalan.

Kalau stok kurang dari yang diminta, yang tersedia tetap diambil dan `diambil` berisi jumlah
sebenarnya. Kalau kamu ingin semua-atau-tidak-sama-sekali:

```json
{ "jumlah": 100, "harus_penuh": true }
```

Stok kurang berarti permintaan ditolak dengan `409` dan **tidak ada satu pun akun yang diambil**:

```json
{ "error": "Stok tidak cukup: diminta 100, tersedia 47", "diminta": 100, "tersedia": 47 }
```

Batas sekali ambil 5000 akun. Kalau di saat bersamaan stok sedang sangat sering berubah,
permintaan bisa dijawab `409` dengan pesan minta ulang — itu pengaman, bukan kegagalan;
tidak ada akun yang keluar saat itu terjadi.

### Menghapus akun tertentu

```bash
curl -X DELETE "http://localhost:3333/api/products/PRODUK_ID/variasi/VARIASI_ID/akun" \
  -H "Content-Type: application/json" \
  -H "x-api-key: KEY" -H "Authorization: Bearer TOKEN" \
  -d '{"list_akun":["email1@x.com|pass1"]}'
```

```json
{ "ok": true, "removed": 1, "total": 1502 }
```

Hanya akun yang teksnya **sama persis** yang dihapus. Kalau akun itu kebetulan tercatat
dua kali, dua-duanya ikut terhapus.

> `POST /:id/variasi/:variasiId/append-akun` tetap berfungsi sebagai nama lama untuk
> endpoint tambah yang sama, supaya pemanggil lama tidak putus.

---

## Versi MongoDB minimum

Kode ini sengaja dijaga agar hanya memakai operator yang ada sejak **MongoDB 4.4**.
Operator `$sortArray` (butuh 5.2+) sempat dipakai untuk mengurutkan variasi, tapi sudah
diganti dengan pengurutan di sisi Node supaya tidak mengunci ke versi yang lebih baru.

Cek versi server:

```bash
mongosh --quiet --eval 'db.version()'
```

---

## Catatan soal batas yang tidak bisa dihindari

- **`waktu` disimpan sebagai teks** (`"13/12/2024 10:18:34"`), bukan tipe tanggal.
  Semua filter waktu karena itu harus menyusun ulang teks di dalam pipeline, dan
  **tidak bisa dipercepat dengan index**. Memperbaikinya secara tuntas berarti mengubah
  data yang sudah ada — di luar cakupan sekarang.

- **`GET /api/riwayats` tanpa `limit`** memakai batas bawaan 100 pembeli. Membiarkannya
  tanpa batas tidak mungkin: hasil `$facet` dikemas sebagai satu dokumen, dan satu dokumen
  MongoDB dibatasi 16MB.

- **`GET /api/orders` tanpa filter apa pun** tetap harus meratakan seluruh koleksi.
  Sebisa mungkin selalu sertakan `id_tele`, `id_transaksi`, atau `filter=today|24h|7d|30d`.

- **Pagination dengan `skip` besar** melambat di halaman yang sangat jauh, karena MongoDB
  tetap harus melewati semua dokumen sebelumnya. Untuk penelusuran jauh, saring dulu
  ketimbang meloncat halaman.

- **`list_akun` disimpan menyatu di dalam dokumen produk.** Satu dokumen MongoDB dibatasi
  16MB. Kalau satu variasi menumpuk terlalu banyak akun, batas itu bisa tersentuh.
  Kalau nanti mulai mendekat, `list_akun` perlu dipindah jadi koleksi tersendiri.
