import { ApiError } from './http';
import type { Env, UserRow } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = '';
  for (const b of arr) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2_sha256$100000$${toBase64Url(salt)}$${toBase64Url(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterRaw, saltRaw, hashRaw] = stored.split('$');
  if (scheme !== 'pbkdf2_sha256') return false;
  const iterations = Number(iterRaw);
  if (!Number.isInteger(iterations) || !saltRaw || !hashRaw) return false;
  const salt = fromBase64Url(saltRaw);
  const expected = fromBase64Url(hashRaw);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function createToken(env: Env, user: Pick<UserRow, 'id' | 'username' | 'role'>): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    sub: String(user.id),
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  })));
  const key = await hmacKey(env.JWT_SECRET_KEY);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${toBase64Url(sig)}`;
}

export async function verifyToken(env: Env, token: string): Promise<{ sub: string; username: string; role: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'Invalid token');
  const key = await hmacKey(env.JWT_SECRET_KEY);
  const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new ApiError(401, 'Invalid token');
  const payload = JSON.parse(decoder.decode(fromBase64Url(parts[1]))) as { sub?: string; username?: string; role?: string; exp?: number };
  if (!payload.sub || !payload.username || !payload.role || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'Invalid token');
  }
  return { sub: payload.sub, username: payload.username, role: payload.role };
}

export function bearerToken(header: string | undefined): string {
  if (!header || !header.startsWith('Bearer ')) throw new ApiError(401, 'Not authenticated');
  return header.slice('Bearer '.length);
}

export async function getCurrentUser(env: Env, authorization: string | undefined): Promise<UserRow> {
  const token = bearerToken(authorization);
  const payload = await verifyToken(env, token);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(Number(payload.sub)).first<UserRow>();
  if (!user) throw new ApiError(401, 'User not found');
  return user;
}

export function requireAdmin(user: UserRow): void {
  if (user.role !== 'admin') throw new ApiError(403, 'Admin access required');
}
