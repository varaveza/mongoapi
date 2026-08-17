import { Router } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../config/db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
	buildPageResponse,
	escapeRegex,
	getPagination,
	getStringQuery,
	toObjectId
} from '../utils/helpers.js';

export const productsRouter = Router();

/** Bentuk produk tanpa list_akun. Dipakai di semua response supaya tidak menarik array raksasa. */
const PRODUCT_PROJECTION = {
	nama_produk: 1,
	deskripsi: 1,
	stok_terjual: 1,
	'variasi._id': 1,
	'variasi.nama': 1,
	'variasi.harga': 1
} as const;

function sortVariasiByNama(variasi: unknown): void {
	if (!Array.isArray(variasi)) return;
	variasi.sort((a: Document, b: Document) => {
		const namaA = String(a?.nama ?? '').toLowerCase();
		const namaB = String(b?.nama ?? '').toLowerCase();
		return namaA.localeCompare(namaB);
	});
}

// -------- Products --------

productsRouter.post(
	'/',
	asyncHandler(async (req, res) => {
		const { nama_produk, deskripsi } = (req.body ?? {}) as {
			nama_produk?: unknown;
			deskripsi?: unknown;
		};

		if (!nama_produk) {
			res.status(400).json({ error: 'nama_produk is required' });
			return;
		}

		const db = await getDb();
		const doc = {
			nama_produk,
			deskripsi: deskripsi ?? '',
			stok_terjual: 0,
			variasi: [] as Document[]
		};

		const result = await db.collection('products').insertOne(doc);
		res.status(201).json({ _id: result.insertedId, ...doc });
	})
);

/**
 * Daftar produk.
 *
 * Tanpa parameter `limit`, SELURUH produk dikembalikan sekaligus - koleksi produk
 * memang kecil (puluhan), jadi memecahnya jadi halaman malah merepotkan.
 * Kalau `limit` diisi, barulah dipaginasi seperti biasa. Bentuk responsenya sama
 * dalam kedua kasus, jadi pemanggil lama yang mengirim limit tidak terpengaruh.
 */
productsRouter.get(
	'/',
	asyncHandler(async (req, res) => {
		const q = getStringQuery(req, 'q');

		// escapeRegex mencegah input pencarian diperlakukan sebagai pola regex.
		const filter: Document = q
			? { nama_produk: { $regex: escapeRegex(q), $options: 'i' } }
			: {};

		const db = await getDb();
		const col = db.collection('products');

		const kueri = () => col.find(filter).project({ nama_produk: 1 }).sort({ _id: -1 });

		const mintaLimit = req.query.limit !== undefined && String(req.query.limit).trim() !== '';

		if (!mintaLimit) {
			const items = await kueri().toArray();
			// Jumlahnya diambil dari hasil itu sendiri, jadi tidak perlu query hitung terpisah.
			res.json({
				items,
				page: 1,
				limit: items.length,
				total: items.length,
				pages: items.length > 0 ? 1 : 0
			});
			return;
		}

		const pagination = getPagination(req, 20);
		const [total, items] = await Promise.all([
			col.countDocuments(filter),
			kueri().skip(pagination.skip).limit(pagination.limit).toArray()
		]);

		res.json(buildPageResponse(items, total, pagination));
	})
);

productsRouter.get(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const item = await db
			.collection('products')
			.findOne({ _id: id }, { projection: PRODUCT_PROJECTION });

		if (!item) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		sortVariasiByNama(item.variasi);
		res.json(item);
	})
);

productsRouter.put(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const { nama_produk, deskripsi } = (req.body ?? {}) as {
			nama_produk?: unknown;
			deskripsi?: unknown;
		};

		const update: Document = {};
		if (typeof nama_produk === 'string') update.nama_produk = nama_produk;
		if (typeof deskripsi === 'string') update.deskripsi = deskripsi;

		if (Object.keys(update).length === 0) {
			res.status(400).json({ error: 'Nothing to update' });
			return;
		}

		const db = await getDb();

		// findOneAndUpdate: satu kali jalan ke database, bukan update lalu find lagi.
		// Projection dipakai supaya response tidak ikut membawa seluruh list_akun.
		const doc = await db
			.collection('products')
			.findOneAndUpdate(
				{ _id: id },
				{ $set: update },
				{ returnDocument: 'after', projection: PRODUCT_PROJECTION }
			);

		if (!doc) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		sortVariasiByNama(doc.variasi);
		res.json(doc);
	})
);

