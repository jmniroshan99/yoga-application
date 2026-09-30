import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import type { NextFunction, Request, Response } from 'express';

dotenv.config({path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')});
export function webOriginsFor(configuredOrigin: string, production = process.env.NODE_ENV === 'production'): string[] {
  const origins = [configuredOrigin];
  if (production) return origins;
  try {
    const url = new URL(configuredOrigin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      const alias = new URL(configuredOrigin);
      alias.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      origins.push(alias.origin);
    }
  } catch {
    // The configured value is validated by normal CORS/origin matching below.
  }
  return [...new Set(origins)];
}
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
export const config = {
  port: Number(process.env.PORT || 4000),
  webOrigin,
  webOrigins: webOriginsFor(webOrigin),
  timezone: process.env.BUSINESS_TIMEZONE || 'Asia/Colombo',
  holdMinutes: Number(process.env.BOOKING_HOLD_MINUTES || 15),
  reviewHours: Number(process.env.REVIEW_HOLD_HOURS || 24),
  cancellationHours: Number(process.env.CANCELLATION_HOURS || 24),
  secureCookies: process.env.COOKIE_SECURE === 'true',
  sandbox: process.env.SANDBOX_PAYMENTS === 'true',
  key: process.env.DATA_ENCRYPTION_KEY || ''
};
export const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX||12)});
export type Db = Pick<PoolClient, 'query'>;
export type Actor = {id: string; name: string; email: string; role: 'client'|'practitioner'|'receptionist'|'manager'|'admin'; branch_id: string|null; locale: string};
declare global {namespace Express {interface Request {actor?: Actor}}}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {super(message);}
}
export function fail(status: number, code: string, message: string): never {throw new ApiError(status, code, message);}
export const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result;}
  catch (error) {await db.query('ROLLBACK'); throw error;}
  finally {db.release();}
}
export async function one<T extends QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}
export function actor(req: Request): Actor {if (!req.actor) return fail(401, 'AUTH_REQUIRED', 'Please sign in.'); return req.actor;}
export function allow(req: Request, roles: Actor['role'][]): Actor {
  const user = actor(req); if (!roles.includes(user.role)) fail(403, 'FORBIDDEN', 'You do not have access to this action.'); return user;
}
export function staffAt(req: Request, branch: string): Actor {
  const user = allow(req, ['receptionist','manager','admin']);
  if (user.role !== 'admin' && user.branch_id !== branch) fail(403, 'BRANCH_FORBIDDEN', 'Your account cannot access this branch.');
  return user;
}
export function seal(value: unknown): string {
  if (!/^[a-f0-9]{64}$/i.test(config.key)) fail(500,'ENCRYPTION_KEY_MISSING','Configure DATA_ENCRYPTION_KEY.');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(config.key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
}
export function unseal<T>(encrypted: string): T {
  const [iv, tag, data] = encrypted.split('.');
  if (!iv || !tag || !data || !/^[a-f0-9]{64}$/i.test(config.key)) throw new Error('Invalid encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.key,'hex'), Buffer.from(iv,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString()) as T;
}
export async function audit(db: Db, actorId: string | null, action: string, entity: string, id: string, metadata: Record<string,unknown> = {}) {
  await db.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)',[actorId,action,entity,id,metadata]);
}
export async function notify(db: Db, userId: string, template: string, payload: Record<string,unknown> = {}) {
  await db.query('INSERT INTO notification_outbox(user_id,template,payload) VALUES($1,$2,$3)',[userId,template,payload]);
}
