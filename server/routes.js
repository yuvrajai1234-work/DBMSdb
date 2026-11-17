import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  UPLOAD_DIR,
  databaseSizeKb,
  exec,
  friendlyDbError,
  insert,
  many,
  one,
  tableNames,
  withTx,
} from './db.js';
import {
  HttpError,
  intOrNull,
  readBody,
  readJson,
  requireFields,
  sendJson,
  setCookie,
  text,
} from './http.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  sessionFromRequest,
  verifyPassword,
} from './auth.js';

mkdirSync(UPLOAD_DIR, { recursive: true });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

/* ------------------------------ router ------------------------------ */
const table = [];

function add(method, pattern, options, handler) {
  const keys = [];
  const source = pattern.replace(/\/:([A-Za-z_]+)/g, (_, key) => {
    keys.push(key);
    return '/([^/]+)';
  });
  table.push({
    method,
    regex: new RegExp(`^${source}/?$`),
    keys,
    role: options.role || null,
    handler,
  });
}

const route = (method, pattern, options = {}) => (handler) => add(method, pattern, options, handler);

/* ------------------------------ helpers ----------------------------- */
async function userFromSession(session) {
  if (!session) return null;
  if (session.role === 'citizen') {
    const row = await one(
      `SELECT c.user_id, c.first_name, c.last_name, c.email, c.phone_no, c.date_of_birth, c.created_at,
              w.ward_id, w.ward_name, w.councillor_name,
              d.div_id, d.div_name, d.district
         FROM citizens c
         JOIN wardcouncils w        ON w.ward_id = c.ward_id
         JOIN electricaldivisions d ON d.div_id = w.div_id
        WHERE c.user_id = ?`,
      [session.id],
    );
    if (!row) return null;
    return {
      role: 'citizen',
      id: row.user_id,
      name: `${row.first_name} ${row.last_name}`,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone_no,
      dateOfBirth: row.date_of_birth,
      joinedAt: row.created_at,
      wardId: row.ward_id,
      wardName: row.ward_name,
      councillorName: row.councillor_name,
      divId: row.div_id,
      divName: row.div_name,
      district: row.district,
    };
  }
  const row = await one(
    `SELECT o.official_id, o.official_name, o.designation, o.official_email, o.created_at,
            d.div_id, d.div_name, d.district
       FROM electricalofficials o
       JOIN electricaldivisions d ON d.div_id = o.div_id
      WHERE o.official_id = ?`,
    [session.id],
  );
  if (!row) return null;
  return {
    role: 'official',
    id: row.official_id,
    name: row.official_name,
    designation: row.designation,
    email: row.official_email,
    joinedAt: row.created_at,
    divId: row.div_id,
    divName: row.div_name,
    district: row.district,
  };
}

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please sign in to continue.');
  return ctx.user;
}

function pathId(ctx) {
  const id = intOrNull(ctx.params.id);
  if (!id) throw new HttpError(404, 'Record not found.');
  return id;
}

function validEmail(value) {
  const email = text(value).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (email.length > 100) throw new HttpError(400, 'Email address is too long.');
  return email;
}

function validPhone(value) {
  const phone = text(value).replace(/[\s-]/g, '');
  if (!/^\+?\d{10,15}$/.test(phone)) {
    throw new HttpError(400, 'Enter a phone number with 10 to 15 digits.');
  }
  return phone;
}

function validPassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters long.');
  if (password.length > 72) throw new HttpError(400, 'Password must be 72 characters or fewer.');
  return password;
}

function validDate(value, label) {
  const raw = text(value);
  if (!DATE_RE.test(raw)) throw new HttpError(400, `${label} must be a valid date.`);
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  return raw;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function mapComplaint(row) {
  if (!row) return null;
  return {
    complaintId: row.complaint_id,
    issueType: row.issue_type,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    daysOpen: Number(row.days_open || 0),
    userId: row.user_id,
    poleId: row.pole_id,
    poleName: row.pole_name,
    isHighRisk: !!row.is_high_risk,
    latitude: row.latitude,
    longitude: row.longitude,
    divId: row.div_id,
    divName: row.div_name,
    district: row.district,
    wardId: row.ward_id,
    wardName: row.ward_name,
    councillorName: row.councillor_name,
    citizenName: row.citizen_name,
    citizenEmail: row.citizen_email,
    citizenPhone: row.citizen_phone,
    workOrderId: row.work_order_id,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    issuedDate: row.issued_date,
    estCost: row.est_cost === null ? null : Number(row.est_cost),
    completedDate: row.completed_date,
    targetDate: row.target_date,
    daysOverdue: Number(row.days_overdue || 0),
    mediaCount: Number(row.media_count || 0),
  };
}

async function wardPayload(wardId) {
  const ward = await one(
    `SELECT w.ward_id, w.ward_name, w.councillor_name, d.div_id, d.div_name, d.district
       FROM wardcouncils w
       JOIN electricaldivisions d ON d.div_id = w.div_id
      WHERE w.ward_id = ?`,
    [wardId],
  );
  if (!ward) return null;
  return {
    wardId: ward.ward_id,
    wardName: ward.ward_name,
    councillorName: ward.councillor_name,
    divId: ward.div_id,
    divName: ward.div_name,
    district: ward.district,
  };
}

/**
 * Electrical divisions are master data: they are inserted directly in the
 * database by the developer and are never created through the web forms.
 */
async function existingDivision(divId, client) {
  const id = intOrNull(divId);
  if (!id) {
    throw new HttpError(
      400,
      'Select your electrical division. Divisions are added to the database by the LumiSafe administrator.',
    );
  }
  const div = await one('SELECT div_id FROM electricaldivisions WHERE div_id = ?', [id], client);
  if (!div) throw new HttpError(400, 'That electrical division no longer exists.');
  return div.div_id;
}

async function ensureWard(divId, wardName, councillorName, client) {
  const name = text(wardName);
  const councillor = text(councillorName);
  if (!name) throw new HttpError(400, 'Ward name is required.');
  if (!councillor) throw new HttpError(400, 'Councillor name is required.');
  if (name.length > 100 || councillor.length > 100) {
    throw new HttpError(400, 'Ward name or councillor name is too long.');
  }
  await exec(
    `INSERT INTO wardcouncils (div_id, ward_name, councillor_name) VALUES (?, ?, ?)
     ON CONFLICT (div_id, ward_name) DO NOTHING`,
    [divId, name, councillor],
    client,
  );
  const row = await one(
    'SELECT ward_id FROM wardcouncils WHERE div_id = ? AND ward_name = ?',
    [divId, name],
    client,
  );
  return row.ward_id;
}

/** Resolve a ward from an existing ward_id. Only developer provisions wards. */
async function resolveWard(payload, client) {
  const wardId = intOrNull(payload.wardId);
  if (!wardId) {
    throw new HttpError(400, 'Please select your home ward from the list.');
  }
  const ward = await one('SELECT ward_id FROM wardcouncils WHERE ward_id = ?', [wardId], client);
  if (!ward) throw new HttpError(400, 'The selected ward no longer exists. Choose another.');
  return ward.ward_id;
}

function sessionCookie(res, token) {
  setCookie(res, SESSION_COOKIE, token, { maxAge: 60 * 60 * 12 });
}

function clearSessionCookie(res) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

function divisionScopeForOfficial(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'official') throw new HttpError(403, 'Official access only.');
  return user;
}

