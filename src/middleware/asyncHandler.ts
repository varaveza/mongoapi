import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 tidak menangkap error dari handler async secara otomatis.
 * Pembungkus ini meneruskan rejected promise ke error handler global,
 * supaya satu request gagal tidak menjatuhkan proses.
 */
export function asyncHandler(
	fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}
