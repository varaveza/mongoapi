import type { JwtPayload } from 'jsonwebtoken';

export interface AuthUser extends JwtPayload {
	_id?: string;
	email?: string;
	name?: string;
}

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			user?: AuthUser;
			authType?: string;
		}
	}
}

export {};
