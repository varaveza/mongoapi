/**
 * Smoke test menyeluruh terhadap MongoDB SUNGGUHAN.
 *
 * Uji ini memverifikasi bagian yang tidak bisa diuji tanpa database, terutama
 * aggregation pipeline: filter waktu, sorting, pagination, dan $facet.
 *
 * CARA PAKAI (jalankan di VPS, arahkan ke database KOSONG khusus uji):
 *
 *   SMOKE_MONGODB_URI="mongodb://127.0.0.1:27017/smoketest" npx tsx scripts/smoke-test.ts
 *
 * PENGAMAN:
 * - Variabel yang dibaca adalah SMOKE_MONGODB_URI, BUKAN MONGODB_URI, supaya tidak
 *   mungkin tidak sengaja menunjuk ke database produksi.
 * - Nama database WAJIB mengandung kata "test".
 * - Di akhir proses, database uji tersebut DIHAPUS.
 */
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { format, toZonedTime } from 'date-fns-tz';
import { subDays, subMinutes } from 'date-fns';

const TZ = 'Asia/Jakarta';
const fmt = (d: Date) => format(toZonedTime(d, TZ), 'dd/MM/yyyy HH:mm:ss', { timeZone: TZ });

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
	if (condition) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}`);
		if (detail !== undefined) console.log('        ', JSON.stringify(detail));
	}
}

const uri = process.env.SMOKE_MONGODB_URI;
if (!uri) {
	console.error('SMOKE_MONGODB_URI belum diisi.\n');
	console.error('Contoh:');
	console.error('  SMOKE_MONGODB_URI="mongodb://127.0.0.1:27017/smoketest" npx tsx scripts/smoke-test.ts\n');
	process.exit(1);
}

const dbName = new URL(uri.replace('mongodb://', 'http://').replace('mongodb+srv://', 'http://')).pathname.replace('/', '');
if (!dbName || !dbName.toLowerCase().includes('test')) {
	console.error(`Nama database "${dbName || '(kosong)'}" tidak mengandung kata "test".`);
	console.error('Uji ini MENGHAPUS database di akhir, jadi hanya boleh menunjuk database khusus uji.\n');
	process.exit(1);
}

// --- Seed ---
const seedClient = new MongoClient(uri);
await seedClient.connect();
const db = seedClient.db(dbName);

const existing = await db.listCollections().toArray();
if (existing.length > 0) {
	console.error(`Database "${dbName}" tidak kosong (ada ${existing.length} koleksi).`);
	console.error('Gunakan database baru yang benar-benar kosong.\n');
	await seedClient.close();
	process.exit(1);
}

const now = new Date();
const W_NOW = fmt(subMinutes(now, 5));
const W_YESTERDAY = fmt(subDays(now, 1));
const W_10D = fmt(subDays(now, 10));
const W_40D = fmt(subDays(now, 40));

await db.collection('users').insertOne({
	email: 'admin@test.com',
	name: 'Admin',
	password: bcrypt.hashSync('example-password-uji', 8),
	remember_token: null
});

const variasiId = new ObjectId();
await db.collection('products').insertOne({
	nama_produk: 'Zoom',
	deskripsi: 'Private',
	stok_terjual: 10,
	variasi: [
		{ _id: variasiId, nama: 'Zebra 14 Day', harga: 2500, list_akun: ['a@x.com|1', 'b@x.com|2', 'c@x.com|3', 'd@x.com|4', 'e@x.com|5'] },
		{ _id: new ObjectId(), nama: 'Alpha 30 Day', harga: 5000, list_akun: ['f@x.com|6'] }
	]
});

const noIdProduct = await db.collection('products').insertOne({
	nama_produk: 'Legacy Product',
	deskripsi: '',
	stok_terjual: 0,
	variasi: [
		{ nama: 'Tanpa ID A', harga: 1000, list_akun: ['x1|p1', 'x2|p2'] },
		{ nama: 'Tanpa ID B', harga: 2000, list_akun: ['x3|p3'] }
	]
});

await db.collection('customers').insertMany([
	{ username_tele: 'si_bondjol', id_tele: 111, total_transaksi: 17500, balance: 6000, baned: false, status: 'active' },
	{ username_tele: 'budi', id_tele: 222, total_transaksi: 6000, balance: 1000, baned: false, status: 'active' }
]);

await db.collection('riwayats').insertMany([
	{
		id_tele: '111',
		data: [
			{ nama_produk: 'Zoom', id_transaksi: 'TRX-1', variasi: '14 Day', jumlah_pembelian: 1, total_bayar: 2500, waktu: W_NOW },
			{ nama_produk: 'Netflix', id_transaksi: 'TRX-2', variasi: '1 Bulan', jumlah_pembelian: 1, total_bayar: 15000, waktu: W_10D }
		]
	},
	{
		id_tele: '222',
		data: [
			{ nama_produk: 'Spotify', id_transaksi: 'TRX-3', variasi: '1 Bulan', jumlah_pembelian: 2, total_bayar: 5000, waktu: W_YESTERDAY },
			{ nama_produk: 'Vision', id_transaksi: 'TRX-4', variasi: '1 Bulan', jumlah_pembelian: 1, total_bayar: 1000, waktu: W_40D }
		]
	}
]);
await seedClient.close();

// --- Boot app ---
process.env.MONGODB_URI = uri;
process.env.API_KEY = 'example-apikey-untuk-uji';
process.env.JWT_SECRET = 'example-jwtsecret-untuk-uji';
process.env.PORT = '3399';
process.env.NODE_ENV = 'test';
process.env.TOKEN_CACHE_TTL_MS = '60000';

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = app.listen(3399);
const BASE = 'http://127.0.0.1:3399';

const api = (path: string, init: RequestInit = {}, token?: string) =>
	fetch(BASE + path, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': 'example-apikey-untuk-uji',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init.headers as Record<string, string>)
		}
	});

console.log('\n=== 1. Health & Auth ===');
let r = await fetch(BASE + '/health');
check('GET /health -> 200 {ok:true}', r.status === 200 && (await r.json() as any).ok === true);

r = await fetch(BASE + '/api/products');
check('tanpa auth -> 401', r.status === 401);

r = await fetch(BASE + '/api/auth/login', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: 'admin@test.com', password: 'salah' })
});
check('login password salah -> 401', r.status === 401);

r = await fetch(BASE + '/api/auth/login', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: 'admin@test.com', password: 'example-password-uji' })
});
const loginBody = (await r.json()) as any;
const TOKEN: string = loginBody.token;
check('login benar -> 200 + token', r.status === 200 && typeof TOKEN === 'string');

r = await fetch(BASE + '/api/products', { headers: { Authorization: `Bearer ${TOKEN}` } });
check('JWT tanpa api key -> 401', r.status === 401);

r = await fetch(BASE + '/api/products', { headers: { 'x-api-key': 'example-apikey-untuk-uji' } });
check('api key tanpa JWT -> 401', r.status === 401);

r = await api('/api/products', {}, TOKEN);
check('JWT + api key -> 200', r.status === 200);

console.log('\n=== 2. Products & Variasi ===');
const productsList = await (await api('/api/products', {}, TOKEN)).json() as any;
check('list produk berisi 2 item', productsList.total === 2, productsList);
check('tanpa limit -> semua produk dikembalikan sekaligus',
	productsList.items.length === productsList.total && productsList.pages === 1, productsList);

const produkBerhalaman = await (await api('/api/products?limit=1', {}, TOKEN)).json() as any;
check('dengan limit -> tetap bisa dipaginasi',
	produkBerhalaman.items.length === 1 && produkBerhalaman.total === 2 && produkBerhalaman.pages === 2,
	produkBerhalaman);
const zoomId = productsList.items.find((p: any) => p.nama_produk === 'Zoom')._id;

const zoom = await (await api(`/api/products/${zoomId}`, {}, TOKEN)).json() as any;
check('detail produk TIDAK membawa list_akun', zoom.variasi.every((v: any) => v.list_akun === undefined), zoom.variasi);
check('variasi terurut alfabetis', zoom.variasi[0].nama === 'Alpha 30 Day', zoom.variasi.map((v: any) => v.nama));

const variasiList = await (await api(`/api/products/${zoomId}/variasi`, {}, TOKEN)).json() as any;
const zebra = variasiList.find((v: any) => v.nama === 'Zebra 14 Day');
check('list_akun_count dihitung di database', zebra.list_akun_count === 5, variasiList);

const akunPage = await (await api(`/api/products/${zoomId}/variasi/${variasiId}/akun?page=2&limit=2`, {}, TOKEN)).json() as any;
check('paginasi akun: total benar', akunPage.total === 5, akunPage);
check('paginasi akun: potongan halaman 2 benar', JSON.stringify(akunPage.items) === JSON.stringify(['c@x.com|3', 'd@x.com|4']), akunPage.items);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/append-akun`, {
	method: 'POST',
	body: JSON.stringify({ list_akun: ['baru1|p', 'baru2|p'] })
}, TOKEN);
const appendBody = await r.json() as any;
const afterAppend = await (await api(`/api/products/${zoomId}/variasi`, {}, TOKEN)).json() as any;
check('append-akun menambah tanpa menimpa', appendBody.appended === 2 && afterAppend.find((v: any) => v.nama === 'Zebra 14 Day').list_akun_count === 7, afterAppend);