/* --------------------------- public routes -------------------------- */
add('GET', '/api/health', {}, async () => {
  const started = process.hrtime.bigint();
  const probe = await one('SELECT 1 AS ok');
  const latency = Number(process.hrtime.bigint() - started) / 1_000_000;
  const counts = await one(
    `SELECT
      (SELECT COUNT(*) FROM electricaldivisions) AS divisions,
      (SELECT COUNT(*) FROM wardcouncils)        AS wards,
      (SELECT COUNT(*) FROM lightpoles)          AS poles,
      (SELECT COUNT(*) FROM citizens)            AS citizens,
      (SELECT COUNT(*) FROM electricalofficials) AS officials,
      (SELECT COUNT(*) FROM lightcomplaints)     AS complaints,
      (SELECT COUNT(*) FROM workorders)          AS work_orders`,
  );
  const tables = await tableNames();
  return {
    ok: probe.ok === 1,
    engine: 'PostgreSQL (Supabase)',
    tables,
    tableCount: tables.length,
    latencyMs: Math.round(latency * 100) / 100,
    sizeKb: await databaseSizeKb(),
    uptimeSec: Math.round(process.uptime()),
    serverTime: new Date().toISOString(),
    counts: {
      divisions: Number(counts.divisions || 0),
      wards: Number(counts.wards || 0),
      poles: Number(counts.poles || 0),
      citizens: Number(counts.citizens || 0),
      officials: Number(counts.officials || 0),
      complaints: Number(counts.complaints || 0),
      workOrders: Number(counts.work_orders || 0),
    },
  };
});

add('GET', '/api/bootstrap', {}, async () => {
  const divisions = (
    await many(
      `SELECT d.div_id, d.div_name, d.district,
              (SELECT COUNT(*) FROM wardcouncils w WHERE w.div_id = d.div_id) AS ward_count
         FROM electricaldivisions d ORDER BY d.div_name`,
    )
  ).map((row) => ({
    divId: row.div_id,
    divName: row.div_name,
    district: row.district,
    wardCount: row.ward_count,
  }));
  const wards = (
    await many(
      `SELECT w.ward_id, w.ward_name, w.councillor_name, d.div_id, d.div_name, d.district
         FROM wardcouncils w JOIN electricaldivisions d ON d.div_id = w.div_id
        ORDER BY d.div_name, w.ward_name`,
    )
  ).map((row) => ({
    wardId: row.ward_id,
    wardName: row.ward_name,
    councillorName: row.councillor_name,
    divId: row.div_id,
    divName: row.div_name,
    district: row.district,
  }));
  const totals = await one(
    `SELECT
      (SELECT COUNT(*) FROM electricaldivisions) AS divisions,
      (SELECT COUNT(*) FROM wardcouncils)        AS wards,
      (SELECT COUNT(*) FROM lightpoles)          AS poles,
      (SELECT COUNT(*) FROM citizens)            AS citizens,
      (SELECT COUNT(*) FROM electricalofficials) AS officials,
      (SELECT COUNT(*) FROM lightcomplaints)     AS complaints`,
  );
  const poleSubtypes = await one(
    `SELECT (SELECT COUNT(*) FROM solarlightpoles) AS solar,
            (SELECT COUNT(*) FROM electricallightpoles) AS electric`,
  );
  const vendors = (
    await many('SELECT vendor_id, vendor_name, service_type FROM vendors ORDER BY vendor_id')
  ).map((row) => ({
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    serviceType: row.service_type,
  }));
  return { divisions, wards, totals, poleSubtypes, vendors };
});

add('GET', '/api/vendors', {}, async () => {
  const vendors = (
    await many('SELECT vendor_id, vendor_name, service_type FROM vendors ORDER BY vendor_id')
  ).map((row) => ({
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    serviceType: row.service_type,
  }));
  return { vendors };
});

add('GET', '/api/auth/me', {}, async (ctx) => {
  const { session } = sessionFromRequest(ctx.req);
  const user = await userFromSession(session);
  if (!user) return { user: null };
  return { user };
});

add('POST', '/api/auth/register/citizen', {}, async (ctx) => {
  const payload = await readJson(ctx.req);
  requireFields(payload, ['firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'password']);
  const firstName = text(payload.firstName);
  const lastName = text(payload.lastName);
  if (firstName.length > 50 || lastName.length > 50) {
    throw new HttpError(400, 'First or last name is too long.');
  }
  const email = validEmail(payload.email);
  const phone = validPhone(payload.phone);
  const dob = validDate(payload.dateOfBirth, 'Date of birth');
  if (dob > todayIso()) throw new HttpError(400, 'Date of birth cannot be in the future.');
  if (dob < '1900-01-01') throw new HttpError(400, 'Date of birth must be after 1900.');
  const passwordHash = hashPassword(validPassword(payload.password));

  const userId = await withTx(async (client) => {
    const wardId = await resolveWard(payload, client);
    return insert(
      `INSERT INTO citizens (ward_id, first_name, last_name, email, phone_no, date_of_birth, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING user_id`,
      [wardId, firstName, lastName, email, phone, dob, passwordHash],
      client,
    );
  });

  sessionCookie(ctx.res, createSession('citizen', userId));
  return { user: await userFromSession({ role: 'citizen', id: userId }) };
});

add('POST', '/api/auth/register/official', {}, async (ctx) => {
  const payload = await readJson(ctx.req);
  requireFields(payload, ['officialName', 'designation', 'email', 'password']);
  const name = text(payload.officialName);
  const designation = text(payload.designation);
  if (name.length > 50) throw new HttpError(400, 'Official name is too long.');
  if (designation.length > 100) throw new HttpError(400, 'Designation is too long.');
  const email = validEmail(payload.email);
  const passwordHash = hashPassword(validPassword(payload.password));

  const divId = await existingDivision(payload.divId);

  const officialId = await insert(
    `INSERT INTO electricalofficials (div_id, official_name, designation, official_email, password_hash)
     VALUES (?, ?, ?, ?, ?) RETURNING official_id`,
    [divId, name, designation, email, passwordHash],
  );

  sessionCookie(ctx.res, createSession('official', officialId));
  return { user: await userFromSession({ role: 'official', id: officialId }) };
});

add('POST', '/api/auth/login', {}, async (ctx) => {
  const payload = await readJson(ctx.req);
  requireFields(payload, ['email', 'password']);
  const portal = payload.portal === 'official' ? 'official' : 'citizen';
  const email = text(payload.email).toLowerCase();
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (portal === 'citizen') {
    const row = await one('SELECT user_id, password_hash FROM citizens WHERE lower(email) = ?', [email]);
    if (!row) throw new HttpError(401, 'No citizen account is registered with that email.');
    if (!verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, 'Incorrect password. Please try again.');
    }
    sessionCookie(ctx.res, createSession('citizen', row.user_id));
    return { user: await userFromSession({ role: 'citizen', id: row.user_id }) };
  }

  const row = await one(
    'SELECT official_id, password_hash FROM electricalofficials WHERE lower(official_email) = ?',
    [email],
  );
  if (!row) throw new HttpError(401, 'No official account is registered with that email.');
  if (!verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'Incorrect password. Please try again.');
  }
  sessionCookie(ctx.res, createSession('official', row.official_id));
  return { user: await userFromSession({ role: 'official', id: row.official_id }) };
});

