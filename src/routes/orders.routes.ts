import { Router } from 'express';
import type { Document } from 'mongodb';
import { getDb } from '../config/db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getPagination, getStringQuery, pickSortField } from '../utils/helpers.js';
import { buildWaktuConditions, calculateWaktuRange, waktuSortableExpr } from '../utils/waktu.js';

export const ordersRouter = Router();

const SORT_FIELDS = ['waktu', 'total_bayar', 'jumlah_pembelian'] as const;

/**
 * GET /api/orders
 *
 * Versi lama (api.js) menjalankan `col.find(filter).toArray()` - menarik SELURUH dokumen
 * riwayats ke memory Node, lalu meratakan, menyaring, mengurutkan, dan memotong halaman
 * di JavaScript. Pada koleksi berisi ratusan juta transaksi itu bukan sekadar lambat,
 * tapi berisiko membuat proses kehabisan memory.
 *
 * Versi ini menyerahkan semua pekerjaan ke MongoDB:
 *   1. $match di level dokumen dulu (bisa memakai index) untuk memangkas kandidat
 *   2. baru $unwind untuk meratakan array data
 *   3. filter waktu, sorting, dan pagination dikerjakan di database
 *   4. $facet supaya perhitungan total dan pengambilan data cukup sekali jalan
 */
ordersRouter.get(
	'/',
	asyncHandler(async (req, res) => {
		const pagination = getPagination(req, 30);
		const idTele = getStringQuery(req, 'id_tele');
		const idTransaksi = getStringQuery(req, 'id_transaksi');
		const { sortBy, order } = pickSortField(req, SORT_FIELDS, 'waktu');

		const { finalWaktuFrom, finalWaktuTo } = calculateWaktuRange(getStringQuery(req, 'filter'));

		const db = await getDb();
		const col = db.collection('riwayats');

		const pipeline: Document[] = [];

		// --- Tahap 1: persempit di level dokumen selagi masih bisa memakai index ---
		if (idTele) {
			pipeline.push({ $match: { id_tele: idTele } });
		}
		if (idTransaksi) {
			// Menyaring dokumen yang punya transaksi ini di dalam array-nya.
			// Dengan index pada data.id_transaksi, tahap ini sangat murah.
			pipeline.push({ $match: { 'data.id_transaksi': idTransaksi } });
		}

		// --- Tahap 2: ratakan array data ---
		pipeline.push({ $unwind: '$data' });

		// --- Tahap 3: saring lagi di level elemen ---
		if (idTransaksi) {
			pipeline.push({ $match: { 'data.id_transaksi': idTransaksi } });
		}

		const waktuConditions = buildWaktuConditions('$data.waktu', finalWaktuFrom, finalWaktuTo);
		if (waktuConditions.length > 0) {
			pipeline.push({ $match: { $expr: { $and: waktuConditions } } });
		}

		// --- Tahap 4: bentuk hasil + siapkan kunci pengurutan ---
		const sortKeyExpr: Document =
			sortBy === 'waktu'
				? waktuSortableExpr('$data.waktu')
				: { $ifNull: [`$data.${sortBy}`, 0] };

		pipeline.push({
			$project: {
				_id: 0,
				id_tele: 1,
				nama_produk: '$data.nama_produk',
				id_transaksi: '$data.id_transaksi',
				variasi: '$data.variasi',
				jumlah_pembelian: '$data.jumlah_pembelian',
				total_bayar: '$data.total_bayar',
				waktu: '$data.waktu',
				_sortKey: sortKeyExpr
			}
		});

		// --- Tahap 5: hitung total dan ambil satu halaman dalam sekali jalan ---
		pipeline.push({
			$facet: {
				meta: [{ $count: 'total' }],
				items: [
					{ $sort: { _sortKey: order } },
					{ $skip: pagination.skip },
					{ $limit: pagination.limit },
					{ $project: { _sortKey: 0 } }
				]
			}
		});

		const [result] = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
		const total: number = result?.meta?.[0]?.total ?? 0;

		res.json({
			items: result?.items ?? [],
			page: pagination.page,
			limit: pagination.limit,
			total,
			pages: Math.ceil(total / pagination.limit)
		});
	})
);