productsRouter.delete(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const result = await db.collection('products').deleteOne({ _id: id });

		if (!result.deletedCount) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json({ ok: true });
	})
);

// -------- Variasi --------

/**
 * PENTING: route ini harus didaftarkan SEBELUM '/:id/variasi/:variasiId',
 * kalau tidak 'generate-ids' akan tertangkap sebagai :variasiId.
 */
productsRouter.post(
	'/:id/variasi/generate-ids',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const col = db.collection('products');

		// Hanya ambil _id variasi, JANGAN list_akun - di sini list_akun bisa puluhan MB.
		const product = await col.findOne({ _id: id }, { projection: { 'variasi._id': 1 } });

		if (!product) {
			res.status(404).json({ error: 'Product not found' });
			return;
		}

		if (!Array.isArray(product.variasi)) {
			res.json({ ok: true, generated: 0, message: 'No variasi found or variasi is not an array' });
			return;
		}

		const missing = product.variasi.filter((v: Document) => !v?._id).length;
		if (missing === 0) {
			res.json({ ok: true, generated: 0, message: 'All variasi already have IDs' });
			return;
		}

		/**
		 * Versi lama menulis ulang SELURUH array variasi (termasuk semua list_akun) hanya
		 * untuk menambahkan beberapa _id. Di sini setiap _id diisi satu per satu memakai
		 * positional operator, jadi yang ditulis hanya field _id-nya saja.
		 */
		let generated = 0;
		for (let i = 0; i < missing; i++) {
			const result = await col.updateOne(
				// { _id: null } pada query MongoDB cocok untuk field yang HILANG maupun yang
				// bernilai null. Memakai { $exists: false } saja akan melewatkan variasi
				// yang _id-nya tercatat null - dan data lama hasil impor sering begitu.
				{ _id: id, variasi: { $elemMatch: { _id: null } } },
				{ $set: { 'variasi.$._id': new ObjectId() } }
			);
			if (!result.modifiedCount) break;
			generated++;
		}

		res.json({
			ok: true,
			generated,
			message: `Generated ${generated} ID${generated > 1 ? 's' : ''} for variasi without _id`
		});
	})
);

productsRouter.get(
	'/:id/variasi',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const includeListAkun = req.query.includeListAkun === '1';
		const db = await getDb();
		const col = db.collection('products');

		if (includeListAkun) {
			// Peringatan: ini menarik seluruh list_akun. Untuk melihat isi akun secara
			// bertahap, pakai GET /:id/variasi/:variasiId/akun yang sudah dipaginasi.
			const product = await col.findOne({ _id: id }, { projection: { variasi: 1 } });

			if (!product) {
				res.status(404).json({ error: 'Not found' });
				return;
			}

			const variasi = product.variasi ?? [];
			sortVariasiByNama(variasi);
			res.json(variasi);
			return;
		}

		// Hitung jumlah akun di database ($size), jangan kirim arraynya ke Node.
		const agg = await col
			.aggregate([
				{ $match: { _id: id } },
				{
					$project: {
						_id: 0,
						variasi: {
							$map: {
								input: { $ifNull: ['$variasi', []] },
								as: 'v',
								in: {
									_id: '$$v._id',
									nama: '$$v.nama',
									harga: '$$v.harga',
									list_akun_count: { $size: { $ifNull: ['$$v.list_akun', []] } }
								}
							}
						}
					}
				},
				// Pengurutan dikerjakan di Node (lihat di bawah), bukan dengan $sortArray,
				// karena operator itu baru ada di MongoDB 5.2+.
			])
			.toArray();

		if (!agg.length) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		const daftarVariasi = agg[0]?.variasi ?? [];
		sortVariasiByNama(daftarVariasi);
		res.json(daftarVariasi);
	})
);

