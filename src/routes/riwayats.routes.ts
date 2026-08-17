import { Router } from 'express';
import type { Document } from 'mongodb';
import { getDb } from '../config/db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getStringQuery, toObjectId } from '../utils/helpers.js';
import { buildWaktuConditions, calculateWaktuRange } from '../utils/waktu.js';

export const riwayatsRouter = Router();

/** Batas bawaan kalau pemanggil tidak menyebut `limit`. */
const RIWAYATS_LIMIT_BAWAAN = 100;

riwayatsRouter.get(
	'/',
	asyncHandler(async (req, res) => {
		const idTele = getStringQuery(req, 'id_tele');
		const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);

		/**
		 * Kalau `limit` tidak diisi, dipakai batas bawaan - TIDAK boleh dibiarkan tanpa batas.
		 *
		 * Alasannya: hasil $facet dikemas sebagai SATU dokumen, dan satu dokumen MongoDB
		 * dibatasi 16MB. Membiarkan cabang `items` tanpa batas berarti seluruh riwayat
		 * yang cocok dijejalkan ke dalam satu dokumen itu, dan pada koleksi sebesar ini
		 * permintaannya pasti gagal. Versi lama (api.js) juga menarik semuanya, bedanya
		 * dia kehabisan memory di Node, bukan ditolak MongoDB.
		 */
		const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : RIWAYATS_LIMIT_BAWAAN;

		const { finalWaktuFrom, finalWaktuTo } = calculateWaktuRange(getStringQuery(req, 'filter'));

		const match: Document = {};
		if (idTele) match.id_tele = idTele;

		const db = await getDb();
		const col = db.collection('riwayats');

		const waktuConditions = buildWaktuConditions('$$item.waktu', finalWaktuFrom, finalWaktuTo);

		// Susun isi array data. Kalau ada filter waktu, penyaringan dilakukan di dalam
		// database memakai $filter - bukan menarik semua data ke Node lalu disaring di sana.
		const mappedItem = {
			nama_produk: '$$item.nama_produk',
			variasi: '$$item.variasi',
			jumlah_pembelian: '$$item.jumlah_pembelian',
			total_bayar: '$$item.total_bayar',
			waktu: '$$item.waktu',
			id_transaksi: '$$item.id_transaksi'
		};

		const dataExpr: Document =
			waktuConditions.length > 0
				? {
						$filter: {
							input: { $ifNull: ['$data', []] },
							as: 'item',
							cond: {
								$and: [
									{ $ne: ['$$item.waktu', null] },
									{ $ne: ['$$item.waktu', ''] },
									...waktuConditions
								]
							}
						}
					}
				: { $ifNull: ['$data', []] };

		const pipeline: Document[] = [
			{ $match: match },
			{ $sort: { _id: -1 } },
			{ $project: { _id: 0, id_tele: 1, data: dataExpr } },
			// Ubah setiap elemen ke bentuk response setelah disaring.
			{
				$project: {
					id_tele: 1,
					data: { $map: { input: '$data', as: 'item', in: mappedItem } }
				}
			},
			// Buang customer yang tidak punya transaksi dalam rentang waktu tersebut.
			{ $match: { 'data.0': { $exists: true } } },
			{
				$facet: {
					meta: [{ $count: 'total' }],
					items: [{ $limit: limit }]
				}
			}
		];

		const [result] = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();

		res.json({
			items: result?.items ?? [],
			total: result?.meta?.[0]?.total ?? 0
		});
	})
);

riwayatsRouter.get(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const item = await db.collection('riwayats').findOne({ _id: id });

		if (!item) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json(item);
	})
);
