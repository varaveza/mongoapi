/**
 * Spesifikasi OpenAPI 3.0.
 *
 * Ditulis sebagai satu berkas terpisah, bukan sebagai komentar JSDoc yang ditempel
 * di tiap route seperti cara swagger-jsdoc. Alasannya: kode route jadi tidak
 * tenggelam di antara puluhan baris anotasi, dan tidak ada biaya penguraian
 * komentar setiap kali server start.
 */

const ID = {
	in: 'path',
	name: 'id',
	required: true,
	schema: { type: 'string' },
	example: '',
	description:
		'Product ID (ObjectId 24 karakter hex). ' +
		'Ambil dari GET /api/products — JANGAN memakai angka contoh, isi dengan ID milikmu sendiri.'
} as const;

const VARIASI_ID = {
	in: 'path',
	name: 'variasiId',
	required: true,
	schema: { type: 'string' },
	example: '',
	description:
		'Variasi ID (ObjectId 24 karakter hex). ' +
		'Ambil dari GET /api/products/{id}/variasi lebih dulu — JANGAN memakai angka contoh. ' +
		'Kalau di sana _id-nya kosong, jalankan POST /api/products/{id}/variasi/generate-ids dulu.'
} as const;

const PAGE = {
	in: 'query',
	name: 'page',
	schema: { type: 'integer', minimum: 1, default: 1 },
	description: 'Nomor halaman'
} as const;

const LIMIT = (def: number) =>
	({
		in: 'query',
		name: 'limit',
		schema: { type: 'integer', minimum: 1, default: def },
		description: `Jumlah item per halaman (dibatasi MAX_PAGE_LIMIT, bawaan 100)`
	}) as const;

const FILTER_WAKTU = {
	in: 'query',
	name: 'filter',
	schema: { type: 'string', enum: ['today', '24h', '7d', '30d'] },
	description:
		'Rentang waktu siap pakai, memakai zona Asia/Jakarta. ' +
		'today = sejak 00:00 hari ini, 24h = 24 jam terakhir, ' +
		'7d = 7 hari terakhir termasuk hari ini, 30d = 30 hari terakhir termasuk hari ini.'
} as const;

const err = (deskripsi: string, contoh: string) => ({
	description: deskripsi,
	content: {
		'application/json': {
			schema: { $ref: '#/components/schemas/Error' },
			example: { error: contoh }
		}
	}
});

const RESP = {
	400: err('Permintaan tidak valid', 'Invalid id'),
	401: err(
		'Belum terautentikasi. Ingat: JWT dan API key harus dikirim BERSAMAAN.',
		'Unauthorized - Valid JWT token required in Authorization header (Bearer token)'
	),
	404: err('Tidak ditemukan', 'Not found'),
	413: err('Body terlalu besar', 'Payload too large'),
	500: err('Kesalahan di sisi server', 'Internal error')
};

const halaman = (itemSchema: object) => ({
	type: 'object',
	properties: {
		items: { type: 'array', items: itemSchema },
		page: { type: 'integer', example: 1 },
		limit: { type: 'integer', example: 20 },
		total: { type: 'integer', example: 100 },
		pages: { type: 'integer', example: 5 }
	}
});