productsRouter.post(
	'/:id/variasi',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const { nama, harga, list_akun } = (req.body ?? {}) as {
			nama?: unknown;
			harga?: unknown;
			list_akun?: unknown;
		};

		if (!nama) {
			res.status(400).json({ error: 'nama is required' });
			return;
		}

		if (list_akun !== undefined && !Array.isArray(list_akun)) {
			res.status(400).json({ error: 'list_akun must be an array of strings' });
			return;
		}

		const variasi = {
			_id: new ObjectId(),
			nama,
			...(harga !== undefined ? { harga } : {}),
			list_akun: Array.isArray(list_akun) ? list_akun : []
		};

		const db = await getDb();
		const result = await db
			.collection('products')
			.updateOne({ _id: id }, { $push: { variasi: variasi } as Document });

		if (result.matchedCount === 0) {
			res.status(404).json({ error: 'Product not found' });
			return;
		}

		res.status(201).json(variasi);
	})
);

productsRouter.get(
	'/:id/variasi/:variasiId',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		const vid = toObjectId(req.params.variasiId);
		if (!id || !vid) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const doc = await db
			.collection('products')
			.findOne({ _id: id, 'variasi._id': vid }, { projection: { 'variasi.$': 1 } });

		const variasi = Array.isArray(doc?.variasi) ? doc.variasi[0] : null;
		if (!variasi) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json(variasi);
	})
);

/**
 * TAMBAHAN BARU: lihat isi list_akun secara bertahap.
 * Endpoint lama mengembalikan seluruh akun sekaligus, yang berat kalau satu variasi
 * berisi puluhan ribu baris. Di sini pemotongan dilakukan di database memakai $slice.
 */
productsRouter.get(
	'/:id/variasi/:variasiId/akun',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		const vid = toObjectId(req.params.variasiId);
		if (!id || !vid) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const pagination = getPagination(req, 50);
		const db = await getDb();

		const agg = await db
			.collection('products')
			.aggregate([
				{ $match: { _id: id } },
				{
					$project: {
						_id: 0,
						variasi: {
							$first: {
								$filter: {
									input: { $ifNull: ['$variasi', []] },
									as: 'v',
									cond: { $eq: ['$$v._id', vid] }
								}
							}
						}
					}
				},
				{
					$project: {
						nama: '$variasi.nama',
						harga: '$variasi.harga',
						total: { $size: { $ifNull: ['$variasi.list_akun', []] } },
						items: {
							$slice: [{ $ifNull: ['$variasi.list_akun', []] }, pagination.skip, pagination.limit]
						}
					}
				}
			])
			.toArray();

		const result = agg[0];
		if (!result || result.nama === undefined) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json({
			nama: result.nama,
			harga: result.harga,
			items: result.items ?? [],
			page: pagination.page,
			limit: pagination.limit,
			total: result.total ?? 0,
			pages: Math.ceil((result.total ?? 0) / pagination.limit)
		});
	})
);

productsRouter.put(
	'/:id/variasi/:variasiId',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		const vid = toObjectId(req.params.variasiId);
		if (!id || !vid) {
			res.status(400).json({ failed: true, error: 'Invalid id' });
			return;
		}

		const { nama, harga, list_akun } = (req.body ?? {}) as {
			nama?: unknown;
			harga?: unknown;
			list_akun?: unknown;
		};

		const update: Document = {};
		if (typeof nama === 'string') update['variasi.$.nama'] = nama;
		if (harga !== undefined) update['variasi.$.harga'] = harga;

		if (list_akun !== undefined) {
			if (!Array.isArray(list_akun)) {
				res.status(400).json({ failed: true, error: 'list_akun must be an array of strings' });
				return;
			}
			if (list_akun.some((item) => typeof item !== 'string')) {
				res.status(400).json({
					failed: true,
					error: 'list_akun must contain only strings (email|pass format)'
				});
				return;
			}
			update['variasi.$.list_akun'] = list_akun;
		}

		if (Object.keys(update).length === 0) {
			res.status(400).json({ failed: true, error: 'Nothing to update' });
			return;
		}

		const db = await getDb();
		const result = await db
			.collection('products')
			.updateOne({ _id: id, 'variasi._id': vid }, { $set: update });

		if (!result.matchedCount) {
			res.status(404).json({ failed: true, error: 'Not found' });
			return;
		}

		res.json({ success: true });
	})
);

