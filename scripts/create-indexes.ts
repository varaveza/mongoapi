/**
 * Pembuat index MongoDB.
 *
 * Index TIDAK mengubah, menghapus, atau memindahkan data apa pun. Yang dibuat hanya
 * struktur pencarian tambahan di samping data. Membuat index aman dijalankan pada
 * database yang sedang melayani request.
 *
 * TAPI PERHATIKAN: pada koleksi berisi ratusan juta dokumen, satu index bisa butuh
 * waktu lama untuk selesai (bisa berjam-jam) dan memakan ruang disk tambahan.
 * Sejak MongoDB 4.2 pembuatan index tidak mengunci koleksi selama proses berjalan,
 * jadi API tetap bisa melayani permintaan - hanya saja server bekerja lebih berat.
 *
 * Cara pakai:
 *   npm run indexes -- --stats           lihat ukuran koleksi dan index yang sudah ada
 *   npm run indexes -- --plan            lihat daftar index yang akan dibuat (tanpa membuat)
 *   npm run indexes -- --yes             buat SEMUA index yang belum ada
 *   npm run indexes -- --yes --only=tokens_token    buat satu index saja
 *
 * Saran untuk koleksi besar: jalankan satu per satu dengan --only, di jam sepi,
 * dan bungkus dengan nohup/screen supaya tidak putus kalau koneksi SSH terputus:
 *   nohup npm run indexes -- --yes --only=riwayats_id_tele > index.log 2>&1 &
 */
