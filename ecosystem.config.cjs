/**
 * Konfigurasi PM2.
 *
 * Nama proses sengaja dibedakan dari 'mongoapi' (milik api.js lama) supaya keduanya
 * bisa hidup berdampingan saat masa peralihan, lalu yang lama dimatikan kalau sudah yakin.
 *
 * Pemakaian:
 *   npm install
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
	apps: [
		{
			name: 'mongoapi-ts',
			script: 'dist/src/index.js',
			cwd: __dirname,
			instances: 1,
			exec_mode: 'fork',
			env: {
				NODE_ENV: 'production'
				// Sisa konfigurasi dibaca dari file .env di folder ini,
				// termasuk ENABLE_SWAGGER untuk halaman dokumentasi di /docs.
			},
			error_file: './logs/error.log',
			out_file: './logs/out.log',
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			// Restart kalau pemakaian memory melewati batas ini.
			max_memory_restart: '1G',
			// Beri waktu request besar selesai sebelum proses benar-benar dimatikan.
			kill_timeout: 20000,
			watch: false
		}
	]
};