add('POST', '/api/auth/logout', {}, (ctx) => {
  const { token } = sessionFromRequest(ctx.req);
  destroySession(token);
  clearSessionCookie(ctx.res);
  return { ok: true };
});

/* ----------------------------- media -------------------------------- */
const MEDIA_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

add('POST', '/api/media', { role: 'any' }, async (ctx) => {
  requireUser(ctx);
  const contentType = String(ctx.req.headers['content-type'] || '').split(';')[0].trim();
  const extension = MEDIA_TYPES[contentType];
  if (!extension) throw new HttpError(415, 'Only PNG, JPEG, WEBP or GIF images can be uploaded.');
  const buffer = await readBody(ctx.req, 4 * 1024 * 1024);
  if (!buffer.length) throw new HttpError(400, 'The uploaded image is empty.');
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return { url: `/uploads/${filename}` };
});

/* ---------------------------- citizen ------------------------------- */
add('GET', '/api/citizen/overview', { role: 'citizen' }, async (ctx) => {
  const user = requireUser(ctx);
  const stats = await one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'Open'        THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN priority IN ('High','Critical') AND status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS urgent
       FROM lightcomplaints WHERE user_id = ?`,
    [user.id],
  );
  const rows = await many(
    'SELECT * FROM vw_complaintdetail WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
    [user.id],
  );
  return {
    profile: user,
    stats: {
      total: Number(stats.total || 0),
      open: Number(stats.open || 0),
      inProgress: Number(stats.in_progress || 0),
      resolved: Number(stats.resolved || 0),
      urgent: Number(stats.urgent || 0),
    },
    recent: rows.map(mapComplaint),
  };
});

add('GET', '/api/citizen/poles', { role: 'citizen' }, async (ctx) => {
  const user = requireUser(ctx);
  const rows = await many(
    `SELECT p.pole_id, p.pole_name, p.is_high_risk, p.latitude, p.longitude,
            CASE WHEN s.pole_id IS NOT NULL THEN 'Solar'
                 WHEN e.pole_id IS NOT NULL THEN 'Electrical' END AS subtype,
            (SELECT COUNT(*) FROM lightcomplaints c
              WHERE c.pole_id = p.pole_id AND c.status NOT IN ('Resolved', 'Closed')) AS open_complaints
       FROM lightpoles p
       LEFT JOIN solarlightpoles s      ON s.pole_id = p.pole_id
       LEFT JOIN electricallightpoles e ON e.pole_id = p.pole_id
      WHERE p.div_id = ?
      ORDER BY p.pole_name`,
    [user.divId],
  );
  return {
    poles: rows.map((row) => ({
      poleId: row.pole_id,
      poleName: row.pole_name,
      isHighRisk: !!row.is_high_risk,
      latitude: row.latitude,
      longitude: row.longitude,
      subtype: row.subtype,
      openComplaints: Number(row.open_complaints || 0),
    })),
  };
});

add('POST', '/api/citizen/complaints', { role: 'citizen' }, async (ctx) => {
  const user = requireUser(ctx);
  const payload = await readJson(ctx.req);
  requireFields(payload, ['poleId', 'issueType', 'priority']);
  const poleId = intOrNull(payload.poleId);
  if (!poleId) throw new HttpError(400, 'Select the street light you are reporting.');
  const pole = await one('SELECT pole_id, div_id FROM lightpoles WHERE pole_id = ?', [poleId]);
  if (!pole) throw new HttpError(400, 'That light pole is not in the inventory.');
  if (pole.div_id !== user.divId) {
    throw new HttpError(403, 'You can only report poles inside your own electrical division.');
  }
  const issueType = text(payload.issueType);
  if (issueType.length < 3 || issueType.length > 100) {
    throw new HttpError(400, 'Issue type must be between 3 and 100 characters.');
  }
  const priority = text(payload.priority);
  if (!PRIORITIES.includes(priority)) {
    throw new HttpError(400, 'Priority must be Low, Medium, High or Critical.');
  }
  const mediaUrls = Array.isArray(payload.mediaUrls) ? payload.mediaUrls : [];
  const cleaned = [];
  for (const raw of mediaUrls.slice(0, 5)) {
    const url = text(raw);
    if (!url) continue;
    if (url.length > 255) throw new HttpError(400, 'A media URL is too long.');
    if (!/^(https?:\/\/|\/)/.test(url)) {
      throw new HttpError(400, 'Media must be an uploaded image or an http(s) link.');
    }
    if (!cleaned.includes(url)) cleaned.push(url);
  }

  const complaintId = await withTx(async (client) => {
    const id = await insert(
      `INSERT INTO lightcomplaints (user_id, pole_id, issue_type, priority, status)
       VALUES (?, ?, ?, ?, 'Open') RETURNING complaint_id`,
      [user.id, poleId, issueType, priority],
      client,
    );
    // Automatically flag pole as high risk when a ticket is raised
    await exec(
      'UPDATE lightpoles SET is_high_risk = TRUE WHERE pole_id = ?',
      [poleId],
      client,
    );
    for (const url of cleaned) {
      await exec(
        'INSERT INTO complaintmedia (complaint_id, media_url) VALUES (?, ?)',
        [id, url],
        client,
      );
    }
    return id;
  });

  const row = await one('SELECT * FROM vw_complaintdetail WHERE complaint_id = ?', [complaintId]);
  return { complaint: mapComplaint(row) };
});

add('GET', '/api/citizen/complaints', { role: 'citizen' }, async (ctx) => {
  const user = requireUser(ctx);
  const status = text(ctx.url.searchParams.get('status'));
  const search = text(ctx.url.searchParams.get('search'));
  const clauses = ['user_id = ?'];
  const params = [user.id];
  if (status === 'Closed' || status === 'Resolved') {
    clauses.push("status IN ('Resolved', 'Closed')");
  } else if (STATUSES.includes(status)) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (search) {
    clauses.push('(pole_name ILIKE ? OR issue_type ILIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const rows = await many(
    `SELECT * FROM vw_complaintdetail
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC`,
    params,
  );
  return { complaints: rows.map(mapComplaint) };
});

add('GET', '/api/citizen/complaints/:id', { role: 'citizen' }, async (ctx) => {
  const user = requireUser(ctx);
  const row = await one(
    'SELECT * FROM vw_complaintdetail WHERE complaint_id = ? AND user_id = ?',
    [pathId(ctx), user.id],
  );
  if (!row) throw new HttpError(404, 'Complaint not found.');
  const media = await many(
    'SELECT media_url, uploaded_at FROM complaintmedia WHERE complaint_id = ? ORDER BY uploaded_at',
    [row.complaint_id],
  );
  return {
    complaint: mapComplaint(row),
    media: media.map((item) => ({ url: item.media_url, uploadedAt: item.uploaded_at })),
  };
});

/* ---------------------------- official ------------------------------ */
add('GET', '/api/official/overview', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const stats = await one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN c.status = 'Open'        THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN c.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN c.status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN c.status NOT IN ('Resolved', 'Closed') AND wo.work_order_id IS NULL THEN 1 ELSE 0 END) AS awaiting_dispatch
       FROM lightcomplaints c
       JOIN lightpoles p ON p.pole_id = c.pole_id
       LEFT JOIN workorders wo ON wo.complaint_id = c.complaint_id
      WHERE p.div_id = ?`,
    [user.divId],
  );
  const assets = await one(
    `SELECT (SELECT COUNT(*) FROM lightpoles WHERE div_id = ?) AS poles,
            (SELECT COUNT(*) FROM lightpoles WHERE div_id = ? AND is_high_risk = TRUE) AS high_risk,
            (SELECT COUNT(*) FROM wardcouncils WHERE div_id = ?) AS wards,
            (SELECT COUNT(*) FROM citizens ci JOIN wardcouncils w ON w.ward_id = ci.ward_id
              WHERE w.div_id = ?) AS citizens,
            (SELECT COUNT(*) FROM workorders wo
               JOIN lightcomplaints c ON c.complaint_id = wo.complaint_id
               JOIN lightpoles p ON p.pole_id = c.pole_id
              WHERE p.div_id = ? AND c.status NOT IN ('Resolved', 'Closed')
                AND wo.target_date IS NOT NULL AND wo.target_date < CURRENT_DATE) AS overdue`,
    [user.divId, user.divId, user.divId, user.divId, user.divId],
  );
  const byPriority = await many(
    `SELECT c.priority, COUNT(*) AS count
       FROM lightcomplaints c JOIN lightpoles p ON p.pole_id = c.pole_id
      WHERE p.div_id = ? AND c.status NOT IN ('Resolved', 'Closed')
      GROUP BY c.priority`,
    [user.divId],
  );
  const byIssue = await many(
    `SELECT c.issue_type, COUNT(*) AS count
       FROM lightcomplaints c JOIN lightpoles p ON p.pole_id = c.pole_id
      WHERE p.div_id = ?
      GROUP BY c.issue_type ORDER BY count DESC LIMIT 6`,
    [user.divId],
  );
  const overdue = await many(
    `SELECT * FROM vw_complaintdetail
      WHERE div_id = ? AND status NOT IN ('Resolved', 'Closed') AND days_overdue > 0
      ORDER BY days_overdue DESC LIMIT 5`,
    [user.divId],
  );
  const recent = await many(
    `SELECT * FROM vw_complaintdetail WHERE div_id = ?
      ORDER BY created_at DESC LIMIT 6`,
    [user.divId],
  );
  const wards = await many(
    `SELECT w.ward_id, w.ward_name, w.councillor_name,
            (SELECT COUNT(*) FROM citizens ci WHERE ci.ward_id = w.ward_id) AS citizen_count,
            (SELECT COUNT(*) FROM lightcomplaints c
               JOIN citizens ci ON ci.user_id = c.user_id
              WHERE ci.ward_id = w.ward_id AND c.status NOT IN ('Resolved', 'Closed')) AS open_count
       FROM wardcouncils w WHERE w.div_id = ? ORDER BY w.ward_name`,
    [user.divId],
  );
  const vendorBudgets = await many(
    `SELECT v.vendor_id,
            v.vendor_name,
            COALESCE(v.service_type, 'General repair & maintenance') AS service_type,
            COUNT(wo.work_order_id)::int AS order_count,
            COALESCE(SUM(wo.est_cost), 0)::numeric AS total_budget
       FROM vendors v
       LEFT JOIN (
         SELECT wo.vendor_id, wo.work_order_id, wo.est_cost
           FROM workorders wo
           JOIN lightcomplaints c ON c.complaint_id = wo.complaint_id
           JOIN lightpoles p      ON p.pole_id = c.pole_id
          WHERE p.div_id = ?
       ) wo ON wo.vendor_id = v.vendor_id
      GROUP BY v.vendor_id, v.vendor_name, v.service_type
      ORDER BY total_budget DESC, order_count DESC, v.vendor_name`,
    [user.divId],
  );
  const totalBudget = vendorBudgets.reduce((acc, row) => acc + Number(row.total_budget || 0), 0);
  const totalOrders = vendorBudgets.reduce((acc, row) => acc + Number(row.order_count || 0), 0);

  return {
    profile: user,
    stats: {
      total: Number(stats.total || 0),
      open: Number(stats.open || 0),
      inProgress: Number(stats.in_progress || 0),
      resolved: Number(stats.resolved || 0),
      awaitingDispatch: Number(stats.awaiting_dispatch || 0),
      poles: Number(assets.poles || 0),
      highRisk: Number(assets.high_risk || 0),
      wards: Number(assets.wards || 0),
      citizens: Number(assets.citizens || 0),
      overdue: Number(assets.overdue || 0),
    },
    byPriority: byPriority.map((row) => ({ label: row.priority, count: Number(row.count) })),
    byIssue: byIssue.map((row) => ({ label: row.issue_type, count: Number(row.count) })),
    overdue: overdue.map(mapComplaint),
    recent: recent.map(mapComplaint),
    wards: wards.map((row) => ({
      wardId: row.ward_id,
      wardName: row.ward_name,
      councillorName: row.councillor_name,
      citizenCount: Number(row.citizen_count || 0),
      openCount: Number(row.open_count || 0),
    })),
    budget: {
      totalBudget,
      totalOrders,
      vendors: vendorBudgets.map((row) => ({
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        serviceType: row.service_type,
        orderCount: Number(row.order_count || 0),
        totalBudget: Number(row.total_budget || 0),
      })),
    },
  };
});

