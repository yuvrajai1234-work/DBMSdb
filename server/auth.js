import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { parseCookies } from './http.js';

const SESSION_COOKIE = 'lumisafe_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();

export { SESSION_COOKIE };

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, parts[1], expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSession(role, id) {
  const token = randomUUID() + randomUUID().replace(/-/g, '');
  sessions.set(token, { role, id, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

export function sessionFromRequest(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return { token: null, session: null };
  const session = sessions.get(token);
  if (!session) return { token, session: null };
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return { token, session: null };
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, session };
}

export function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}