/**
 * Menghitung jumlah akun pada satu variasi.
 * $size dihitung di dalam database, jadi isi arraynya tidak ikut dikirim ke Node.
 */
async function hitungAkun(
	db: Awaited<ReturnType<typeof getDb>>,
	productId: ObjectId,
	variasiId: ObjectId
): Promise<number> {
	const agg = await db
		.collection('products')
		.aggregate([
			{ $match: { _id: productId } },
			{
				$project: {
					_id: 0,
					count: {
						$let: {
							vars: {
								v: {
									$first: {
										$filter: {
											input: { $ifNull: ['$variasi', []] },
											as: 'v',
											cond: { $eq: ['$$v._id', variasiId] }
										}
									}
								}
							},
							in: { $size: { $ifNull: ['$$v.list_akun', []] } }
						}
					}
				}
			}
		])
		.toArray();

	return agg[0]?.count ?? 0;
}

function validasiListAkun(body: unknown): { ok: true; list: string[]; unique: boolean } | { ok: false; error: string } {
	const { list_akun, unique } = (body ?? {}) as { list_akun?: unknown; unique?: unknown };

	if (!Array.isArray(list_akun) || list_akun.length === 0) {
		return { ok: false, error: 'list_akun must be a non-empty array of strings' };
	}
	if (list_akun.some((item) => typeof item !== 'string')) {
		return { ok: false, error: 'list_akun must contain only strings (email|pass format)' };
	}

	return { ok: true, list: list_akun as string[], unique: unique === true };
}

/**
 * TAMBAH akun ke sebuah variasi - hanya menambah, tidak menimpa yang sudah ada.
 *
 * Bedanya dengan PUT /:id/variasi/:variasiId:
 *   PUT  -> mengganti SELURUH list_akun dengan isi yang dikirim (untuk mengedit)
 *   POST -> menambahkan di belakang yang sudah ada (untuk menambah stok)
 *
 * PUT berbahaya dipakai untuk menambah stok: client harus mengunduh seluruh daftar
 * akun lebih dulu, menempelkan yang baru, lalu mengirim balik semuanya. Selain berat,
 * kalau ada dua proses melakukannya bersamaan, yang satu akan menghapus hasil yang lain.
 * POST ini hanya mengirim akun barunya saja, dan penambahannya dikerjakan oleh MongoDB.
 *
 * Body:
 *   { "list_akun": ["email|pass", ...] }
 *   { "list_akun": [...], "unique": true }   -> lewati akun yang sudah ada di daftar
 */
const tambahAkunHandler = asyncHandler(async (req, res) => {
	const id = toObjectId(req.params.id);
	const vid = toObjectId(req.params.variasiId);
	if (!id || !vid) {
		res.status(400).json({ error: 'Invalid id' });
		return;
	}

	const parsed = validasiListAkun(req.body);
	if (!parsed.ok) {
		res.status(400).json({ error: parsed.error });
		return;
	}

	const db = await getDb();
	const col = db.collection('products');

	// Dihitung lebih dulu supaya bisa dilaporkan berapa yang benar-benar masuk
	// ketika mode unique membuang duplikat.
	const sebelum = parsed.unique ? await hitungAkun(db, id, vid) : null;

	const operasi = parsed.unique
		? { $addToSet: { 'variasi.$.list_akun': { $each: parsed.list } } }
		: { $push: { 'variasi.$.list_akun': { $each: parsed.list } } };

	const result = await col.updateOne({ _id: id, 'variasi._id': vid }, operasi as Document);

	if (!result.matchedCount) {
		res.status(404).json({ error: 'Product or variasi not found' });
		return;
	}

	const total = await hitungAkun(db, id, vid);
	const appended = parsed.unique ? total - (sebelum ?? 0) : parsed.list.length;

	res.json({
		ok: true,
		appended,
		...(parsed.unique ? { duplicates: parsed.list.length - appended } : {}),
		total,
		message: `Menambahkan ${appended} akun (total sekarang ${total})`
	});
});