add('GET', '/api/official/wards', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const rows = await many(
    `SELECT w.ward_id, w.ward_name, w.councillor_name, w.div_id,
            (SELECT COUNT(*) FROM citizens ci WHERE ci.ward_id = w.ward_id) AS citizen_count,
            (SELECT COUNT(*) FROM lightcomplaints c
               JOIN citizens ci ON ci.user_id = c.user_id
              WHERE ci.ward_id = w.ward_id) AS complaint_count
       FROM wardcouncils w WHERE w.div_id = ? ORDER BY w.ward_name`,
    [user.divId],
  );
  return {
    wards: rows.map((row) => ({
      wardId: row.ward_id,
      wardName: row.ward_name,
      councillorName: row.councillor_name,
      citizenCount: Number(row.citizen_count || 0),
      complaintCount: Number(row.complaint_count || 0),
    })),
  };
});

add('POST', '/api/official/wards', { role: 'official' }, async () => {
  throw new HttpError(403, 'Wards and divisions are provisioned by the developer and cannot be added by officials.');
});

add('PATCH', '/api/official/wards/:id', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const payload = await readJson(ctx.req);
  requireFields(payload, ['wardName', 'councillorName']);
  const wardId = pathId(ctx);
  const ward = await one('SELECT ward_id, div_id FROM wardcouncils WHERE ward_id = ?', [wardId]);
  if (!ward) throw new HttpError(404, 'Ward not found.');
  if (ward.div_id !== user.divId) throw new HttpError(403, 'That ward belongs to another division.');
  await exec(
    'UPDATE wardcouncils SET ward_name = ?, councillor_name = ? WHERE ward_id = ?',
    [text(payload.wardName), text(payload.councillorName), wardId],
  );
  return { ward: await wardPayload(wardId) };
});

