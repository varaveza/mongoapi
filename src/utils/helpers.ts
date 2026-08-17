import { ObjectId } from 'mongodb';
import type { Request } from 'express';
import { config } from '../config/env.js';

export function toObjectId(id: unknown): ObjectId | null {
	if (!id || typeof id !== 'string') return null;
	if (!ObjectId.isValid(id)) return null;
	try {
		return new ObjectId(id);
	} catch {
		return null;
	}
}

/**
 * Banyak aplikasi PHP menyimpan hash bcrypt dengan prefix $2y$.
 * bcryptjs bisa memverifikasinya kalau dinormalisasi ke $2b$.
 */
export function normalizeBcryptPrefix(hash: string): string {
	if (typeof hash !== 'string') return hash;
	return hash.startsWith('$2y$') ? '$2b$' + hash.slice(4) : hash;
}

export interface Pagination {
	page: number;
	limit: number;
	skip: number;
}

export function getPagination(req: Request, defaultLimit = 20): Pagination {
	const rawPage = Number.parseInt(String(req.query.page ?? ''), 10);
	const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);

	const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
	const requested = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
	const limit = Math.min(requested, config.maxPageLimit);

	return { page, limit, skip: (page - 1) * limit };
}

export function getStringQuery(req: Request, key: string): string | null {
	const value = req.query[key];
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/** Escape karakter regex supaya input pencarian user tidak bisa jadi pola regex berbahaya. */
export function escapeRegex(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function pickSortField(
	req: Request,
	allowed: readonly string[],
	fallback: string
): { sortBy: string; order: 1 | -1 } {
	const raw = req.query.sort_by;
	const sortBy = typeof raw === 'string' && allowed.includes(raw) ? raw : fallback;
	const order: 1 | -1 = req.query.order === 'asc' ? 1 : -1;
	return { sortBy, order };
}

/**
 * Menghitung jumlah dokumen.
 *
 * Kalau tidak ada filter, dipakai estimatedDocumentCount() yang membaca metadata koleksi
 * dan selesai seketika. countDocuments() tanpa filter harus menelusuri seluruh koleksi -
 * pada koleksi berisi ratusan juta dokumen itu bisa memakan waktu sangat lama.
 *
 * Konsekuensi: angka total untuk permintaan tanpa filter bersifat perkiraan
 * (bisa sedikit meleset setelah crash yang tidak bersih).
 */
export async function countDocs(
	col: { countDocuments: (f: object) => Promise<number>; estimatedDocumentCount: () => Promise<number> },
	filter: object
): Promise<number> {
	const isEmpty = Object.keys(filter).length === 0;
	return isEmpty ? col.estimatedDocumentCount() : col.countDocuments(filter);
}

export function buildPageResponse<T>(items: T[], total: number, pagination: Pagination) {
	return {
		items,
		page: pagination.page,
		limit: pagination.limit,
		total,
		pages: Math.ceil(total / pagination.limit)
	};
}
