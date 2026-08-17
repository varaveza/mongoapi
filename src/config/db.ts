import { MongoClient, type Db } from 'mongodb';
import { config } from './env.js';

/**
 * Satu MongoClient dipakai seumur hidup proses.
 * Driver MongoDB sudah punya connection pool sendiri, jadi JANGAN bikin client baru
 * per request - itu penyebab umum server terasa berat.
 */
const client = new MongoClient(config.mongoUri, {
	appName: 'mongoapi-server-ts',
	serverSelectionTimeoutMS: 8000,
	maxPoolSize: config.mongoMaxPoolSize,
	minPoolSize: config.mongoMinPoolSize,
	// Kirim ulang operasi sekali kalau ada gangguan jaringan sesaat.
	retryReads: true,
	retryWrites: true
});

let connectPromise: Promise<Db> | null = null;

export async function getDb(): Promise<Db> {
	if (!connectPromise) {
		// Disimpan sebagai promise supaya request yang datang barengan saat startup
		// tidak memicu connect() berkali-kali.
		connectPromise = client
			.connect()
			.then((c) => c.db())
			.catch((err) => {
				connectPromise = null;
				throw err;
			});
	}
	return connectPromise;
}

/** Dipanggil saat startup supaya kegagalan koneksi ketahuan langsung, bukan pas request pertama. */
export async function warmUpDb(): Promise<void> {
	const db = await getDb();
	await db.command({ ping: 1 });
}

export async function closeDb(): Promise<void> {
	if (connectPromise) {
		connectPromise = null;
		await client.close();
	}
}

export { client as mongoClient };