export const openapiSpec = {
	openapi: '3.0.3',

	info: {
		title: 'MongoAPI Server',
		version: '1.0.0',
		description: `
API untuk melihat dan mengubah data produk, stok akun, pelanggan, dan riwayat transaksi.

### Autentikasi

Semua endpoint kecuali \`/health\` dan \`/api/auth/login\` memerlukan **DUA-DUANYA sekaligus**:

1. **JWT** — dari \`POST /api/auth/login\`, dikirim sebagai \`Authorization: Bearer <token>\`
2. **API key** — dikirim sebagai header \`x-api-key\`

Kalau salah satu tidak ada atau salah, jawabannya \`401\`.

Klik tombol **Authorize** di kanan atas untuk mengisi keduanya, lalu semua tombol
"Try it out" di halaman ini akan ikut membawa kredensialnya.

### Urutan memakai halaman ini

Endpoint yang memerlukan ID **tidak bisa dicoba dengan angka contoh** — isi dengan ID milikmu:

1. \`GET /api/products\` → salin \`_id\` produk yang dituju
2. \`GET /api/products/{id}/variasi\` → salin \`_id\` variasi yang dituju
3. Baru pakai ID itu di endpoint lain

Kalau langkah 2 mengembalikan variasi tanpa \`_id\` (data lama hasil impor), jalankan
\`POST /api/products/{id}/variasi/generate-ids\` dulu.

### Mengelola stok akun

Bagian ini yang paling sering dipakai, dan tiap operasi punya endpoint sendiri:

| Kebutuhan | Endpoint |
|---|---|
| Lihat seluruh isi | \`GET /api/products/{id}/variasi/{variasiId}\` |
| Lihat bertahap | \`GET /api/products/{id}/variasi/{variasiId}/akun\` |
| Edit / ganti seluruhnya | \`PUT /api/products/{id}/variasi/{variasiId}\` |
| Tambah stok | \`POST /api/products/{id}/variasi/{variasiId}/akun\` |
| Ambil N akun (stok berkurang) | \`POST /api/products/{id}/variasi/{variasiId}/ambil\` |
| Hapus akun tertentu | \`DELETE /api/products/{id}/variasi/{variasiId}/akun\` |

**Jangan memakai PUT untuk menambah atau mengurangi stok.** PUT mengganti seluruh isi,
jadi kalau bot menjual sesuatu selagi kamu mengedit, penjualan itu akan tertimpa dan
akun yang sudah terjual hidup lagi di stok.
		`.trim()
	},

	servers: [{ url: '/', description: 'Server ini' }],

	tags: [
		{ name: 'Health', description: 'Pemeriksaan status' },
		{ name: 'Auth', description: 'Login dan logout' },
		{ name: 'Products', description: 'CRUD produk' },
		{ name: 'Variasi', description: 'Varian di dalam produk' },
		{ name: 'Akun', description: 'Stok akun di dalam variasi' },
		{ name: 'Customers', description: 'Data pembeli' },
		{ name: 'Orders', description: 'Transaksi dalam bentuk datar' },
		{ name: 'Riwayats', description: 'Riwayat transaksi per pembeli' }
	],

	components: {
		securitySchemes: {
			BearerAuth: {
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT',
				description: 'Token dari POST /api/auth/login'
			},
			ApiKeyAuth: {
				type: 'apiKey',
				in: 'header',
				name: 'x-api-key',
				description: 'Nilai API_KEY dari berkas .env di server'
			}
		},

		schemas: {
			Error: {
				type: 'object',
				properties: { error: { type: 'string' } }
			},

			Ok: {
				type: 'object',
				properties: { ok: { type: 'boolean', example: true } }
			},

			VariasiRingkas: {
				type: 'object',
				properties: {
					_id: { type: 'string', example: '68ab1398b373e4ccc3068813' },
					nama: { type: 'string', example: '14 Day 1pcs' },
					harga: { type: 'integer', example: 2500 },
					list_akun_count: {
						type: 'integer',
						example: 1502,
						description: 'Jumlah akun, dihitung di database tanpa mengirim isinya'
					}
				}
			},

			VariasiLengkap: {
				type: 'object',
				description:
					'Field `reserved_list_akun` yang ada di database sengaja tidak disertakan. ' +
					'Akibatnya, kalau stok sebuah variasi sedang berada di array itu, variasi ini ' +
					'tampil dengan list_akun kosong.',
				properties: {
					_id: { type: 'string' },
					nama: { type: 'string', example: '14 Day 1pcs' },
					harga: { type: 'integer', example: 2500 },
					list_akun: {
						type: 'array',
						items: { type: 'string' },
						example: ['email@domain.com|password123', 'email2@domain.com|password456']
					}
				}
			},

			Product: {
				type: 'object',
				properties: {
					_id: { type: 'string' },
					nama_produk: { type: 'string', example: 'Zoom' },
					deskripsi: { type: 'string', example: 'Private, S&K: premiumisme.co' },
					stok_terjual: { type: 'integer', example: 503360 },
					variasi: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								_id: { type: 'string' },
								nama: { type: 'string' },
								harga: { type: 'integer' }
							}
						},
						description: 'Tanpa list_akun, supaya response tidak membengkak'
					}
				}
			},

			Customer: {
				type: 'object',
				properties: {
					_id: { type: 'string' },
					username_tele: { type: 'string', example: 'si_bondjol' },
					id_tele: { type: 'integer', example: 6221896319 },
					total_transaksi: { type: 'integer', example: 3431739 },
					balance: { type: 'integer', example: 6000 },
					baned: { type: 'boolean', example: false },
					status: { type: 'string', enum: ['active', 'suspend'] },
					updated_at: { type: 'string', example: '2025-01-13T09:58:32.000Z' }
				}
			},

			Order: {
				type: 'object',
				properties: {
					id_tele: { type: 'string', example: '6990830243' },
					nama_produk: { type: 'string', example: 'Zoom' },
					id_transaksi: { type: 'string', example: 'PREM-813T09Q' },
					variasi: { type: 'string', example: '14 Day 1pcs' },
					jumlah_pembelian: { type: 'integer', example: 1 },
					total_bayar: { type: 'integer', example: 2500 },
					waktu: {
						type: 'string',
						example: '13/12/2024 10:18:34',
						description: 'Format DD/MM/YYYY HH:mm:ss, zona Asia/Jakarta'
					}
				}
			}
		}
	},

	security: [{ BearerAuth: [], ApiKeyAuth: [] }],

	paths: {
		'/health': {
			get: {
				tags: ['Health'],
				summary: 'Cek server hidup',
				security: [],
				responses: {
					200: {
						description: 'Server hidup',
						content: { 'application/json': { example: { ok: true } } }
					}
				}
			}
		},

		'/api/auth/login': {
			post: {
				tags: ['Auth'],
				summary: 'Login, dapatkan JWT',
				description:
					'Tidak memerlukan autentikasi. Simpan `token` dari response, lalu isi lewat tombol Authorize di atas.',
				security: [],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['email', 'password'],
								properties: {
									email: { type: 'string', example: 'admin@email.com' },
									password: { type: 'string', example: 'rahasia' }
								}
							}
						}
					}
				},
				responses: {
					200: {
						description: 'Berhasil',
						content: {
							'application/json': {
								example: {
									ok: true,
									token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
									user: { _id: '68ab1398b373e4ccc3068812', email: 'admin@email.com', name: 'admin', remember_token: null }
								}
							}
						}
					},
					400: err('Field kurang', 'email and password are required'),
					401: err('Email atau password salah', 'Invalid credentials')
				}
			}
		},

		'/api/auth/logout': {
			post: {
				tags: ['Auth'],
				summary: 'Cabut token yang sedang dipakai',
				description: 'Token ditandai revoked di database dan langsung dibuang dari cache, jadi efeknya seketika.',
				responses: {
					200: { description: 'Token dicabut', content: { 'application/json': { example: { ok: true, message: 'Token revoked successfully' } } } },
					401: err('Token tidak dikirim', 'No token provided'),
					404: err('Token tidak ada atau sudah dicabut', 'Token not found or already revoked')
				}
			}
		},

		'/api/products': {
			get: {
				tags: ['Products'],
				summary: 'Daftar produk (seluruhnya, tanpa dipaginasi)',
				description:
					'Tanpa parameter `limit`, seluruh produk dikembalikan sekaligus — koleksi produk memang ' +
					'kecil. Isi `limit` kalau memang ingin dipecah per halaman.\n\n' +
					'Yang dikembalikan hanya nama produk. Untuk detail beserta variasinya, panggil endpoint per-ID.',
				parameters: [
					PAGE,
					{
						in: 'query',
						name: 'limit',
						schema: { type: 'integer', minimum: 1 },
						description: 'Kosongkan untuk mendapat semua produk. Kalau diisi, hasilnya dipecah per halaman.'
					},
					{
						in: 'query',
						name: 'q',
						schema: { type: 'string' },
						description: 'Cari berdasarkan nama produk. Diperlakukan sebagai teks biasa, bukan pola regex.'
					}
				],
				responses: {
					200: {
						description: 'Berhasil',
						content: {
							'application/json': {
								schema: halaman({ type: 'object', properties: { _id: { type: 'string' }, nama_produk: { type: 'string' } } })
							}
						}
					},
					401: RESP[401]
				}
			},
			post: {
				tags: ['Products'],
				summary: 'Buat produk baru',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['nama_produk'],
								properties: {
									nama_produk: { type: 'string', example: 'Zoom' },
									deskripsi: { type: 'string', example: 'Private, S&K: premiumisme.co' }
								}
							}
						}
					}
				},
				responses: {
					201: { description: 'Dibuat', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
					400: err('nama_produk kosong', 'nama_produk is required'),
					401: RESP[401]
				}
			}
		},

		'/api/products/{id}': {
			get: {
				tags: ['Products'],
				summary: 'Detail produk',
				description: 'Variasi diurutkan menurut nama. `list_akun` sengaja tidak disertakan.',
				parameters: [ID],
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			},
			put: {
				tags: ['Products'],
				summary: 'Ubah nama atau deskripsi produk',
				parameters: [ID],
				requestBody: {
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: { nama_produk: { type: 'string' }, deskripsi: { type: 'string' } }
							}
						}
					}
				},
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
					400: err('Tidak ada yang diubah', 'Nothing to update'),
					401: RESP[401], 404: RESP[404]
				}
			},
			delete: {
				tags: ['Products'],
				summary: 'Hapus produk',
				parameters: [ID],
				responses: {
					200: { description: 'Terhapus', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			}
		},

		'/api/products/{id}/variasi': {
			get: {
				tags: ['Variasi'],
				summary: 'Daftar variasi sebuah produk',
				parameters: [
					ID,
					{
						in: 'query',
						name: 'includeListAkun',
						schema: { type: 'string', enum: ['1'] },
						description:
							'Isi "1" untuk ikut mengembalikan seluruh isi list_akun tiap variasi. ' +
							'Tanpa ini, yang dikembalikan hanya jumlahnya (list_akun_count).'
					}
				],
				responses: {
					200: {
						description: 'Berhasil',
						content: {
							'application/json': {
								schema: {
									oneOf: [
										{ type: 'array', items: { $ref: '#/components/schemas/VariasiRingkas' } },
										{ type: 'array', items: { $ref: '#/components/schemas/VariasiLengkap' } }
									]
								}
							}
						}
					},
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			},
			post: {
				tags: ['Variasi'],
				summary: 'Tambah variasi baru',
				parameters: [ID],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['nama'],
								properties: {
									nama: { type: 'string', example: '14 Day 1pcs' },
									harga: { type: 'integer', example: 2500 },
									list_akun: { type: 'array', items: { type: 'string' }, example: ['email@domain.com|pass'] }
								}
							}
						}
					}
				},
				responses: {
					201: { description: 'Dibuat', content: { 'application/json': { schema: { $ref: '#/components/schemas/VariasiLengkap' } } } },
					400: err('nama kosong', 'nama is required'),
					401: RESP[401], 404: err('Produk tidak ada', 'Product not found')
				}
			}
		},

		'/api/products/{id}/variasi/generate-ids': {
			post: {
				tags: ['Variasi'],
				summary: 'Isikan _id untuk variasi yang belum punya',
				description:
					'Berguna untuk data lama hasil impor. Hanya field _id yang ditulis; isi list_akun tidak disentuh.',
				parameters: [ID],
				responses: {
					200: {
						description: 'Selesai',
						content: { 'application/json': { example: { ok: true, generated: 3, message: 'Generated 3 IDs for variasi without _id' } } }
					},
					400: RESP[400], 401: RESP[401], 404: err('Produk tidak ada', 'Product not found')
				}
			}
		},

		'/api/products/{id}/variasi/{variasiId}': {
			get: {
				tags: ['Variasi'],
				summary: 'Detail satu variasi, LENGKAP dengan seluruh akunnya',
				description:
					'Tidak dipaginasi dan tidak dipotong. Ini yang dipakai kalau mau melihat semua isi lalu mengeditnya.',
				parameters: [ID, VARIASI_ID],
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: { $ref: '#/components/schemas/VariasiLengkap' } } } },
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			},
			put: {
				tags: ['Variasi'],
				summary: 'Edit variasi — MENGGANTI seluruh isi list_akun',
				description:
					'**Perhatian:** kalau `list_akun` disertakan, isinya mengganti seluruh daftar yang ada, ' +
					'bukan menambah. Untuk menambah stok pakai `POST .../akun`, untuk mengambil pakai ' +
					'`POST .../ambil`, untuk menghapus tertentu pakai `DELETE .../akun`. ' +
					'Memakai PUT untuk itu berisiko menimpa penjualan yang terjadi selagi kamu mengedit.',
				parameters: [ID, VARIASI_ID],
				requestBody: {
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									nama: { type: 'string' },
									harga: { type: 'integer' },
									list_akun: { type: 'array', items: { type: 'string' } }
								}
							}
						}
					}
				},
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { example: { success: true } } } },
					400: err('Tidak ada yang diubah', 'Nothing to update'),
					401: RESP[401], 404: RESP[404]
				}
			},
			delete: {
				tags: ['Variasi'],
				summary: 'Hapus variasi',
				parameters: [ID, VARIASI_ID],
				responses: {
					200: { description: 'Terhapus', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
					400: RESP[400], 401: RESP[401], 404: err('Produk tidak ada', 'Product not found')
				}
			}
		},

		'/api/products/{id}/variasi/{variasiId}/akun': {
			get: {
				tags: ['Akun'],
				summary: 'Lihat akun secara bertahap',
				description: 'Pemotongan halaman dikerjakan di database, jadi tidak menarik puluhan ribu baris sekaligus.',
				parameters: [ID, VARIASI_ID, PAGE, LIMIT(50)],
				responses: {
					200: {
						description: 'Berhasil',
						content: {
							'application/json': {
								example: {
									nama: '14 Day 1pcs', harga: 2500,
									items: ['email1@x.com|pass1', 'email2@x.com|pass2'],
									page: 1, limit: 50, total: 1502, pages: 31
								}
							}
						}
					},
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			},
			post: {
				tags: ['Akun'],
				summary: 'TAMBAH akun — tidak menimpa yang sudah ada',
				description:
					'Cukup kirim akun barunya saja. Penggabungan dikerjakan MongoDB, jadi aman walau ' +
					'bersamaan dengan proses lain yang juga sedang menulis.',
				parameters: [ID, VARIASI_ID],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['list_akun'],
								properties: {
									list_akun: { type: 'array', items: { type: 'string' }, example: ['email1@x.com|pass1', 'email2@x.com|pass2'] },
									unique: { type: 'boolean', default: false, description: 'Kalau true, akun yang sudah ada dilewati' }
								}
							}
						}
					}
				},
				responses: {
					200: { description: 'Ditambahkan', content: { 'application/json': { example: { ok: true, appended: 2, total: 1504, message: 'Menambahkan 2 akun (total sekarang 1504)' } } } },
					400: err('Daftar kosong atau berisi non-teks', 'list_akun must be a non-empty array of strings'),
					401: RESP[401], 404: err('Produk atau variasi tidak ada', 'Product or variasi not found')
				}
			},
			delete: {
				tags: ['Akun'],
				summary: 'HAPUS akun tertentu',
				description: 'Hanya akun yang teksnya sama persis yang dihapus. Kalau tercatat dua kali, dua-duanya hilang.',
				parameters: [ID, VARIASI_ID],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['list_akun'],
								properties: { list_akun: { type: 'array', items: { type: 'string' }, example: ['email1@x.com|pass1'] } }
							}
						}
					}
				},
				responses: {
					200: { description: 'Terhapus', content: { 'application/json': { example: { ok: true, removed: 1, total: 1503 } } } },
					400: RESP[400], 401: RESP[401], 404: err('Produk atau variasi tidak ada', 'Product or variasi not found')
				}
			}
		},

		'/api/products/{id}/variasi/{variasiId}/ambil': {
			post: {
				tags: ['Akun'],
				summary: 'AMBIL sejumlah akun — keluar dari stok dan isinya dikembalikan',
				description:
					'Kirim angkanya saja, dapat akunnya, stok langsung berkurang — semuanya dalam satu ' +
					'tindakan yang tidak bisa disela.\n\n' +
					'Bedanya dengan "lihat dulu lalu hapus": cara dua langkah punya jeda, dan kalau bot ' +
					'kebetulan menjual akun yang sama pada jeda itu, akun tersebut keluar dua kali ke dua ' +
					'pembeli berbeda. Di sini jeda itu tidak ada, jadi aman dipanggil bersamaan dari beberapa ' +
					'perangkat selagi bot tetap jalan.\n\n' +
					'Yang diambil selalu dari urutan terdepan (stok paling lama keluar duluan). ' +
					'Batas 5000 akun sekali ambil.',
				parameters: [ID, VARIASI_ID],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['jumlah'],
								properties: {
									jumlah: { type: 'integer', minimum: 1, maximum: 5000, example: 100 },
									harus_penuh: {
										type: 'boolean',
										default: false,
										description:
											'Kalau true dan stok kurang dari yang diminta, permintaan dibatalkan dan ' +
											'tidak ada satu pun akun yang diambil.'
									}
								}
							}
						}
					}
				},
				responses: {
					200: {
						description: 'Berhasil diambil',
						content: {
							'application/json': {
								example: {
									ok: true, diminta: 100, diambil: 100,
									items: ['email1@x.com|pass1', 'email2@x.com|pass2'],
									sisa: 1402, message: 'Mengambil 100 akun, sisa stok 1402'
								}
							}
						}
					},
					400: err('jumlah tidak valid', 'jumlah harus bilangan bulat positif'),
					401: RESP[401],
					404: err('Produk atau variasi tidak ada', 'Product or variasi not found'),
					409: {
						description:
							'Stok kosong, stok kurang saat harus_penuh, atau stok sedang direbutkan terlalu ramai. ' +
							'Dalam semua kasus ini TIDAK ada akun yang keluar.',
						content: {
							'application/json': {
								example: { error: 'Stok tidak cukup: diminta 100, tersedia 47', diminta: 100, tersedia: 47 }
							}
						}
					}
				}
			}
		},

		'/api/products/{id}/variasi/{variasiId}/append-akun': {
			post: {
				tags: ['Akun'],
				summary: 'Nama lama dari POST .../akun',
				description: 'Perilakunya sama persis. Dipertahankan supaya pemanggil lama tidak putus.',
				deprecated: true,
				parameters: [ID, VARIASI_ID],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['list_akun'],
								properties: {
									list_akun: { type: 'array', items: { type: 'string' } },
									unique: { type: 'boolean' }
								}
							}
						}
					}
				},
				responses: { 200: { description: 'Ditambahkan' }, 401: RESP[401], 404: RESP[404] }
			}
		},

		'/api/customers': {
			get: {
				tags: ['Customers'],
				summary: 'Daftar pembeli',
				parameters: [
					PAGE, LIMIT(20),
					{ in: 'query', name: 'q', schema: { type: 'string' }, description: 'Cari username_tele atau id_tele' },
					{ in: 'query', name: 'id_tele', schema: { type: 'integer' }, description: 'Saring berdasarkan Telegram ID' },
					{
						in: 'query', name: 'sort_by',
						schema: { type: 'string', enum: ['_id', 'username_tele', 'id_tele', 'total_transaksi', 'balance', 'updated_at'] },
						description: 'Perlu index supaya cepat. Lihat `npm run indexes -- --plan`.'
					},
					{ in: 'query', name: 'order', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } }
				],
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: halaman({ $ref: '#/components/schemas/Customer' }) } } },
					401: RESP[401]
				}
			}
		},

		'/api/customers/{id}': {
			get: {
				tags: ['Customers'],
				summary: 'Detail pembeli',
				parameters: [{ ...ID, description: 'Customer ID (ObjectId)' }],
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } },
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			},
			put: {
				tags: ['Customers'],
				summary: 'Ubah saldo, total transaksi, atau status',
				description: 'Kalau `status` diisi "suspend", field `baned` ikut menjadi true.',
				parameters: [{ ...ID, description: 'Customer ID (ObjectId)' }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									balance: { type: 'integer', example: 50000 },
									total_transaksi: { type: 'integer', example: 1000000 },
									status: { type: 'string', enum: ['active', 'suspend'] }
								}
							}
						}
					}
				},
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } },
					400: err('Nilai tidak valid', 'balance must be a number'),
					401: RESP[401], 404: RESP[404]
				}
			},
			delete: {
				tags: ['Customers'],
				summary: 'Hapus pembeli',
				parameters: [{ ...ID, description: 'Customer ID (ObjectId)' }],
				responses: {
					200: { description: 'Terhapus', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			}
		},

		'/api/customers/{id_tele}/orders': {
			get: {
				tags: ['Customers'],
				summary: 'Transaksi milik satu pembeli',
				parameters: [
					{ in: 'path', name: 'id_tele', required: true, schema: { type: 'string', example: '1737464807' }, description: 'Telegram ID pembeli' },
					PAGE, LIMIT(20), FILTER_WAKTU
				],
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: halaman({ $ref: '#/components/schemas/Order' }) } } },
					400: RESP[400], 401: RESP[401]
				}
			}
		},

		'/api/orders': {
			get: {
				tags: ['Orders'],
				summary: 'Semua transaksi dalam bentuk datar',
				description:
					'Tanpa saringan apa pun, endpoint ini harus meratakan seluruh koleksi riwayat. ' +
					'Sebisa mungkin selalu sertakan `id_tele`, `id_transaksi`, atau `filter`.',
				parameters: [
					PAGE, LIMIT(30),
					{ in: 'query', name: 'id_tele', schema: { type: 'string' }, description: 'Saring per pembeli' },
					{ in: 'query', name: 'id_transaksi', schema: { type: 'string', example: 'PREM-813T09Q' }, description: 'Cari satu transaksi (sama persis)' },
					FILTER_WAKTU,
					{ in: 'query', name: 'sort_by', schema: { type: 'string', enum: ['waktu', 'total_bayar', 'jumlah_pembelian'], default: 'waktu' } },
					{ in: 'query', name: 'order', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } }
				],
				responses: {
					200: { description: 'Berhasil', content: { 'application/json': { schema: halaman({ $ref: '#/components/schemas/Order' }) } } },
					401: RESP[401]
				}
			}
		},

		'/api/riwayats': {
			get: {
				tags: ['Riwayats'],
				summary: 'Riwayat transaksi, dikelompokkan per pembeli',
				parameters: [
					{ in: 'query', name: 'id_tele', schema: { type: 'string' } },
					{ in: 'query', name: 'limit', schema: { type: 'integer', default: 100 }, description: 'Batasi jumlah pembeli yang dikembalikan. Kalau tidak diisi dipakai 100 — TIDAK dibiarkan tanpa batas, karena hasil tanpa batas akan melewati batas 16MB satu dokumen MongoDB.' },
					FILTER_WAKTU
				],
				responses: {
					200: {
						description: 'Berhasil',
						content: {
							'application/json': {
								example: {
									items: [{ id_tele: '6990830243', data: [{ nama_produk: 'Zoom', id_transaksi: 'TXN123', variasi: '14 Day 1pcs', jumlah_pembelian: 1, total_bayar: 2500, waktu: '13/11/2025 09:58:32' }] }],
									total: 50
								}
							}
						}
					},
					401: RESP[401]
				}
			}
		},

		'/api/riwayats/{id}': {
			get: {
				tags: ['Riwayats'],
				summary: 'Satu dokumen riwayat',
				parameters: [{ ...ID, description: 'Riwayat ID (ObjectId)' }],
				responses: {
					200: { description: 'Berhasil' },
					400: RESP[400], 401: RESP[401], 404: RESP[404]
				}
			}
		}
	}
} as const;