add('GET', '/api/official/poles', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const search = text(ctx.url.searchParams.get('search'));
  const subtype = text(ctx.url.searchParams.get('subtype'));
  const risk = text(ctx.url.searchParams.get('risk'));
  const clauses = ['p.div_id = ?'];
  const params = [user.divId];
  if (search) {
    clauses.push('p.pole_name ILIKE ?');
    params.push(`%${search}%`);
  }
  if (subtype === 'Solar') clauses.push('s.pole_id IS NOT NULL');
  if (subtype === 'Electrical') clauses.push('e.pole_id IS NOT NULL');
  if (risk === 'high') clauses.push('p.is_high_risk = TRUE');
  const rows = await many(
    `SELECT p.pole_id, p.pole_name, p.latitude, p.longitude, p.is_high_risk,
            CASE WHEN s.pole_id IS NOT NULL THEN 'Solar'
                 WHEN e.pole_id IS NOT NULL THEN 'Electrical' END AS subtype,
            (SELECT COUNT(*) FROM lightcomplaints c WHERE c.pole_id = p.pole_id) AS complaint_count,
            (SELECT COUNT(*) FROM lightcomplaints c
              WHERE c.pole_id = p.pole_id AND c.status NOT IN ('Resolved', 'Closed')) AS open_count
       FROM lightpoles p
       LEFT JOIN solarlightpoles s      ON s.pole_id = p.pole_id
       LEFT JOIN electricallightpoles e ON e.pole_id = p.pole_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.pole_name`,
    params,
  );
  return {
    poles: rows.map((row) => ({
      poleId: row.pole_id,
      poleName: row.pole_name,
      latitude: row.latitude,
      longitude: row.longitude,
      isHighRisk: !!row.is_high_risk,
      subtype: row.subtype,
      complaintCount: Number(row.complaint_count || 0),
      openCount: Number(row.open_count || 0),
    })),
  };
});

add('POST', '/api/official/poles', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const payload = await readJson(ctx.req);
  requireFields(payload, ['poleName', 'subtype']);
  const poleName = text(payload.poleName);
  if (poleName.length > 50) throw new HttpError(400, 'Pole name must be 50 characters or fewer.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/ -]*$/.test(poleName)) {
    throw new HttpError(400, 'Pole name may contain letters, digits, spaces, dashes, dots and slashes only.');
  }
  const subtype = text(payload.subtype);
  if (!['Solar', 'Electrical'].includes(subtype)) {
    throw new HttpError(400, 'Choose a pole subtype: Solar or Electrical.');
  }
  const latitude = payload.latitude === '' || payload.latitude === undefined || payload.latitude === null
    ? null
    : Number(payload.latitude);
  const longitude = payload.longitude === '' || payload.longitude === undefined || payload.longitude === null
    ? null
    : Number(payload.longitude);
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new HttpError(400, 'Latitude must be between -90 and 90.');
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new HttpError(400, 'Longitude must be between -180 and 180.');
  }
  const isHighRisk = Boolean(payload.isHighRisk);

  const poleId = await withTx(async (client) => {
    const id = await insert(
      `INSERT INTO lightpoles (div_id, pole_name, latitude, longitude, is_high_risk)
       VALUES (?, ?, ?, ?, ?) RETURNING pole_id`,
      [user.divId, poleName, latitude, longitude, isHighRisk],
      client,
    );
    if (subtype === 'Solar') {
      await exec('INSERT INTO solarlightpoles (pole_id) VALUES (?)', [id], client);
    } else {
      await exec('INSERT INTO electricallightpoles (pole_id) VALUES (?)', [id], client);
    }
    return id;
  });

  const row = await one(
    `SELECT p.pole_id, p.pole_name, p.latitude, p.longitude, p.is_high_risk,
            CASE WHEN s.pole_id IS NOT NULL THEN 'Solar' ELSE 'Electrical' END AS subtype
       FROM lightpoles p
       LEFT JOIN solarlightpoles s ON s.pole_id = p.pole_id
       LEFT JOIN electricallightpoles e ON e.pole_id = p.pole_id
      WHERE p.pole_id = ?`,
    [poleId],
  );
  return {
    pole: {
      poleId: row.pole_id,
      poleName: row.pole_name,
      latitude: row.latitude,
      longitude: row.longitude,
      isHighRisk: !!row.is_high_risk,
      subtype: row.subtype,
      complaintCount: 0,
      openCount: 0,
    },
  };
});

