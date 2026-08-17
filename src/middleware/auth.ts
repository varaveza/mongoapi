import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from '../config/db.js';
import { config } from '../config/env.js';

interface CacheEntry {
	user: JwtPayload;
	expiresAt: number;
}

/**
 * Cache hasil verifikasi token.
 *
 * Kenapa perlu: middleware ini jalan di SETIAP request, dan tiap kali harus mencari
 * token di collection `tokens`. Collection itu terus bertambah (satu baris tiap login,
 * masa berlaku default 10 tahun, tidak pernah dibersihkan), jadi query berulang ke sana
 * adalah salah satu beban tetap terbesar API ini.
 *
 * Konsekuensinya: token yang di-logout masih bisa dipakai selama sisa TTL cache.
 * Untuk menghindari itu, route logout memanggil invalidateToken() supaya efeknya langsung.
 * Set TOKEN_CACHE_TTL_MS=0 untuk mematikan cache sepenuhnya.
 */
const tokenCache = new Map<string, CacheEntry>();

function cacheGet(token: string): JwtPayload | null {
	if (config.tokenCacheTtlMs <= 0) return null;

	const entry = tokenCache.get(token);
	if (!entry) return null;

	if (Date.now() > entry.expiresAt) {
		tokenCache.delete(token);
		return null;
	}

	// Masa berlaku JWT dicek ulang di sini. Tanpa ini, token yang baru saja
	// kedaluwarsa masih diterima selama sisa umur cache, karena jwt.verify()
	// tidak dijalankan lagi pada cache hit.
	if (typeof entry.user.exp === 'number' && Date.now() >= entry.user.exp * 1000) {
		tokenCache.delete(token);
		return null;
	}

	// Refresh posisi supaya entri yang sering dipakai tidak kebuang duluan.
	tokenCache.delete(token);
	tokenCache.set(token, entry);
	return entry.user;
}

function cacheSet(token: string, user: JwtPayload): void {
	if (config.tokenCacheTtlMs <= 0) return;

	if (tokenCache.size >= config.tokenCacheMax) {
		// Map menjaga urutan insert, jadi key pertama adalah yang paling lama tidak dipakai.
		const oldest = tokenCache.keys().next();
		if (!oldest.done) tokenCache.delete(oldest.value);
	}

	tokenCache.set(token, { user, expiresAt: Date.now() + config.tokenCacheTtlMs });
}

export function invalidateToken(token: string): void {
	tokenCache.delete(token);
}

export function clearTokenCache(): void {
	tokenCache.clear();
}

/** Perbandingan yang tidak membocorkan informasi lewat selisih waktu eksekusi. */
function safeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

export function extractBearerToken(req: Request): string | null {
	const header = req.get('Authorization');
	if (!header || !header.startsWith('Bearer ')) return null;
	const token = header.slice(7).trim();
	return token || null;
}

const PUBLIC_PATHS = new Set(['/health', '/api/auth/login']);

/**
 * Wajib memenuhi KEDUA syarat: JWT valid (dan belum di-revoke) DAN API key benar.
 * Perilaku ini dipertahankan sama persis seperti api.js lama.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
	if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(req.path)) {
		next();
		return;
	}

	// --- 1. API key ---
	const providedKey =
		req.get('x-api-key') ||
		(typeof req.query.api_key === 'string' ? req.query.api_key : null);

	const apiKeyValid = Boolean(providedKey) && safeCompare(providedKey as string, config.apiKey);

	// --- 2. JWT ---
	const token = extractBearerToken(req);
	let user: JwtPayload | null = null;

	if (token) {
		const cached = cacheGet(token);
		if (cached) {
			user = cached;
		} else {
			try {
				const decoded = jwt.verify(token, config.jwtSecret);
				if (typeof decoded === 'object' && decoded !== null) {
					// Token harus masih tercatat dan belum di-revoke di database.
					const db = await getDb();
					const tokenDoc = await db
						.collection('tokens')
						.findOne({ token, revoked: false }, { projection: { _id: 1 } });

					if (tokenDoc) {
						user = decoded;
						cacheSet(token, decoded);
					}
				}
			} catch {
				// Signature salah atau sudah kedaluwarsa - diperlakukan sama dengan tidak ada token.
			}
		}
	}

	if (!user) {
		res.status(401).json({
			error: 'Unauthorized - Valid JWT token required in Authorization header (Bearer token)'
		});
		return;
	}

	if (!apiKeyValid) {
		res.status(401).json({
			error: 'Unauthorized - Valid API key required in x-api-key header or ?api_key= query parameter'
		});
		return;
	}

	req.user = user;
	req.authType = 'jwt+api_key';
	next();
}