// --- Endpoint tambah/hapus akun ---
const akunSekarang = async () => {
	const v = await (await api(`/api/products/${zoomId}/variasi`, {}, TOKEN)).json() as any;
	return v.find((x: any) => x.nama === 'Zebra 14 Day').list_akun_count;
};

const sebelumTambah = await akunSekarang();
r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'POST',
	body: JSON.stringify({ list_akun: ['tambah1|p', 'tambah2|p'] })
}, TOKEN);
const tambahBody = await r.json() as any;
check('POST /akun menambah 2 akun', tambahBody.appended === 2 && tambahBody.total === sebelumTambah + 2, tambahBody);
check('POST /akun melaporkan total terbaru', (await akunSekarang()) === sebelumTambah + 2);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'POST',
	body: JSON.stringify({ list_akun: ['tambah1|p', 'benar-benar-baru|p'], unique: true })
}, TOKEN);
const uniqueBody = await r.json() as any;
check('unique:true melewati yang sudah ada', uniqueBody.appended === 1 && uniqueBody.duplicates === 1, uniqueBody);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'POST',
	body: JSON.stringify({ list_akun: ['tambah1|p'] })
}, TOKEN);
const dupBody = await r.json() as any;
check('tanpa unique, duplikat tetap masuk (perilaku $push)', dupBody.appended === 1, dupBody);