add('PATCH', '/api/official/poles/:id', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const poleId = pathId(ctx);
  const payload = await readJson(ctx.req);

  const pole = await one('SELECT pole_id, div_id FROM lightpoles WHERE pole_id = ?', [poleId]);
  if (!pole) throw new HttpError(404, 'Pole not found.');
  if (pole.div_id !== user.divId) throw new HttpError(403, 'That pole belongs to another division.');

  requireFields(payload, ['poleName', 'subtype']);
  const poleName = text(payload.poleName);
  if (poleName.length > 50) throw new HttpError(400, 'Pole name must be 50 characters or fewer.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/ -]*$/.test(poleName)) {
    throw new HttpError(400, 'Pole name may contain letters, digits, spaces, dashes, dots and slashes only.');
  }

  const dup = await one(
    'SELECT pole_id FROM lightpoles WHERE pole_name = ? AND pole_id <> ?',
    [poleName, poleId],
  );
  if (dup) throw new HttpError(400, 'Another pole with that name already exists.');

  const subtype = text(payload.subtype);
  if (!['Solar', 'Electrical'].includes(subtype)) {
    throw new HttpError(400, 'Choose a pole subtype: Solar or Electrical.');
  }

  const latitude = payload.latitude === '' || payload.latitude === undefined || payload.latitude === null
    ? null
    : Number(payload.latitude);
  const longitude = payload.longitude === '' || payload.longitude === undefined || payload.longitude === null
    ? null
    : Number(payload.longitude);
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new HttpError(400, 'Latitude must be between -90 and 90.');
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new HttpError(400, 'Longitude must be between -180 and 180.');
  }
  const isHighRisk = Boolean(payload.isHighRisk);

  await withTx(async (client) => {
    await exec(
      'UPDATE lightpoles SET pole_name = ?, latitude = ?, longitude = ?, is_high_risk = ? WHERE pole_id = ?',
      [poleName, latitude, longitude, isHighRisk, poleId],
      client,
    );

    if (subtype === 'Solar') {
      await exec('DELETE FROM electricallightpoles WHERE pole_id = ?', [poleId], client);
      await exec(
        'INSERT INTO solarlightpoles (pole_id) VALUES (?) ON CONFLICT (pole_id) DO NOTHING',
        [poleId],
        client,
      );
    } else {
      await exec('DELETE FROM solarlightpoles WHERE pole_id = ?', [poleId], client);
      await exec(
        'INSERT INTO electricallightpoles (pole_id) VALUES (?) ON CONFLICT (pole_id) DO NOTHING',
        [poleId],
        client,
      );
    }
  });

  return { ok: true };
});

add('DELETE', '/api/official/poles/:id', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const poleId = pathId(ctx);
  const pole = await one('SELECT pole_id, div_id FROM lightpoles WHERE pole_id = ?', [poleId]);
  if (!pole) throw new HttpError(404, 'Pole not found.');
  if (pole.div_id !== user.divId) throw new HttpError(403, 'That pole belongs to another division.');
  const used = await one('SELECT COUNT(*) AS count FROM lightcomplaints WHERE pole_id = ?', [poleId]);
  if (Number(used.count) > 0) {
    throw new HttpError(
      400,
      'This pole has complaint history and cannot be removed. It stays in the audit trail.',
    );
  }
  await exec('DELETE FROM lightpoles WHERE pole_id = ?', [poleId]);
  return { ok: true };
});

add('GET', '/api/official/complaints', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const status = text(ctx.url.searchParams.get('status'));
  const priority = text(ctx.url.searchParams.get('priority'));
  const search = text(ctx.url.searchParams.get('search'));
  const dispatch = text(ctx.url.searchParams.get('dispatch'));
  const clauses = ['div_id = ?'];
  const params = [user.divId];
  if (status === 'Closed' || status === 'Resolved') {
    clauses.push("status IN ('Resolved', 'Closed')");
  } else if (STATUSES.includes(status)) {
    clauses.push('status = ?');
    params.push(status);
  } else {
    // Default queue view removes completed/closed tickets
    clauses.push("status NOT IN ('Resolved', 'Closed')");
  }
  if (PRIORITIES.includes(priority)) {
    clauses.push('priority = ?');
    params.push(priority);
  }
  if (search) {
    clauses.push('(pole_name ILIKE ? OR issue_type ILIKE ? OR citizen_name ILIKE ? OR ward_name ILIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (dispatch === 'unassigned') clauses.push('work_order_id IS NULL');
  if (dispatch === 'overdue') clauses.push("days_overdue > 0 AND status NOT IN ('Resolved', 'Closed')");
  const rows = await many(
    `SELECT * FROM vw_complaintdetail
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
               created_at DESC`,
    params,
  );
  return { complaints: rows.map(mapComplaint) };
});

add('GET', '/api/official/complaints/:id', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const row = await one(
    'SELECT * FROM vw_complaintdetail WHERE complaint_id = ? AND div_id = ?',
    [pathId(ctx), user.divId],
  );
  if (!row) throw new HttpError(404, 'Complaint not found in your division.');
  const media = await many(
    'SELECT media_url, uploaded_at FROM complaintmedia WHERE complaint_id = ? ORDER BY uploaded_at',
    [row.complaint_id],
  );
  const history = await many(
    `SELECT wo.work_order_id, wo.vendor_id,
            COALESCE(v.vendor_name, wo.vendor_name, 'Unassigned') AS vendor_name,
            wo.issued_date, wo.est_cost, wo.completed_date, wo.target_date,
            o.official_name, o.designation
       FROM workorders wo
       LEFT JOIN electricalofficials o ON o.official_id = wo.official_id
       LEFT JOIN vendors v            ON v.vendor_id = wo.vendor_id
      WHERE wo.complaint_id = ?`,
    [row.complaint_id],
  );
  return {
    complaint: mapComplaint(row),
    media: media.map((item) => ({ url: item.media_url, uploadedAt: item.uploaded_at })),
    workOrders: history.map((item) => ({
      workOrderId: item.work_order_id,
      vendorId: item.vendor_id,
      vendorName: item.vendor_name,
      issuedDate: item.issued_date,
      estCost: Number(item.est_cost || 0),
      completedDate: item.completed_date,
      targetDate: item.target_date,
      officialName: item.official_name || 'Unassigned',
      designation: item.designation || '—',
    })),
  };
});

add('PATCH', '/api/official/complaints/:id/status', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const payload = await readJson(ctx.req);
  const status = text(payload.status);
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, 'Status must be Open, In Progress or Resolved.');
  }
  const complaintId = pathId(ctx);
  const row = await one(
    `SELECT c.complaint_id, c.status, p.div_id,
            (SELECT COUNT(*) FROM workorders wo WHERE wo.complaint_id = c.complaint_id) AS work_orders
       FROM lightcomplaints c JOIN lightpoles p ON p.pole_id = c.pole_id
      WHERE c.complaint_id = ?`,
    [complaintId],
  );
  if (!row) throw new HttpError(404, 'Complaint not found.');
  if (row.div_id !== user.divId) throw new HttpError(403, 'That complaint belongs to another division.');

  await withTx(async (client) => {
    await exec('UPDATE lightcomplaints SET status = ? WHERE complaint_id = ?', [status, complaintId], client);
    if (status === 'Resolved') {
      await exec(
        'UPDATE workorders SET completed_date = CURRENT_DATE WHERE complaint_id = ? AND completed_date IS NULL',
        [complaintId],
        client,
      );
    }
  });

  return {
    complaint: mapComplaint(
      await one('SELECT * FROM vw_complaintdetail WHERE complaint_id = ?', [complaintId]),
    ),
  };
});

