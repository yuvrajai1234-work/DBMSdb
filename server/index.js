import http from 'node:http';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { ROOT, UPLOAD_DIR, closePool, ensureSchema } from './db.js';
import { HttpError, sendJson, serveStatic } from './http.js';
import { handleApi } from './routes.js';
import { pruneSessions } from './auth.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const requestedPort = Number(process.env.PORT);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173;
const HOST = process.env.HOST || '127.0.0.1';

function safeJoin(base, target) {
  const resolved = path.resolve(base, `.${path.posix.sep}${target}`);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    return null;
  }
  return resolved;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    if (url.pathname.startsWith('/uploads/')) {
      const target = safeJoin(UPLOAD_DIR, url.pathname.replace('/uploads/', ''));
      if (target && serveStatic(res, target)) return;
      sendJson(res, 404, { error: 'Image not found.' });
      return;
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = safeJoin(PUBLIC_DIR, relative);
    if (target && existsSync(target) && statSync(target).isFile()) {
      if (serveStatic(res, target)) return;
    }

    // Single page app fallback for navigation routes.
    if (!path.extname(url.pathname)) {
      if (serveStatic(res, path.join(PUBLIC_DIR, 'index.html'))) return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error(`[lumisafe] ${req.method} ${url.pathname} failed:`, error);
    sendJson(res, 500, { error: 'The LumiSafe server hit an unexpected error. Check the server log.' });
  }
});

setInterval(pruneSessions, 15 * 60 * 1000).unref();

try {
  await ensureSchema();
  console.log('LumiSafeDB: PostgreSQL schema verified on Supabase');
} catch (error) {
  console.error('[lumisafe] could not prepare the PostgreSQL schema:', error.message);
  console.error('[lumisafe] check DATABASE_URL in .env (see README of supabase/schema.sql) and try again.');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`LumiSafe running at http://${HOST}:${PORT}`);
});

async function shutdown() {
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