import type { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { getDb, closeDb } from '../src/config/db.js';

interface IndexPlan {
	name: string;
	collection: string;
	keys: IndexSpecification;
	options?: CreateIndexesOptions;
	why: string;
	/** Index yang menghapus data tidak akan dibuat kecuali diminta secara eksplisit. */
	destructive?: boolean;
}

const PLANS: IndexPlan[] = [
	{
		name: 'tokens_token',
		collection: 'tokens',
		keys: { token: 1, revoked: 1 },
		why:
			'Dicek pada SETIAP request yang butuh login. Tanpa index, tiap request menelusuri ' +
			'seluruh koleksi tokens - dan koleksi ini terus bertambah karena token tidak pernah dibersihkan. ' +
			'Ini index dengan dampak terbesar, buat ini duluan.'
	},
	{
		name: 'riwayats_id_tele',
		collection: 'riwayats',
		keys: { id_tele: 1 },
		why:
			'Dipakai GET /api/customers/:id_tele/orders dan GET /api/orders?id_tele=... ' +
			'Memungkinkan MongoDB langsung menuju dokumen pelanggan yang dicari, bukan memindai semuanya.'
	},
	{
		name: 'riwayats_data_id_transaksi',
		collection: 'riwayats',
		keys: { 'data.id_transaksi': 1 },
		why:
			'Dipakai GET /api/orders?id_transaksi=... Index ini membuat penyaringan bisa dilakukan ' +
			'SEBELUM array transaksi diratakan, sehingga jauh lebih sedikit dokumen yang diproses.'
	},
	{
		name: 'customers_id_tele',
		collection: 'customers',
		keys: { id_tele: 1 },
		why: 'Dipakai filter GET /api/customers?id_tele=... dan pencarian pelanggan berdasarkan ID Telegram.'
	},
	{
		name: 'customers_total_transaksi',
		collection: 'customers',
		keys: { total_transaksi: -1 },
		why:
			'Dipakai sorting GET /api/customers?sort_by=total_transaksi. Tanpa index, MongoDB harus ' +
			'mengurutkan seluruh koleksi di memory dan bisa gagal karena melewati batas memory sorting.'
	},
	{
		name: 'customers_balance',
		collection: 'customers',
		keys: { balance: -1 },
		why: 'Dipakai sorting GET /api/customers?sort_by=balance.'
	},
	{
		name: 'customers_updated_at',
		collection: 'customers',
		keys: { updated_at: -1 },
		why: 'Dipakai sorting GET /api/customers?sort_by=updated_at.'
	},
	{
		name: 'products_nama_produk',
		collection: 'products',
		keys: { nama_produk: 1 },
		why: 'Membantu pencarian dan pengurutan produk berdasarkan nama.'
	},
	{
		name: 'tokens_ttl_expires_at',
		collection: 'tokens',
		keys: { expires_at: 1 },
		options: { expireAfterSeconds: 0 },
		destructive: true,
		why:
			'INI MENGHAPUS DATA. Index TTL membuat MongoDB otomatis menghapus token yang sudah lewat ' +
			'masa berlakunya, supaya koleksi tokens tidak membengkak selamanya. Karena masa berlaku token ' +
			'default 10 tahun, efeknya baru terasa jauh di kemudian hari. Jangan aktifkan kalau riwayat ' +
			'token perlu disimpan.'
	}
];

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(flag);
const getOption = (prefix: string): string | null => {
	const found = args.find((a) => a.startsWith(prefix));
	return found ? found.slice(prefix.length) : null;
};

async function showStats(db: Db): Promise<void> {
	const collections = ['tokens', 'riwayats', 'customers', 'products', 'users'];

	console.log('\n=== Kondisi koleksi saat ini ===\n');

	for (const name of collections) {
		try {
			const col = db.collection(name);
			// estimatedDocumentCount membaca metadata, jadi instan walau koleksinya besar.
			const count = await col.estimatedDocumentCount();
			const indexes = await col.indexes();

			console.log(`${name}`);
			console.log(`  perkiraan dokumen : ${count.toLocaleString('id-ID')}`);
			console.log(`  index terpasang   : ${indexes.map((i) => i.name).join(', ') || '(tidak ada)'}`);
			console.log('');
		} catch {
			console.log(`${name}\n  (koleksi tidak ditemukan)\n`);
		}
	}
}

async function run(): Promise<void> {
	const db = await getDb();

	if (hasFlag('--stats')) {
		await showStats(db);
		return;
	}

	const only = getOption('--only=');
	const includeDestructive = hasFlag('--include-ttl');
	const execute = hasFlag('--yes');

	let selected = PLANS.filter((p) => !p.destructive || includeDestructive);
	if (only) {
		selected = selected.filter((p) => p.name === only);
		if (selected.length === 0) {
			console.error(`Index "${only}" tidak dikenal. Pilihan: ${PLANS.map((p) => p.name).join(', ')}`);
			process.exitCode = 1;
			return;
		}
	}

	console.log('\n=== Rencana pembuatan index ===\n');
	for (const plan of selected) {
		console.log(`[${plan.name}] ${plan.collection} ${JSON.stringify(plan.keys)}`);
		console.log(`   ${plan.why}`);
		if (plan.destructive) console.log('   *** INDEX INI MENGHAPUS DATA KEDALUWARSA ***');
		console.log('');
	}

	if (!execute) {
		console.log('Belum ada yang dibuat. Tambahkan --yes untuk benar-benar menjalankan.');
		console.log('Contoh: npm run indexes -- --yes --only=tokens_token\n');
		return;
	}

	console.log('=== Mulai membuat index ===');
	console.log('Proses ini bisa berjalan lama pada koleksi besar. Jangan dihentikan di tengah jalan.\n');

	for (const plan of selected) {
		const started = Date.now();
		process.stdout.write(`-> ${plan.name} ... `);

		try {
			// createIndex bersifat idempoten: kalau index dengan spesifikasi sama sudah ada,
			// MongoDB tidak membangunnya ulang.
			await db.collection(plan.collection).createIndex(plan.keys, {
				name: plan.name,
				...plan.options
			});

			const seconds = ((Date.now() - started) / 1000).toFixed(1);
			console.log(`selesai (${seconds} detik)`);
		} catch (err) {
			console.log('GAGAL');
			console.error(`   ${(err as Error).message}`);
		}
	}

	console.log('\nSelesai. Cek hasilnya dengan: npm run indexes -- --stats\n');
}

run()
	.catch((err) => {
		console.error('[FATAL]', (err as Error).message);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