add('POST', '/api/official/complaints/:id/work-orders', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const payload = await readJson(ctx.req);
  const complaintId = pathId(ctx);
  const row = await one(
    `SELECT c.complaint_id, c.status, p.div_id
       FROM lightcomplaints c JOIN lightpoles p ON p.pole_id = c.pole_id
      WHERE c.complaint_id = ?`,
    [complaintId],
  );
  if (!row) throw new HttpError(404, 'Complaint not found.');
  if (row.div_id !== user.divId) throw new HttpError(403, 'That complaint belongs to another division.');

  let vendorId = intOrNull(payload.vendorId);
  let vendorName = text(payload.vendorName);

  if (vendorId) {
    const v = await one('SELECT vendor_id, vendor_name FROM vendors WHERE vendor_id = ?', [vendorId]);
    if (!v) throw new HttpError(400, 'Selected vendor does not exist.');
    vendorName = v.vendor_name;
  } else if (vendorName) {
    const v = await one('SELECT vendor_id, vendor_name FROM vendors WHERE lower(vendor_name) = lower(?)', [vendorName]);
    if (v) {
      vendorId = v.vendor_id;
      vendorName = v.vendor_name;
    }
  }

  if (!vendorId && !vendorName) {
    throw new HttpError(400, 'Please select a vendor from the dropdown.');
  }

  const estCost = payload.estCost !== undefined && payload.estCost !== null ? Number(payload.estCost) : 0;
  if (!Number.isFinite(estCost) || estCost < 0) {
    throw new HttpError(400, 'Estimated cost must be a number greater than or equal to zero.');
  }
  if (estCost > 9_999_999) throw new HttpError(400, 'Estimated cost is unrealistically high.');

  const existingWo = await one('SELECT work_order_id FROM workorders WHERE complaint_id = ?', [complaintId]);

  let workOrderId;
  await withTx(async (client) => {
    if (existingWo) {
      workOrderId = existingWo.work_order_id;
      await exec(
        `UPDATE workorders
            SET vendor_id = ?,
                vendor_name = COALESCE(?, vendor_name),
                official_id = ?,
                est_cost = ?
          WHERE work_order_id = ?`,
        [vendorId, vendorName, user.id, estCost.toFixed(2), workOrderId],
        client,
      );
    } else {
      workOrderId = await insert(
        `INSERT INTO workorders (complaint_id, official_id, vendor_id, vendor_name, issued_date, est_cost)
         VALUES (?, ?, ?, ?, CURRENT_DATE, ?) RETURNING work_order_id`,
        [complaintId, user.id, vendorId, vendorName || 'Unassigned', estCost.toFixed(2)],
        client,
      );
    }
    await exec(
      "UPDATE lightcomplaints SET status = 'In Progress' WHERE complaint_id = ? AND status = 'Open'",
      [complaintId],
      client,
    );
  });

  return {
    workOrder: await one(
      `SELECT wo.work_order_id, wo.vendor_id, wo.vendor_name, wo.issued_date, wo.est_cost, wo.completed_date
         FROM workorders wo WHERE wo.work_order_id = ?`,
      [workOrderId],
    ),
    complaint: mapComplaint(
      await one('SELECT * FROM vw_complaintdetail WHERE complaint_id = ?', [complaintId]),
    ),
  };
});

add('GET', '/api/official/work-orders', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const state = text(ctx.url.searchParams.get('state'));
  const clauses = ['p.div_id = ?'];
  const params = [user.divId];
  if (state === 'active') clauses.push("c.status NOT IN ('Resolved', 'Closed')");
  if (state === 'done') clauses.push("c.status IN ('Resolved', 'Closed')");
  if (state === 'overdue') {
    clauses.push("c.status NOT IN ('Resolved', 'Closed') AND wo.target_date IS NOT NULL AND wo.target_date < CURRENT_DATE");
  }
  const rows = await many(
    `SELECT c.complaint_id, c.issue_type, c.priority, c.status, c.created_at,
            p.pole_name, p.is_high_risk,
            ci.first_name || ' ' || ci.last_name AS citizen_name, ci.phone_no AS citizen_phone,
            w.ward_name,
            wo.work_order_id, wo.vendor_id,
            COALESCE(v.vendor_name, wo.vendor_name, 'Unassigned') AS vendor_name,
            wo.issued_date, wo.target_date, wo.est_cost, wo.completed_date,
            o.official_name,
            CASE WHEN c.status IN ('Resolved', 'Closed') THEN 0
                 WHEN wo.target_date IS NULL THEN 0
                 ELSE GREATEST(0, CURRENT_DATE - wo.target_date)
            END AS days_overdue
       FROM workorders wo
       JOIN lightcomplaints c     ON c.complaint_id = wo.complaint_id
       JOIN lightpoles p          ON p.pole_id = c.pole_id
       JOIN citizens ci           ON ci.user_id = c.user_id
       JOIN wardcouncils w        ON w.ward_id = ci.ward_id
       LEFT JOIN electricalofficials o ON o.official_id = wo.official_id
       LEFT JOIN vendors v        ON v.vendor_id = wo.vendor_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY wo.work_order_id DESC`,
    params,
  );
  const vendorBudgets = await many(
    `SELECT v.vendor_id,
            v.vendor_name,
            COALESCE(v.service_type, 'General repair & maintenance') AS service_type,
            COUNT(wo.work_order_id)::int AS order_count,
            COALESCE(SUM(wo.est_cost), 0)::numeric AS total_budget
       FROM vendors v
       LEFT JOIN (
         SELECT wo.vendor_id, wo.work_order_id, wo.est_cost
           FROM workorders wo
           JOIN lightcomplaints c ON c.complaint_id = wo.complaint_id
           JOIN lightpoles p      ON p.pole_id = c.pole_id
          WHERE p.div_id = ?
       ) wo ON wo.vendor_id = v.vendor_id
      GROUP BY v.vendor_id, v.vendor_name, v.service_type
      ORDER BY total_budget DESC, order_count DESC, v.vendor_name`,
    [user.divId],
  );
  const totalBudget = vendorBudgets.reduce((acc, row) => acc + Number(row.total_budget || 0), 0);
  const totalOrders = vendorBudgets.reduce((acc, row) => acc + Number(row.order_count || 0), 0);

  return {
    workOrders: rows.map((row) => ({
      workOrderId: row.work_order_id,
      complaintId: row.complaint_id,
      poleName: row.pole_name,
      priority: row.priority,
      fault: row.issue_type,
      issueType: row.issue_type,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      issuedDate: row.issued_date,
      targetDate: row.target_date,
      estCost: Number(row.est_cost || 0),
      completedDate: row.completed_date,
      status: row.status,
      isHighRisk: !!row.is_high_risk,
      citizenName: row.citizen_name,
      citizenPhone: row.citizen_phone,
      wardName: row.ward_name,
      officialName: row.official_name || 'Unassigned',
      daysOverdue: Number(row.days_overdue || 0),
    })),
    budget: {
      totalBudget,
      totalOrders,
      vendors: vendorBudgets.map((row) => ({
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        serviceType: row.service_type,
        orderCount: Number(row.order_count || 0),
        totalBudget: Number(row.total_budget || 0),
      })),
    },
  };
});

