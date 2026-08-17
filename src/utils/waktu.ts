import { toZonedTime, format } from 'date-fns-tz';
import { subDays, subHours, startOfDay } from 'date-fns';
import { config } from '../config/env.js';

const TZ = config.timezone; // 'Asia/Jakarta'

export type FilterPreset = 'today' | '24h' | '7d' | '30d';

export interface WaktuRange {
	finalWaktuFrom: string | null;
	finalWaktuTo: string | null;
}

/**
 * Menghitung rentang waktu dari preset, dalam format "dd/MM/yyyy HH:mm:ss" zona Asia/Jakarta.
 * Perilakunya sengaja dibuat identik dengan api.js lama supaya hasil API tidak berubah.
 */
export function calculateWaktuRange(filterPreset: string | null | undefined): WaktuRange {
	if (!filterPreset) return { finalWaktuFrom: null, finalWaktuTo: null };

	const preset = String(filterPreset).toLowerCase();
	const now = toZonedTime(new Date(), TZ);
	const fmt = (d: Date) => format(d, 'dd/MM/yyyy HH:mm:ss', { timeZone: TZ });

	switch (preset) {
		case 'today':
			return { finalWaktuFrom: fmt(startOfDay(now)), finalWaktuTo: fmt(now) };
		case '24h':
			return { finalWaktuFrom: fmt(subHours(now, 24)), finalWaktuTo: fmt(now) };
		case '7d':
			return { finalWaktuFrom: fmt(startOfDay(subDays(now, 6))), finalWaktuTo: fmt(now) };
		case '30d':
			return { finalWaktuFrom: fmt(startOfDay(subDays(now, 29))), finalWaktuTo: fmt(now) };
		default:
			return { finalWaktuFrom: null, finalWaktuTo: null };
	}
}

/**
 * Ubah "dd/MM/yyyy HH:mm:ss" menjadi "yyyyMMddHH:mm:ss".
 *
 * Kenapa begini: field `waktu` di MongoDB disimpan sebagai STRING dengan format
 * hari-dulu, yang tidak bisa diurutkan/dibandingkan apa adanya ("02/01/2025" akan
 * dianggap lebih kecil dari "13/12/2024"). Dengan disusun ulang jadi tahun-bulan-hari
 * dengan lebar tetap, perbandingan string biasa jadi setara perbandingan waktu.
 *
 * CATATAN: fungsi ini sengaja TIDAK memakai Date.getHours()/getMonth() seperti versi
 * sebelumnya di bunserver, karena method itu mengikuti timezone server (biasanya UTC di VPS)
 * sehingga filter today/24h meleset 7 jam. Di sini konversi murni manipulasi string dari
 * nilai yang sudah dizonakan ke Asia/Jakarta oleh calculateWaktuRange().
 */
export function toSortableKey(waktuStr: string, defaultTime = '00:00:00'): string | null {
	if (!waktuStr || typeof waktuStr !== 'string') return null;

	const trimmed = waktuStr.trim();
	const spaceIdx = trimmed.indexOf(' ');
	const datePart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const timePart = spaceIdx === -1 ? defaultTime : trimmed.slice(spaceIdx + 1).trim() || defaultTime;

	const segments = datePart.split('/');
	if (segments.length !== 3) return null;

	const [day, month, year] = segments as [string, string, string];
	if (!day || !month || !year) return null;

	return `${year.padStart(4, '0')}${month.padStart(2, '0')}${day.padStart(2, '0')}${timePart}`;
}

/**
 * Versi aggregation-pipeline dari toSortableKey().
 * Menghasilkan ekspresi MongoDB yang mengubah field waktu jadi "yyyyMMddHH:mm:ss",
 * sehingga filter dan sorting bisa dikerjakan di dalam database, bukan di memory Node.
 *
 * @param fieldPath contoh: '$waktu' atau '$$item.waktu'
 */
export function waktuSortableExpr(fieldPath: string, defaultTime = '00:00:00'): Record<string, unknown> {
	const safe = { $ifNull: [fieldPath, ''] };
	const bySlash = { $split: [safe, '/'] };
	const bySpace = { $split: [safe, ' '] };

	const part = (index: number, length: number) => ({
		$substrCP: [{ $ifNull: [{ $arrayElemAt: [bySlash, index] }, ''] }, 0, length]
	});

	return {
		$concat: [
			part(2, 4), // yyyy (elemen ke-3 berisi "yyyy HH:mm:ss", ambil 4 karakter pertama)
			part(1, 2), // MM
			part(0, 2), // dd
			{ $ifNull: [{ $arrayElemAt: [bySpace, 1] }, defaultTime] } // HH:mm:ss
		]
	};
}

/**
 * Membangun kondisi $expr untuk memfilter rentang waktu di dalam aggregation pipeline.
 * Mengembalikan array kondisi (bisa kosong kalau tidak ada filter).
 */
export function buildWaktuConditions(
	fieldPath: string,
	finalWaktuFrom: string | null,
	finalWaktuTo: string | null
): Record<string, unknown>[] {
	const conditions: Record<string, unknown>[] = [];

	if (finalWaktuFrom) {
		const fromKey = toSortableKey(finalWaktuFrom, '00:00:00');
		if (fromKey) {
			conditions.push({ $gte: [waktuSortableExpr(fieldPath, '00:00:00'), fromKey] });
		}
	}

	if (finalWaktuTo) {
		const toKey = toSortableKey(finalWaktuTo, '23:59:59');
		if (toKey) {
			conditions.push({ $lte: [waktuSortableExpr(fieldPath, '23:59:59'), toKey] });
		}
	}

	return conditions;
}

/** Parse "dd/MM/yyyy HH:mm:ss" (dianggap WIB / UTC+7) menjadi Date. */
export function parseWaktu(waktuStr: string | null | undefined): Date | null {
	if (!waktuStr) return null;

	const trimmed = String(waktuStr).trim();
	const [datePart, timePartRaw] = trimmed.split(' ');
	const timePart = timePartRaw || '00:00:00';
	if (!datePart) return null;

	const segments = datePart.split('/');
	if (segments.length !== 3) return null;

	const [day, month, year] = segments as [string, string, string];
	if (!day || !month || !year) return null;

	const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}+07:00`;
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Ubah Date menjadi string "dd/MM/yyyy HH:mm:ss" dalam zona Asia/Jakarta. */
export function formatWaktu(date: Date): string {
	return format(toZonedTime(date, TZ), 'dd/MM/yyyy HH:mm:ss', { timeZone: TZ });
}
