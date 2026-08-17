import { Router } from 'express';
import type { Document } from 'mongodb';
import { getDb } from '../config/db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
	buildPageResponse,
	countDocs,
	escapeRegex,
	getPagination,
	getStringQuery,
	pickSortField,
	toObjectId
} from '../utils/helpers.js';
import { buildWaktuConditions, calculateWaktuRange, waktuSortableExpr } from '../utils/waktu.js';

export const customersRouter = Router();

const SORT_FIELDS = ['_id', 'username_tele', 'id_tele', 'total_transaksi', 'balance', 'updated_at'] as const;

customersRouter.get(
	'/',
	asyncHandler(async (req, res) => {
		const pagination = getPagination(req, 20);
		const q = getStringQuery(req, 'q');
		const { sortBy, order } = pickSortField(req, SORT_FIELDS, '_id');

		const rawIdTele = Number.parseInt(String(req.query.id_tele ?? ''), 10);
		const idTele = Number.isFinite(rawIdTele) ? rawIdTele : null;

		const filter: Document = {};

		if (q) {
			const or: Document[] = [{ username_tele: { $regex: escapeRegex(q), $options: 'i' } }];
			// Hanya tambahkan pencarian numerik kalau input memang angka.
			const asNumber = Number(q);
			if (!Number.isNaN(asNumber)) or.push({ id_tele: asNumber });
			filter.$or = or;
		}

		if (idTele !== null) {
			filter.id_tele = idTele;
		}

		const db = await getDb();
		const col = db.collection('customers');

		const [total, items] = await Promise.all([
			countDocs(col, filter),
			col
				.find(filter)
				.sort({ [sortBy]: order })
				.skip(pagination.skip)
				.limit(pagination.limit)
				.toArray()
		]);

		res.json(buildPageResponse(items, total, pagination));
	})
);

/**
 * GET /api/customers/:id_tele/orders
 *
 * Sama seperti /api/orders, versi lama memuat seluruh dokumen riwayat pelanggan
 * (yang array `data`-nya bisa panjang sekali) lalu menyaring dan mengurutkan di memory.
 * Di sini semuanya dikerjakan di database dan hanya satu halaman yang dikirim balik.
 *
 * Catatan: pola route ini punya dua segmen ('/:id_tele/orders'), sedangkan detail
 * pelanggan hanya satu ('/:id'), jadi Express bisa membedakan keduanya tanpa
 * perlu route wildcard dan penguraian URL manual.
 */
customersRouter.get(
	'/:id_tele/orders',
	asyncHandler(async (req, res) => {
		const idTele = String(req.params.id_tele ?? '').trim();
		if (!idTele) {
			res.status(400).json({ error: 'id_tele is required' });
			return;
		}

		const pagination = getPagination(req, 20);
		const { finalWaktuFrom, finalWaktuTo } = calculateWaktuRange(getStringQuery(req, 'filter'));

		const db = await getDb();
		const col = db.collection('riwayats');

		const pipeline: Document[] = [
			{ $match: { id_tele: idTele } },
			{ $unwind: '$data' }
		];

		const waktuConditions = buildWaktuConditions('$data.waktu', finalWaktuFrom, finalWaktuTo);
		if (waktuConditions.length > 0) {
			pipeline.push({ $match: { $expr: { $and: waktuConditions } } });
		}

		pipeline.push({
			$project: {
				_id: 0,
				nama_produk: '$data.nama_produk',
				variasi: '$data.variasi',
				jumlah_pembelian: '$data.jumlah_pembelian',
				total_bayar: '$data.total_bayar',
				waktu: '$data.waktu',
				_sortKey: waktuSortableExpr('$data.waktu')
			}
		});

		pipeline.push({
			$facet: {
				meta: [{ $count: 'total' }],
				items: [
					{ $sort: { _sortKey: -1 } },
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

customersRouter.get(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const item = await db.collection('customers').findOne({ _id: id });

		if (!item) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json(item);
	})
);

customersRouter.put(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const { balance, total_transaksi, status } = (req.body ?? {}) as {
			balance?: unknown;
			total_transaksi?: unknown;
			status?: unknown;
		};

		const update: Document = {};

		if (balance !== undefined) {
			if (typeof balance !== 'number') {
				res.status(400).json({ error: 'balance must be a number' });
				return;
			}
			update.balance = balance;
		}

		if (total_transaksi !== undefined) {
			if (typeof total_transaksi !== 'number') {
				res.status(400).json({ error: 'total_transaksi must be a number' });
				return;
			}
			update.total_transaksi = total_transaksi;
		}

		if (status !== undefined) {
			if (typeof status !== 'string') {
				res.status(400).json({ error: 'status must be a string' });
				return;
			}
			const statusLower = status.toLowerCase();
			if (statusLower !== 'active' && statusLower !== 'suspend') {
				res.status(400).json({ error: 'status must be "active" or "suspend"' });
				return;
			}
			update.status = statusLower;
			// Dipertahankan demi kompatibilitas dengan field lama.
			update.baned = statusLower === 'suspend';
		}

		if (Object.keys(update).length === 0) {
			res.status(400).json({
				error: 'At least one field (balance, total_transaksi, or status) must be provided'
			});
			return;
		}

		update.updated_at = new Date().toISOString();

		const db = await getDb();
		const doc = await db
			.collection('customers')
			.findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: 'after' });

		if (!doc) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json(doc);
	})
);

customersRouter.delete(
	'/:id',
	asyncHandler(async (req, res) => {
		const id = toObjectId(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}

		const db = await getDb();
		const result = await db.collection('customers').deleteOne({ _id: id });

		if (!result.deletedCount) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		res.json({ ok: true });
	})
);