add('PATCH', '/api/official/work-orders/:id/start', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const workOrderId = pathId(ctx);
  const payload = await readJson(ctx.req);
  const row = await one(
    `SELECT wo.work_order_id, wo.complaint_id, p.div_id, c.status
       FROM workorders wo
       JOIN lightcomplaints c ON c.complaint_id = wo.complaint_id
       JOIN lightpoles p      ON p.pole_id = c.pole_id
      WHERE wo.work_order_id = ?`,
    [workOrderId],
  );
  if (!row) throw new HttpError(404, 'Work order not found.');
  if (row.div_id !== user.divId) throw new HttpError(403, 'That work order belongs to another division.');
  if (row.status === 'Closed' || row.status === 'Resolved') throw new HttpError(400, 'This repair is already closed.');

  let vendorId = intOrNull(payload.vendorId);
  let vendorName = text(payload.vendorName);
  if (vendorId) {
    const v = await one('SELECT vendor_id, vendor_name FROM vendors WHERE vendor_id = ?', [vendorId]);
    if (!v) throw new HttpError(400, 'Selected vendor does not exist.');
    vendorName = v.vendor_name;
  }
  if (!vendorId && !vendorName) {
    throw new HttpError(400, 'Please select a vendor before starting the repair.');
  }

  const estCost = payload.estCost !== undefined && payload.estCost !== null ? Number(payload.estCost) : 0;
  if (!Number.isFinite(estCost) || estCost < 0) {
    throw new HttpError(400, 'Estimated cost must be a non-negative number.');
  }

  const targetDate = payload.targetDate ? validDate(payload.targetDate, 'Completion date') : null;

  await withTx(async (client) => {
    await exec(
      `UPDATE workorders
          SET vendor_id = ?,
              vendor_name = COALESCE(?, vendor_name),
              est_cost = ?,
              target_date = ?,
              official_id = ?
        WHERE work_order_id = ?`,
      [vendorId, vendorName, estCost.toFixed(2), targetDate, user.id, workOrderId],
      client,
    );
    await exec("UPDATE lightcomplaints SET status = 'In Progress' WHERE complaint_id = ?", [
      row.complaint_id,
    ], client);
  });

  return {
    complaintId: row.complaint_id,
    workOrder: await one('SELECT * FROM workorders WHERE work_order_id = ?', [workOrderId]),
    complaint: mapComplaint(
      await one('SELECT * FROM vw_complaintdetail WHERE complaint_id = ?', [row.complaint_id]),
    ),
  };
});

add('PATCH', '/api/official/work-orders/:id/update', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const workOrderId = pathId(ctx);
  const payload = await readJson(ctx.req);
  const row = await one(
    `SELECT wo.work_order_id, wo.complaint_id, p.div_id, c.status
       FROM workorders wo
       JOIN lightcomplaints c ON c.complaint_id = wo.complaint_id
       JOIN lightpoles p      ON p.pole_id = c.pole_id
      WHERE wo.work_order_id = ?`,
    [workOrderId],
  );
  if (!row) throw new HttpError(404, 'Work order not found.');
  if (row.div_id !== user.divId) throw new HttpError(403, 'That work order belongs to another division.');

  let vendorId = intOrNull(payload.vendorId);
  let vendorName = text(payload.vendorName);
  if (vendorId) {
    const v = await one('SELECT vendor_id, vendor_name FROM vendors WHERE vendor_id = ?', [vendorId]);
    if (!v) throw new HttpError(400, 'Selected vendor does not exist.');
    vendorName = v.vendor_name;
  }

  const estCost = payload.estCost !== undefined && payload.estCost !== null && payload.estCost !== '' ? Number(payload.estCost) : null;
  if (estCost !== null && (!Number.isFinite(estCost) || estCost < 0)) {
    throw new HttpError(400, 'Estimated cost must be a non-negative number.');
  }

  const targetDate = payload.targetDate ? validDate(payload.targetDate, 'Target completion date') : null;

  await exec(
    `UPDATE workorders
        SET vendor_id = COALESCE(?, vendor_id),
            vendor_name = COALESCE(?, vendor_name),
            est_cost = COALESCE(?, est_cost),
            target_date = COALESCE(?, target_date)
      WHERE work_order_id = ?`,
    [vendorId, vendorName, estCost !== null ? estCost.toFixed(2) : null, targetDate, workOrderId],
  );

  return {
    ok: true,
    workOrder: await one('SELECT * FROM workorders WHERE work_order_id = ?', [workOrderId]),
  };
});

add('PATCH', '/api/official/work-orders/:id/complete', { role: 'official' }, async (ctx) => {
  const user = divisionScopeForOfficial(ctx);
  const workOrderId = pathId(ctx);
  const row = await one(
    `SELECT wo.work_order_id, wo.complaint_id, p.div_id, c.status
       FROM workorders wo
       JOIN lightcomplaints c ON c.complaint_id = wo.complaint_id
       JOIN lightpoles p      ON p.pole_id = c.pole_id
      WHERE wo.work_order_id = ?`,
    [workOrderId],
  );
  if (!row) throw new HttpError(404, 'Work order not found.');
  if (row.div_id !== user.divId) throw new HttpError(403, 'That work order belongs to another division.');
  if (row.status === 'Closed' || row.status === 'Resolved') throw new HttpError(400, 'This repair is already closed.');
  
  await withTx(async (client) => {
    await exec("UPDATE lightcomplaints SET status = 'Closed' WHERE complaint_id = ?", [
      row.complaint_id,
    ], client);
    await exec(
      "UPDATE workorders SET completed_date = CURRENT_DATE WHERE work_order_id = ? AND completed_date IS NULL",
      [workOrderId],
      client,
    );
  });

  return {
    complaintId: row.complaint_id,
    complaint: mapComplaint(
      await one('SELECT * FROM vw_complaintdetail WHERE complaint_id = ?', [row.complaint_id]),
    ),
  };
});

/* ------------------------------- entry ------------------------------ */
export async function handleApi(req, res, url) {
  for (const entry of table) {
    if (entry.method !== req.method) continue;
    const match = entry.regex.exec(url.pathname);
    if (!match) continue;
    const params = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });

    const { session } = sessionFromRequest(req);
    const user = await userFromSession(session);

    if (entry.role && !user) throw new HttpError(401, 'Please sign in to continue.');
    if (entry.role === 'citizen' && user.role !== 'citizen') {
      throw new HttpError(403, 'Citizen portal access only.');
    }
    if (entry.role === 'official' && user.role !== 'official') {
      throw new HttpError(403, 'Official portal access only.');
    }

    try {
      const payload = await entry.handler({ req, res, url, params, user, session });
      sendJson(res, 200, payload);
    } catch (error) {
      const friendly = friendlyDbError(error);
      if (friendly) throw new HttpError(400, friendly);
      throw error;
    }
    return;
  }
  throw new HttpError(404, 'API endpoint not found.');
}
