import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const SCHEMA_FILE = path.join(ROOT, 'supabase', 'schema.sql');

/* Load .env (Node 22 built-in) so DATABASE_URL can live outside the code. */
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* no .env file — fall back to real environment variables */
}

const CONNECTION_STRING = process.env.DATABASE_URL || '';

if (!CONNECTION_STRING) {
  console.error(`
LumiSafe needs a PostgreSQL connection string.

  1. Create a project at https://supabase.com
  2. Project Settings -> Database -> Connection string -> URI
  3. Create a file named .env in this folder containing:

     DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres

  4. Start the app again with: npm start
`);
  process.exit(1);
}

/* Supabase requires TLS; a loopback PGlite/Postgres test server does not. */
const IS_LOCAL = /(^|[@/])(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(CONNECTION_STRING);

/* pg returns int8/numeric as strings and dates as JS Date objects.
   Normalise them so the API keeps returning plain numbers and
   'YYYY-MM-DD' / ISO strings. */
pg.types.setTypeParser(20, (value) => Number(value)); // int8 / bigint (COUNT, SUM)
pg.types.setTypeParser(1700, (value) => Number(value)); // numeric / decimal
pg.types.setTypeParser(1082, (value) => value); // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (value) => new Date(`${value.replace(' ', 'T')}Z`).toISOString());

export const pool = new pg.Pool({
  connectionString: CONNECTION_STRING,
  ssl: IS_LOCAL ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX) || 6,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (error) => {
  console.error('[lumisafe] idle database client error:', error.message);
});

/* Convert the SQLite-style `?` placeholders used across the route layer
   into PostgreSQL positional parameters ($1, $2, ...). */
function bind(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export function query(sql, params = [], client = pool) {
  return client.query(bind(sql), params);
}

/** Every row of a result set. */
export async function many(sql, params = [], client) {
  const result = await query(sql, params, client);
  return result.rows;
}

/** First row, or null. */
export async function one(sql, params = [], client) {
  const result = await query(sql, params, client);
  return result.rows[0] || null;
}

/** Number of affected rows. */
export async function exec(sql, params = [], client) {
  const result = await query(sql, params, client);
  return result.rowCount;
}

/** Value of the single column returned by an INSERT ... RETURNING clause. */
export async function insert(sql, params = [], client) {
  const result = await query(sql, params, client);
  const row = result.rows[0];
  return row ? Number(Object.values(row)[0]) : 0;
}

/** Run a unit of work on one pooled client inside BEGIN/COMMIT. */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

export const schemaSql = readFileSync(SCHEMA_FILE, 'utf8');

/** Create every table, trigger, index and view if they are missing. */
export async function ensureSchema() {
  if (process.env.SKIP_DB_MIGRATE === '1') return;
  await pool.query(schemaSql);
}

export async function tableNames() {
  const rows = await many(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

export async function databaseSizeKb() {
  const row = await one('SELECT pg_database_size(current_database()) AS bytes');
  return row ? Math.round(Number(row.bytes) / 1024) : 0;
}

export function closePool() {
  return pool.end();
}

const UNIQUE_MESSAGES = {
  uq_citizen_email: 'That email address is already registered as a citizen.',
  uq_citizen_phone: 'That phone number is already registered as a citizen.',
  uq_official_email: 'That email address is already registered as an official.',
  uq_pole_name: 'That pole name already exists in the asset inventory.',
  uq_workorder_complaint: 'A work order has already been dispatched for this complaint.',
  uq_ward: 'That ward already exists in the division.',
  uq_division: 'That division already exists for the district.',
  complaintmedia_pkey: 'That image is already attached to the complaint.',
};

/* Translate raw PostgreSQL constraint failures into readable messages. */
export function friendlyDbError(error) {
  if (!error) return null;
  const code = error.code;
  const constraint = error.constraint || '';
  const message = String(error.message || '');

  if (code === '23505') return UNIQUE_MESSAGES[constraint] || 'That record already exists.';

  if (code === '23514') {
    if (/latitude|longitude/.test(constraint)) return 'Latitude or longitude is out of range.';
    if (/est_cost/.test(constraint)) return 'Estimated cost must be zero or greater.';
    if (/priority/.test(constraint)) return 'Priority must be Low, Medium, High or Critical.';
    if (/status/.test(constraint)) return 'Status must be Open, In Progress or Resolved.';
    return 'A value failed a database check constraint.';
  }

  if (code === '23502') return `${error.column || 'A required field'} cannot be empty.`;
  if (code === '23503') return 'The referenced record no longer exists or cannot be changed.';

  if (code === 'P0001') {
    if (/date_of_birth cannot be in the future/.test(message)) {
      return 'Date of birth cannot be in the future.';
    }
    if (/pole already specialized/.test(message)) {
      return 'That pole already has a specialization subtype.';
    }
    return message;
  }

  return null;
}