productsRouter.post('/:id/variasi/:variasiId/akun', tambahAkunHandler);

/** Nama lama untuk endpoint yang sama, dipertahankan supaya pemanggil lama tidak putus. */
productsRouter.post('/:id/variasi/:variasiId/append-akun', tambahAkunHandler);

/** Batas aman sekali ambil, supaya satu permintaan tidak menarik terlalu banyak sekaligus. */
const MAX_AMBIL = 5000;

/**
 * AMBIL sejumlah akun dari daftar: keluar dari stok DAN dikembalikan ke pemanggil
 * dalam satu operasi yang tidak bisa disela.
 *
 * Ini yang membedakannya dari "lihat lalu hapus" secara terpisah: di antara kedua
 * langkah itu ada jeda, dan kalau bot kebetulan menjual akun yang sama pada jeda
 * tersebut, akun itu keluar dua kali ke dua orang berbeda. Di sini tidak ada jeda.
 *
 * Cara kerjanya memakai pola periksa-lalu-tulis (compare and swap):
 *   1. Baca posisi variasi, jumlah stok, dan N akun terdepan.
 *   2. Tulis dengan syarat N akun terdepan masih sama persis seperti yang dibaca.
 *   3. Kalau ternyata sudah berubah (ada yang menjual di sela-sela), tulisan ditolak
 *      oleh MongoDB sendiri, lalu diulang dari awal dengan data terbaru.
 *
 * Yang ditulis hanya field list_akun variasi bersangkutan, bukan seluruh dokumen produk.
 *
 * Body:
 *   { "jumlah": 100 }
 *   { "jumlah": 100, "harus_penuh": true }   -> batal kalau stok kurang dari 100
 */
