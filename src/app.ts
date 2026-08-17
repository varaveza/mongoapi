import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/env.js';
import { openapiSpec } from './docs/openapi.js';
import { authMiddleware } from './middleware/auth.js';
import { authRouter } from './routes/auth.routes.js';
import { productsRouter } from './routes/products.routes.js';
import { customersRouter } from './routes/customers.routes.js';
import { ordersRouter } from './routes/orders.routes.js';
import { riwayatsRouter } from './routes/riwayats.routes.js';

export function createApp() {
	const app = express();

	// Kalau berada di belakang nginx, ini membuat req.ip berisi IP asli pengunjung.
	if (config.trustProxy > 0) {
		app.set('trust proxy', config.trustProxy);
	}

	// Tidak membocorkan bahwa server ini memakai Express.
	app.disable('x-powered-by');

	app.use(
		cors({
			origin: config.corsOrigin,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
			credentials: false
		})
	);

	app.use(express.json({ limit: config.bodyLimit }));
	app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

	// Health check sengaja didaftarkan sebelum auth supaya bisa dipakai monitoring.
	app.get('/health', (_req, res) => {
		res.json({ ok: true });
	});

	// Dokumentasi Swagger, hanya kalau ENABLE_SWAGGER=true.
	// Didaftarkan sebelum gerbang auth supaya halamannya bisa dibuka; kredensial
	// tetap diminta saat menekan "Try it out" lewat tombol Authorize.
	if (config.enableSwagger) {
		const path = config.swaggerPath;

		app.get(`${path}.json`, (_req, res) => {
			res.json(openapiSpec);
		});

		app.use(
			path,
			swaggerUi.serve,
			swaggerUi.setup(openapiSpec as unknown as Record<string, unknown>, {
				customSiteTitle: 'MongoAPI Server',
				swaggerOptions: {
					persistAuthorization: true,
					// 'list' = tiap grup langsung memperlihatkan daftar operasinya.
					// Dengan 'none', semua grup tertutup dan endpoint jadi susah ditemukan.
					docExpansion: 'list',
					// Kotak pencarian untuk menyaring grup, mis. ketik "akun".
					filter: true,
					tagsSorter: 'alpha',
					operationsSorter: 'method',
					tryItOutEnabled: true
				}
			})
		);

		console.log(`[INFO] Dokumentasi Swagger aktif di ${path}`);
	}

	// Semua route di bawah ini wajib JWT + API key (kecuali yang dikecualikan di dalamnya).
	app.use(authMiddleware);

	app.use('/api/auth', authRouter);
	app.use('/api/products', productsRouter);
	app.use('/api/customers', customersRouter);
	app.use('/api/orders', ordersRouter);
	app.use('/api/riwayats', riwayatsRouter);

	app.use((_req, res) => {
		res.status(404).json({ error: 'Not found' });
	});

	app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
		const error = err as { type?: string; status?: number; message?: string };

		if (error?.type === 'entity.too.large') {
			res.status(413).json({ error: 'Payload too large' });
			return;
		}

		if (error?.type === 'entity.parse.failed') {
			res.status(400).json({ error: 'Invalid JSON body' });
			return;
		}

		// Detail error dicatat di log server, tapi tidak dikirim ke client -
		// pesan error MongoDB bisa membocorkan struktur database ke pemanggil dari luar.
		console.error('[ERROR]', error?.message || error);

		res.status(500).json({
			error: config.nodeEnv === 'production' ? 'Internal error' : error?.message || 'Internal error'
		});
	});

	return app;
}
