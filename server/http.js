import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function setCookie(res, name, value, options = {}) {
  const pieces = [`${name}=${encodeURIComponent(value)}`];
  pieces.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) pieces.push(`Max-Age=${options.maxAge}`);
  if (options.expires) pieces.push(`Expires=${options.expires.toUTCString()}`);
  pieces.push('HttpOnly');
  pieces.push('SameSite=Lax');
  const existing = res.getHeader('Set-Cookie');
  const cookie = pieces.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

export async function readBody(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'The request payload is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function serveStatic(res, absolutePath) {
  if (!existsSync(absolutePath)) return false;
  const stat = statSync(absolutePath);
  if (!stat.isFile()) return false;
  const ext = path.extname(absolutePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const revalidate = ['.html', '.js', '.css', '.json'].includes(ext);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(absolutePath).pipe(res);
  return true;
}

export function requireFields(payload, fields) {
  const missing = fields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length) {
    const label = missing
      .map((field) => field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))
      .join(', ');
    throw new HttpError(400, `${label} ${missing.length > 1 ? 'are' : 'is'} required.`);
  }
}

export function text(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

export function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
