import { createApp } from './app.js';
import { config } from './config/env.js';
import { closeDb, warmUpDb } from './config/db.js';

async function main(): Promise<void> {
	// Koneksi diuji lebih dulu supaya salah konfigurasi ketahuan saat start,
	// bukan baru muncul sebagai error 500 di request pertama.
	try {
		await warmUpDb();
		console.log('[OK] Terhubung ke MongoDB');
	} catch (err) {
		console.error('[FATAL] Gagal terhubung ke MongoDB:', (err as Error).message);
		process.exit(1);
	}

	const app = createApp();
	const server = app.listen(config.port, () => {
		console.log(`[OK] API berjalan di http://127.0.0.1:${config.port} (${config.nodeEnv})`);
	});

	// Beri waktu request besar (upload list_akun) untuk selesai.
	server.requestTimeout = 300_000;
	server.headersTimeout = 310_000;

	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;

		console.log(`\n[INFO] ${signal} diterima, menutup server...`);

		server.close(async () => {
			await closeDb();
			console.log('[OK] Server ditutup dengan rapi');
			process.exit(0);
		});

		// Jangan menggantung selamanya kalau ada koneksi yang tidak mau tutup.
		setTimeout(() => {
			console.warn('[WARN] Timeout saat menutup, keluar paksa');
			process.exit(1);
		}, 15_000).unref();
	};

	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));

	process.on('unhandledRejection', (reason) => {
		console.error('[ERROR] Unhandled rejection:', reason);
	});
}

void main();
