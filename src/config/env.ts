import 'dotenv/config';

function required(name: string): string {
	const value = process.env[name];
	if (!value || !value.trim()) {
		console.error(`[FATAL] Environment variable ${name} wajib diisi. Cek file .env`);
		process.exit(1);
	}
	return value.trim();
}

function num(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) {
		console.warn(`[WARN] ${name}="${raw}" bukan angka valid, pakai default ${fallback}`);
		return fallback;
	}
	return parsed;
}

const MONGODB_URI = required('MONGODB_URI');
const API_KEY = required('API_KEY');

/**
 * PENTING soal JWT_SECRET.
 *
 * api.js yang lama memakai urutan: JWT_SECRET -> API_KEY -> string hardcoded.
 * Kalau di server JWT_SECRET tidak pernah diisi, berarti semua token yang beredar
 * sekarang (termasuk DRIP_TOKEN yang dipakai panel) ditandatangani memakai API_KEY.
 *
 * Karena itu fallback ke API_KEY DIPERTAHANKAN supaya token lama tetap valid.
 * Yang dihapus cuma fallback ke string hardcoded, karena itu berbahaya.
 *
 * Kalau nanti JWT_SECRET diisi dengan nilai baru, semua token lama akan langsung
 * ditolak dan setiap client (termasuk drip worker) harus login ulang.
 */
const JWT_SECRET = process.env.JWT_SECRET?.trim() || API_KEY;
if (!process.env.JWT_SECRET?.trim()) {
	console.warn(
		'[WARN] JWT_SECRET tidak diset, memakai API_KEY sebagai secret JWT (perilaku sama dengan api.js lama).\n' +
		'       Kalau mau memisahkannya, siapkan proses login ulang untuk semua client dulu.'
	);
}

function parseCorsOrigin(): string | string[] {
	const raw = process.env.CORS_ORIGIN?.trim();
	if (!raw || raw === '*') return '*';
	return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
	mongoUri: MONGODB_URI,
	mongoMaxPoolSize: num('MONGO_MAX_POOL_SIZE', 20),
	mongoMinPoolSize: num('MONGO_MIN_POOL_SIZE', 2),

	port: num('PORT', 3333),
	nodeEnv: process.env.NODE_ENV || 'development',
	trustProxy: num('TRUST_PROXY', 0),

	apiKey: API_KEY,
	jwtSecret: JWT_SECRET,
	jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || '10y',

	tokenCacheTtlMs: num('TOKEN_CACHE_TTL_MS', 60_000),
	tokenCacheMax: num('TOKEN_CACHE_MAX', 5000),

	bodyLimit: process.env.BODY_LIMIT?.trim() || '100mb',
	maxPageLimit: num('MAX_PAGE_LIMIT', 100),

	corsOrigin: parseCorsOrigin(),

	// Halaman dokumentasi Swagger. Sengaja mati secara bawaan: kalau API ini
	// dibuka ke internet, halaman itu memaparkan seluruh peta endpoint ke siapa saja.
	enableSwagger: process.env.ENABLE_SWAGGER?.trim().toLowerCase() === 'true',
	swaggerPath: process.env.SWAGGER_PATH?.trim() || '/docs',

	timezone: 'Asia/Jakarta' as const
};

export type AppConfig = typeof config;
