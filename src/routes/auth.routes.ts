import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { getDb } from '../config/db.js';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { extractBearerToken, invalidateToken } from '../middleware/auth.js';
import { normalizeBcryptPrefix } from '../utils/helpers.js';

export const authRouter = Router();

authRouter.post(
	'/login',
	asyncHandler(async (req, res) => {
		const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };

		if (!email || !password) {
			res.status(400).json({ error: 'email and password are required' });
			return;
		}

		const db = await getDb();
		const user = await db.collection('users').findOne(
			{ email: String(email).toLowerCase() },
			{ projection: { email: 1, name: 1, password: 1, remember_token: 1 } }
		);

		if (!user || !user.password) {
			res.status(401).json({ error: 'Invalid credentials' });
			return;
		}

		const ok = await bcrypt.compare(String(password), normalizeBcryptPrefix(String(user.password)));
		if (!ok) {
			res.status(401).json({ error: 'Invalid credentials' });
			return;
		}

		const tokenPayload = {
			_id: user._id.toString(),
			email: user.email,
			name: user.name
		};

		const token = jwt.sign(tokenPayload, config.jwtSecret, {
			expiresIn: config.jwtExpiresIn
		} as SignOptions);

		const decoded = jwt.decode(token);
		const expiresAt =
			decoded && typeof decoded === 'object' && typeof decoded.exp === 'number'
				? new Date(decoded.exp * 1000)
				: null;

		await db.collection('tokens').insertOne({
			user_id: user._id,
			token,
			email: user.email,
			created_at: new Date(),
			expires_at: expiresAt,
			revoked: false
		});

		res.json({
			ok: true,
			token,
			user: {
				_id: user._id,
				email: user.email,
				name: user.name,
				remember_token: user.remember_token ?? null
			}
		});
	})
);

authRouter.post(
	'/logout',
	asyncHandler(async (req, res) => {
		const token = extractBearerToken(req);
		if (!token) {
			res.status(401).json({ error: 'No token provided' });
			return;
		}

		const db = await getDb();
		const result = await db
			.collection('tokens')
			.updateOne({ token, revoked: false }, { $set: { revoked: true, revoked_at: new Date() } });

		// Buang dari cache supaya logout langsung berlaku, tidak menunggu TTL habis.
		invalidateToken(token);

		if (result.matchedCount === 0) {
			res.status(404).json({ error: 'Token not found or already revoked' });
			return;
		}

		res.json({ ok: true, message: 'Token revoked successfully' });
	})
);