const sebelumHapus = await akunSekarang();
r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'DELETE',
	body: JSON.stringify({ list_akun: ['tambah1|p'] })
}, TOKEN);
const hapusBody = await r.json() as any;
check('DELETE /akun menghapus semua yang sama persis (2 salinan)', hapusBody.removed === 2 && hapusBody.total === sebelumHapus - 2, hapusBody);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'DELETE',
	body: JSON.stringify({ list_akun: ['tidak-pernah-ada|p'] })
}, TOKEN);
check('DELETE akun yang tidak ada -> removed 0', (await r.json() as any).removed === 0);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'POST',
	body: JSON.stringify({ list_akun: [] })
}, TOKEN);
check('list_akun kosong -> 400', r.status === 400);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/akun`, {
	method: 'POST',
	body: JSON.stringify({ list_akun: ['ok|p', 123] })
}, TOKEN);
check('list_akun berisi non-string -> 400', r.status === 400);

console.log('\n=== 3b. Ambil akun (keluar stok + dikembalikan, atomik) ===');
// Siapkan stok bersih dan mudah dilacak: A1..A50
const stokUji = Array.from({ length: 50 }, (_, k) => `A${k + 1}|pass`);
await api(`/api/products/${zoomId}/variasi/${variasiId}`, {
	method: 'PUT',
	body: JSON.stringify({ list_akun: stokUji })
}, TOKEN);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 3 })
}, TOKEN);
const ambil1 = await r.json() as any;
check('ambil 3 -> dapat 3 akun', ambil1.diambil === 3 && ambil1.items.length === 3, ambil1);
check('yang diambil adalah yang terdepan (A1,A2,A3)',
	JSON.stringify(ambil1.items) === JSON.stringify(['A1|pass', 'A2|pass', 'A3|pass']), ambil1.items);
check('stok berkurang jadi 47', ambil1.sisa === 47 && (await akunSekarang()) === 47, ambil1.sisa);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 2 })
}, TOKEN);
const ambil2 = await r.json() as any;
check('ambil lagi lanjut dari A4, bukan mengulang', 
	JSON.stringify(ambil2.items) === JSON.stringify(['A4|pass', 'A5|pass']), ambil2.items);

// Inti dari endpoint ini: 5 permintaan bersamaan tidak boleh ada akun yang sama keluar dua kali.
const bersamaan = await Promise.all(
	Array.from({ length: 5 }, () =>
		api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
			method: 'POST', body: JSON.stringify({ jumlah: 9 })
		}, TOKEN).then((x) => x.json() as any)
	)
);
const semuaItem = bersamaan.flatMap((b: any) => b.items ?? []);
const unik = new Set(semuaItem);
// Sifat yang WAJIB dipenuhi: tidak ada akun yang sama keluar lebih dari sekali.
check('TIDAK ADA akun yang keluar dua kali', unik.size === semuaItem.length, {
	keluar: semuaItem.length, unik: unik.size
});
// Kekekalan jumlah: yang keluar + yang tersisa harus tetap 45, tidak ada yang hilang/tercipta.
const sisaAkhir = await akunSekarang();
check('jumlah kekal: keluar + sisa = 45', semuaItem.length + sisaAkhir === 45, {
	keluar: semuaItem.length, sisa: sisaAkhir
});
const ditolak = bersamaan.filter((b: any) => !b.ok).length;
console.log(`        (${bersamaan.length - ditolak} permintaan berhasil, ${ditolak} ditolak karena rebutan - ditolak itu wajar dan aman)`);
// Kosongkan sisa kalau ada yang tertinggal karena permintaan ditolak.
if (sisaAkhir > 0) {
	await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
		method: 'POST', body: JSON.stringify({ jumlah: sisaAkhir })
	}, TOKEN);
}
check('stok bisa dihabiskan sampai 0', (await akunSekarang()) === 0);

// Stok kosong
r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 1 })
}, TOKEN);
check('ambil saat stok kosong -> 409', r.status === 409);

// Ambil melebihi stok
await api(`/api/products/${zoomId}/variasi/${variasiId}`, {
	method: 'PUT', body: JSON.stringify({ list_akun: ['B1|p', 'B2|p', 'B3|p'] })
}, TOKEN);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 10 })
}, TOKEN);
const ambilLebih = await r.json() as any;
check('minta 10 dari stok 3 -> dapat 3, sisa 0', ambilLebih.diambil === 3 && ambilLebih.sisa === 0, ambilLebih);

// harus_penuh: semua atau tidak sama sekali
await api(`/api/products/${zoomId}/variasi/${variasiId}`, {
	method: 'PUT', body: JSON.stringify({ list_akun: ['C1|p', 'C2|p'] })
}, TOKEN);

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 5, harus_penuh: true })
}, TOKEN);
check('harus_penuh dengan stok kurang -> 409', r.status === 409);
check('harus_penuh gagal TIDAK mengurangi stok', (await akunSekarang()) === 2, await akunSekarang());

r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 2, harus_penuh: true })
}, TOKEN);
check('harus_penuh dengan stok pas -> berhasil', ((await r.json()) as any).diambil === 2);

// Validasi
for (const [nilai, label] of [[0, 'nol'], [-5, 'negatif'], ['abc', 'bukan angka'], [99999, 'melebihi batas']] as any[]) {
	r = await api(`/api/products/${zoomId}/variasi/${variasiId}/ambil`, {
		method: 'POST', body: JSON.stringify({ jumlah: nilai })
	}, TOKEN);
	check(`jumlah ${label} -> 400`, r.status === 400);
}

r = await api(`/api/products/${zoomId}/variasi/507f1f77bcf86cd799439011/ambil`, {
	method: 'POST', body: JSON.stringify({ jumlah: 1 })
}, TOKEN);
check('variasi tidak ada -> 404', r.status === 404);

// Kembalikan stok untuk pengujian berikutnya
await api(`/api/products/${zoomId}/variasi/${variasiId}`, {
	method: 'PUT', body: JSON.stringify({ list_akun: ['sisa1|p', 'sisa2|p', 'sisa3|p'] })
}, TOKEN);

// PUT tetap MENIMPA seluruh daftar - inilah bedanya dengan POST di atas.
const totalSebelumPut = await akunSekarang();
r = await api(`/api/products/${zoomId}/variasi/${variasiId}`, {
	method: 'PUT',
	body: JSON.stringify({ list_akun: ['satu-satunya|p'] })
}, TOKEN);
check('PUT menimpa seluruh list_akun (bukan menambah)', (await akunSekarang()) === 1 && totalSebelumPut > 1, { totalSebelumPut });

r = await api(`/api/products/${zoomId}`, { method: 'PUT', body: JSON.stringify({ deskripsi: 'Updated' }) }, TOKEN);
const putBody = await r.json() as any;
check('PUT produk -> 200 & tanpa list_akun', r.status === 200 && putBody.deskripsi === 'Updated' && putBody.variasi.every((v: any) => v.list_akun === undefined));

console.log('\n=== 3. generate-ids (harus mempertahankan list_akun) ===');
const legacyId = noIdProduct.insertedId.toString();
r = await api(`/api/products/${legacyId}/variasi/generate-ids`, { method: 'POST' }, TOKEN);
const genBody = await r.json() as any;
check('generate-ids melaporkan 2 ID dibuat', genBody.generated === 2, genBody);

const verifyClient = new MongoClient(uri);
await verifyClient.connect();
const legacyDoc = await verifyClient.db(dbName).collection('products').findOne({ _id: noIdProduct.insertedId });
await verifyClient.close();
check('semua variasi kini punya _id', legacyDoc!.variasi.every((v: any) => v._id instanceof ObjectId), legacyDoc!.variasi.map((v: any) => v._id));
check('list_akun TIDAK hilang setelah generate-ids',
	JSON.stringify(legacyDoc!.variasi.map((v: any) => v.list_akun)) === JSON.stringify([['x1|p1', 'x2|p2'], ['x3|p3']]),
	legacyDoc!.variasi.map((v: any) => v.list_akun));
check('nama & harga variasi tetap utuh',
	legacyDoc!.variasi[0].nama === 'Tanpa ID A' && legacyDoc!.variasi[1].harga === 2000);

r = await api(`/api/products/${legacyId}/variasi/generate-ids`, { method: 'POST' }, TOKEN);
check('generate-ids kedua kali -> 0 (idempoten)', (await r.json() as any).generated === 0);

console.log('\n=== 4. Orders (aggregation + filter waktu) ===');
const allOrders = await (await api('/api/orders', {}, TOKEN)).json() as any;
check('semua order terambil (4)', allOrders.total === 4, allOrders);
check('urutan default: terbaru dulu',
	JSON.stringify(allOrders.items.map((o: any) => o.id_transaksi)) === JSON.stringify(['TRX-1', 'TRX-3', 'TRX-2', 'TRX-4']),
	allOrders.items.map((o: any) => `${o.id_transaksi}@${o.waktu}`));

const todayOrders = await (await api('/api/orders?filter=today', {}, TOKEN)).json() as any;
check('filter=today -> hanya TRX-1', todayOrders.total === 1 && todayOrders.items[0].id_transaksi === 'TRX-1', todayOrders.items);

const weekOrders = await (await api('/api/orders?filter=7d', {}, TOKEN)).json() as any;
check('filter=7d -> TRX-1 & TRX-3', weekOrders.total === 2, weekOrders.items.map((o: any) => o.id_transaksi));

const monthOrders = await (await api('/api/orders?filter=30d', {}, TOKEN)).json() as any;
check('filter=30d -> 3 order (40 hari lalu tidak masuk)', monthOrders.total === 3, monthOrders.items.map((o: any) => o.id_transaksi));

const byBayar = await (await api('/api/orders?sort_by=total_bayar&order=desc', {}, TOKEN)).json() as any;
check('sort_by=total_bayar desc', byBayar.items[0].id_transaksi === 'TRX-2', byBayar.items.map((o: any) => o.total_bayar));

const byTrx = await (await api('/api/orders?id_transaksi=TRX-3', {}, TOKEN)).json() as any;
check('filter id_transaksi', byTrx.total === 1 && byTrx.items[0].nama_produk === 'Spotify', byTrx);

const byTele = await (await api('/api/orders?id_tele=111', {}, TOKEN)).json() as any;
check('filter id_tele', byTele.total === 2, byTele.items.map((o: any) => o.id_tele));

const paged = await (await api('/api/orders?page=2&limit=1', {}, TOKEN)).json() as any;
check('pagination halaman 2', paged.items.length === 1 && paged.items[0].id_transaksi === 'TRX-3' && paged.pages === 4, paged);

console.log('\n=== 5. Customer orders & Riwayats ===');
const custOrders = await (await api('/api/customers/111/orders', {}, TOKEN)).json() as any;
check('order per pelanggan (2)', custOrders.total === 2, custOrders);
check('id_transaksi disembunyikan', custOrders.items.every((o: any) => o.id_transaksi === undefined), custOrders.items);

const custToday = await (await api('/api/customers/111/orders?filter=today', {}, TOKEN)).json() as any;
check('order pelanggan filter=today -> 1', custToday.total === 1, custToday.items);

const custKosong = await (await api('/api/customers/999/orders', {}, TOKEN)).json() as any;
check('pelanggan tanpa order -> items kosong', custKosong.total === 0 && Array.isArray(custKosong.items), custKosong);

const riwayatAll = await (await api('/api/riwayats', {}, TOKEN)).json() as any;
check('riwayats: 2 dokumen', riwayatAll.total === 2, riwayatAll.total);

const riwayatToday = await (await api('/api/riwayats?filter=today', {}, TOKEN)).json() as any;
check('riwayats filter=today -> hanya pelanggan 111', riwayatToday.total === 1 && riwayatToday.items[0].data.length === 1, riwayatToday);

const riwayat30 = await (await api('/api/riwayats?filter=30d', {}, TOKEN)).json() as any;
check('riwayats filter=30d -> 2 pelanggan, TRX-4 tersaring', riwayat30.total === 2 && riwayat30.items.every((i: any) => i.data.every((d: any) => d.id_transaksi !== 'TRX-4')), riwayat30);

console.log('\n=== 6. Customers ===');
const custList = await (await api('/api/customers', {}, TOKEN)).json() as any;
check('list customers (2)', custList.total === 2, custList.total);

const custSorted = await (await api('/api/customers?sort_by=total_transaksi&order=asc', {}, TOKEN)).json() as any;
check('sorting customers', custSorted.items[0].username_tele === 'budi', custSorted.items.map((c: any) => c.total_transaksi));

const custSearch = await (await api('/api/customers?q=bondjol', {}, TOKEN)).json() as any;
check('pencarian username', custSearch.total === 1, custSearch.total);

const custRegex = await (await api('/api/customers?q=.*', {}, TOKEN)).json() as any;
check('input regex diperlakukan sebagai teks biasa', custRegex.total === 0, custRegex.total);

const custId = custList.items[0]._id;
r = await api(`/api/customers/${custId}`, { method: 'PUT', body: JSON.stringify({ status: 'suspend' }) }, TOKEN);
const custUpdated = await r.json() as any;
check('PUT customer: status suspend -> baned true', custUpdated.status === 'suspend' && custUpdated.baned === true, custUpdated);

r = await api(`/api/customers/${custId}`, { method: 'PUT', body: JSON.stringify({ balance: 'bukan angka' }) }, TOKEN);
check('validasi balance non-angka -> 400', r.status === 400);

console.log('\n=== 7. Error handling & logout ===');
r = await api('/api/products/bukan-objectid', {}, TOKEN);
check('id tidak valid -> 400', r.status === 400);

r = await api('/api/products/507f1f77bcf86cd799439011', {}, TOKEN);
check('produk tidak ada -> 404', r.status === 404);

r = await api('/api/tidak-ada-route', {}, TOKEN);
check('route tidak dikenal -> 404', r.status === 404);

r = await api('/api/auth/logout', { method: 'POST' }, TOKEN);
check('logout -> 200', r.status === 200);

r = await api('/api/products', {}, TOKEN);
check('token setelah logout langsung ditolak (cache dibersihkan)', r.status === 401, await r.text());

console.log(`\n=== HASIL: ${passed} lulus, ${failed} gagal ===\n`);

server.close();

// Bersihkan: hapus database uji.
const cleanupClient = new MongoClient(uri);
await cleanupClient.connect();
await cleanupClient.db(dbName).dropDatabase();
await cleanupClient.close();
console.log(`Database uji "${dbName}" sudah dihapus.\n`);

const { closeDb } = await import('../src/config/db.js');
await closeDb();
process.exit(failed === 0 ? 0 : 1);