productsRouter.post(
	'/:id/variasi/:variasiId/ambil',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		const vid = toObjectId(req.params.variasiId);
		if (!id || !vid) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const { jumlah, harus_penuh } = (req.body ?? {}) as { jumlah?: unknown; harus_penuh?: unknown };
		const n = Number.parseInt(String(jumlah), 10);

		if (!Number.isFinite(n) || n < 1) {
			res.status(400).json({ error: 'jumlah harus bilangan bulat positif' });
			return;
		}
		if (n > MAX_AMBIL) {
			res.status(400).json({ error: `jumlah maksimal ${MAX_AMBIL} untuk sekali ambil` });
			return;
		}

		const db = await getDb();
		const col = db.collection('products');

		for (let percobaan = 1; percobaan <= 4; percobaan++) {
			// --- Langkah 1: potret keadaan sekarang ---
			const [potret] = await col
				.aggregate([
					{ $match: { _id: id } },
					{
						$project: {
							_id: 0,
							// $map dipakai supaya posisi tetap sejajar walau ada variasi yang belum punya _id.
							idx: {
								$indexOfArray: [
									{
										$map: {
											input: { $ifNull: ['$variasi', []] },
											as: 'v',
											in: { $ifNull: ['$$v._id', null] }
										}
									},
									vid
								]
							},
							info: {
								$let: {
									vars: {
										v: {
											$first: {
												$filter: {
													input: { $ifNull: ['$variasi', []] },
													as: 'v',
													cond: { $eq: ['$$v._id', vid] }
												}
											}
										}
									},
									in: {
										size: { $size: { $ifNull: ['$$v.list_akun', []] } },
										depan: { $slice: [{ $ifNull: ['$$v.list_akun', []] }, n] }
									}
								}
							}
						}
					}
				])
				.toArray();

			const idx = potret?.idx;
			if (typeof idx !== 'number' || idx < 0) {
				res.status(404).json({ error: 'Product or variasi not found' });
				return;
			}

			const size: number = potret.info?.size ?? 0;
			const depan: string[] = potret.info?.depan ?? [];

			if (size === 0) {
				res.status(409).json({ error: 'Stok kosong', diambil: 0, items: [], sisa: 0 });
				return;
			}

			if (harus_penuh === true && size < n) {
				res.status(409).json({
					error: `Stok tidak cukup: diminta ${n}, tersedia ${size}`,
					diminta: n,
					tersedia: size
				});
				return;
			}

			const diambil = depan.slice(0, Math.min(n, size));
			const sisa = size - diambil.length;

			// --- Langkah 2: tulis hanya kalau bagian depan belum berubah ---
			const filter: Document = {
				_id: id,
				[`variasi.${idx}._id`]: vid,
				$expr: {
					$eq: [
						{
							$let: {
								vars: { v: { $arrayElemAt: ['$variasi', idx] } },
								in: { $slice: [{ $ifNull: ['$$v.list_akun', []] }, n] }
							}
						},
						depan
					]
				}
			};

			// $slice negatif pada $push menyisakan sekian elemen terakhir,
			// yang efeknya persis membuang sejumlah elemen terdepan.
			const update: Document =
				sisa > 0
					? { $push: { [`variasi.${idx}.list_akun`]: { $each: [], $slice: -sisa } } }
					: { $set: { [`variasi.${idx}.list_akun`]: [] } };

			const hasil = await col.updateOne(filter, update);

			if (hasil.matchedCount > 0) {
				res.json({
					ok: true,
					diminta: n,
					diambil: diambil.length,
					items: diambil,
					sisa,
					message: `Mengambil ${diambil.length} akun, sisa stok ${sisa}`
				});
				return;
			}

			// Tidak cocok berarti ada yang mengubah daftar barusan - ulangi dengan data terbaru.
		}

		res.status(409).json({
			error: 'Stok sedang sering berubah, tidak sempat mengambil dengan aman. Coba lagi.'
		});
	})
);

/**
 * HAPUS akun tertentu dari sebuah variasi, tanpa menulis ulang seluruh daftar.
 *
 * Pasangan dari POST di atas: kalau menambah stok tidak boleh lewat PUT, menghapus
 * akun yang sudah terjual atau rusak juga tidak boleh - alasannya sama persis.
 * Hanya akun yang teksnya sama persis yang dihapus.
 *
 * Body: { "list_akun": ["email|pass", ...] }
 */
productsRouter.delete(
	'/:id/variasi/:variasiId/akun',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		const vid = toObjectId(req.params.variasiId);
		if (!id || !vid) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const parsed = validasiListAkun(req.body);
		if (!parsed.ok) {
			res.status(400).json({ error: parsed.error });
			return;
		}

		const db = await getDb();
		const col = db.collection('products');

		const sebelum = await hitungAkun(db, id, vid);

		const result = await col.updateOne(
			{ _id: id, 'variasi._id': vid },
			{ $pullAll: { 'variasi.$.list_akun': parsed.list } } as Document
		);

		if (!result.matchedCount) {
			res.status(404).json({ error: 'Product or variasi not found' });
			return;
		}

		const total = await hitungAkun(db, id, vid);

		res.json({
			ok: true,
			removed: sebelum - total,
			total,
			message: `Menghapus ${sebelum - total} akun (sisa ${total})`
		});
	})
);

productsRouter.delete(
	'/:id/variasi/:variasiId',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		const vid = toObjectId(req.params.variasiId);
		if (!id || !vid) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const result = await db
			.collection('products')
			.updateOne({ _id: id }, { $pull: { variasi: { _id: vid } } as Document });

		if (!result.matchedCount) {
			res.status(404).json({ error: 'Product not found' });
			return;
		}

		res.json({ ok: true });
	})
);
