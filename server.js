/* ============================================================
   Indian Visa Appointment Booking System
   Customer portal + Admin panel + bKash payment verification
   + automatic PDF receipt generation + booking workflow
   Database: PostgreSQL (Neon) — all tables auto-created on start
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const cookieParser = require('cookie-parser');

/* Load .env (local secrets — .env is git-ignored, never committed) */
try {
  const _envFile = path.join(__dirname, '.env');
  if (fs.existsSync(_envFile)) {
    for (const _line of fs.readFileSync(_envFile, 'utf8').split('\n')) {
      const _m = _line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (_m && !process.env[_m[1]]) process.env[_m[1]] = _m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
} catch (e) {}

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const RECEIPTS = path.join(DATA, 'receipts');
[DATA, UPLOADS, RECEIPTS].forEach(d => fs.mkdirSync(d, { recursive: true }));

/* ---------------- database (PostgreSQL / Neon) ---------------- */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill in your Neon connection string.');
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL, max: 10, connectionTimeoutMillis: 15000 });
pool.on('error', e => console.error('PG pool error:', e.message));
const q = (text, params) => pool.query(text, params);
const q1 = async (text, params = []) => { const r = await q(text, params); return r.rows[0] || null; };
const ph = n => '$' + n;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, created_at TEXT, expires_at TEXT);
CREATE TABLE IF NOT EXISTS applications(
  id TEXT PRIMARY KEY,
  created_at TEXT, updated_at TEXT, status TEXT,
  full_name TEXT, gender TEXT, dob TEXT, nationality TEXT, mobile TEXT, email TEXT,
  nid_number TEXT, occupation TEXT, employer TEXT, address TEXT,
  passport_number TEXT, passport_type TEXT, passport_issue_date TEXT, passport_expiry_date TEXT, passport_issue_place TEXT,
  visa_type TEXT, entry_type TEXT, purpose_detail TEXT, arrival_date TEXT, departure_date TEXT,
  indian_address TEXT, sponsor_name TEXT, sponsor_relation TEXT,
  visa_center TEXT, pref_earliest TEXT, pref_latest TEXT,
  service_fee TEXT, official_fee TEXT, total_paid TEXT,
  payment_amount TEXT, payment_trx_id TEXT, payment_date TEXT, payment_from_number TEXT,
  payment_verified INTEGER DEFAULT 0, payment_note TEXT, payment_verified_at TEXT,
  photo_file_id INTEGER,
  correction_message TEXT, correction_requested_at TEXT, correction_responded_at TEXT,
  booking_id TEXT, appointment_date TEXT, appointment_time TEXT, official_payment_ref TEXT,
  booking_notes TEXT, booking_at TEXT, booking_failed_reason TEXT, rejection_reason TEXT,
  receipt_path TEXT, receipt_generated_at TEXT,
  customer_token TEXT
);
CREATE TABLE IF NOT EXISTS application_files(
  id SERIAL PRIMARY KEY, app_id TEXT, file_type TEXT,
  original_name TEXT, stored_name TEXT, mime TEXT, size INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS status_log(id SERIAL PRIMARY KEY, app_id TEXT, status TEXT, note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS otp_logs(id SERIAL PRIMARY KEY, app_id TEXT, otp TEXT, purpose TEXT, created_at TEXT);
`;

/* ---------------- settings ---------------- */
const DEFAULTS = {
  business_name: 'Indian Visa Appointment Service',
  bkash_number: '',
  service_fee: '500',
  official_fee: '1500',
  official_site_url: 'https://indianvisa-bangladesh.nic.in/visa/',
  accept_new: '1',
  centers: JSON.stringify(['Dhaka', 'Chattogram', 'Rajshahi', 'Sylhet', 'Khulna'])
};
const settings = {};
async function getSet(key, def = null) {
  const r = await q1('SELECT value FROM settings WHERE key=$1', [key]);
  if (r) return r.value;
  return def !== null ? def : DEFAULTS[key];
}
async function setSet(key, value) {
  await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
}
async function adminPwHash() { return (await q1("SELECT value FROM settings WHERE key='admin_password_hash'")).value; }

/* ---------------- status meta ---------------- */
const STATUS_META = {
  submitted:            { label: 'পেমেন্ট ভেরিফিকেশন pending', labelEn: 'Payment verification pending', color: '#64748b' },
  payment_rejected:     { label: 'পেমেন্ট rejected', labelEn: 'Payment rejected', color: '#dc2626' },
  correction_needed:    { label: 'Correction requested', labelEn: 'Correction requested', color: '#d97706' },
  approved:             { label: 'Approved — Booking Queue', labelEn: 'Approved — Booking queue', color: '#2563eb' },
  booking_in_progress:  { label: 'Booking in progress', labelEn: 'Booking in progress', color: '#7c3aed' },
  slot_found:           { label: 'Slot found — confirm', labelEn: 'Slot found — confirm booking', color: '#0d9488' },
  booked:               { label: 'Booked ✓', labelEn: 'Booked', color: '#16a34a' },
  booking_failed:       { label: 'Booking failed', labelEn: 'Booking failed', color: '#e11d48' },
  rejected:             { label: 'Rejected', labelEn: 'Rejected', color: '#7f1d1d' }
};
const STATUSES = Object.keys(STATUS_META);

/* ---------------- helpers ---------------- */
const now = () => new Date().toISOString();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
async function getAppByRef(ref) { return q1('SELECT * FROM applications WHERE id=$1', [String(ref || '').trim().toUpperCase()]); }
async function logStatus(appId, status, note) { await q('INSERT INTO status_log(app_id,status,note,created_at) VALUES($1,$2,$3,$4)', [appId, status, note || '', now()]); }
async function setAppStatus(app, status, note) {
  await q('UPDATE applications SET status=$1, updated_at=$2 WHERE id=$3', [status, now(), app.id]);
  await logStatus(app.id, status, note);
}
async function nextAppId() {
  const y = new Date().getFullYear();
  for (let i = 0; i < 200; i++) {
    const r = await q1('SELECT COUNT(*) AS c FROM applications WHERE id LIKE $1', ['IVB-' + y + '-%']);
    const n = (r ? Number(r.c) : 0) + 1;
    const id = 'IVB-' + y + '-' + String(n).padStart(4, '0');
    if (!(await q1('SELECT 1 FROM applications WHERE id=$1', [id]))) return id;
  }
  throw new Error('Could not generate application id');
}
const json = express.json({ limit: '2mb' });

/* ---------------- upload ---------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(10).toString('hex') + path.extname(file.originalname).slice(0, 10).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const f = file.fieldname;
    const isImg = file.mimetype && file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (f === 'photo' && !isImg) return cb(new Error('Photo (ছবি) must be an image — JPG/PNG/WebP allowed.'));
    if ((f === 'passport_bio' || f === 'extra_doc') && !(isImg || isPdf)) return cb(new Error('Document: JPG/PNG/WebP/PDF allowed.'));
    cb(null, true);
  }
});
const upFields = upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'passport_bio', maxCount: 1 }, { name: 'extra_doc', maxCount: 4 }]);

function cleanUpFiles(files) {
  if (!files) return;
  for (const k of Object.keys(files)) (files[k] || []).forEach(f => { try { fs.unlinkSync(path.join(UPLOADS, f.filename)); } catch (e) {} });
}

/* ---------------- app ---------------- */
const app = express();
app.use(cookieParser());
app.use(express.static(path.join(ROOT, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/status', (req, res) => res.sendFile(path.join(ROOT, 'public', 'status.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/api/health', (req, res) => res.json({ ok: true, db: 'postgres' }));

function publicConfig() {
  const sf = Number(settings.service_fee || 0), of = Number(settings.official_fee || 0);
  return {
    business_name: settings.business_name,
    bkash_number: settings.bkash_number || null,
    service_fee: sf, official_fee: of, total: sf + of,
    official_site_url: settings.official_site_url,
    accept_new: settings.accept_new === '1',
    centers: JSON.parse(settings.centers || '[]'),
    status_labels: STATUS_META
  };
}
app.get('/api/public/config', (req, res) => res.json(publicConfig()));

/* ---------------- public: apply ---------------- */
app.post('/api/public/apply', upFields, ah(async (req, res) => {
  try {
    if (settings.accept_new !== '1') return res.status(403).json({ error: 'নতুন application এই মুহূর্তে accept করা হচ্ছে না। পরে আবার চেষ্টা করুন।' });
    if (!settings.bkash_number) return res.status(400).json({ error: 'Payment details are not configured yet. Please try again later.' });
    const b = req.body || {};
    const errors = [];
    const required = ['full_name', 'gender', 'dob', 'nationality', 'mobile', 'address',
      'passport_number', 'passport_type', 'passport_issue_date', 'passport_expiry_date', 'passport_issue_place',
      'visa_type', 'entry_type', 'purpose_detail', 'arrival_date', 'departure_date',
      'visa_center', 'pref_earliest', 'pref_latest',
      'payment_amount', 'payment_trx_id', 'payment_date', 'payment_from_number'];
    for (const f of required) if (!b[f] || !String(b[f]).trim()) errors.push('Missing required field: ' + f);

    const mobile = String(b.mobile || '').replace(/[\s-]/g, '');
    if (mobile && !/^01[3-9]\d{8}$/.test(mobile)) errors.push('Mobile number must be a valid Bangladeshi number (01XXXXXXXXX).');
    const from = String(b.payment_from_number || '').replace(/[\s-]/g, '');
    if (from && !/^(\+?88)?01[3-9]\d{8}$/.test(from)) errors.push('Payment bKash number must be valid (01XXXXXXXXX).');
    if (b.dob && b.dob >= new Date().toISOString().slice(0, 10)) errors.push('Date of birth must be in the past.');
    if (b.passport_expiry_date) {
      const min = new Date(); min.setDate(min.getDate() + 180);
      if (b.passport_expiry_date < min.toISOString().slice(0, 10)) errors.push('Passport must be valid at least 6 months from today.');
    }
    if (b.arrival_date && b.departure_date && b.departure_date < b.arrival_date) errors.push('Departure date must be after arrival date.');
    if (b.pref_earliest && b.pref_latest && b.pref_latest < b.pref_earliest) errors.push('Preferred latest date must be after earliest date.');
    if (b.payment_trx_id && String(b.payment_trx_id).trim().length < 8) errors.push('bKash Transaction ID looks too short.');
    const files = req.files || {};
    if (!files.photo || !files.photo[0]) errors.push('Passport size photo is required (ছবি অবশ্যই দিতে হবে).');
    if (!files.passport_bio || !files.passport_bio[0]) errors.push('Passport bio-page scan is required.');
    if (errors.length) { cleanUpFiles(files); return res.status(400).json({ error: errors.join(' • ') }); }

    const sf = Number(settings.service_fee || 0), of = Number(settings.official_fee || 0);
    const id = await nextAppId();
    const token = crypto.randomBytes(16).toString('hex');
    const cols = ['id', 'created_at', 'updated_at', 'status',
      'full_name', 'gender', 'dob', 'nationality', 'mobile', 'email', 'nid_number', 'occupation', 'employer', 'address',
      'passport_number', 'passport_type', 'passport_issue_date', 'passport_expiry_date', 'passport_issue_place',
      'visa_type', 'entry_type', 'purpose_detail', 'arrival_date', 'departure_date', 'indian_address', 'sponsor_name', 'sponsor_relation',
      'visa_center', 'pref_earliest', 'pref_latest',
      'service_fee', 'official_fee', 'total_paid',
      'payment_amount', 'payment_trx_id', 'payment_date', 'payment_from_number',
      'customer_token'];
    const vals = [id, now(), now(), 'submitted',
      b.full_name.trim(), b.gender, b.dob, b.nationality, mobile, (b.email || '').trim(), (b.nid_number || '').trim(), (b.occupation || '').trim(), (b.employer || '').trim(), b.address.trim(),
      b.passport_number.trim().toUpperCase(), b.passport_type, b.passport_issue_date, b.passport_expiry_date, b.passport_issue_place.trim(),
      b.visa_type, b.entry_type, b.purpose_detail.trim(), b.arrival_date, b.departure_date, (b.indian_address || '').trim(), (b.sponsor_name || '').trim(), (b.sponsor_relation || '').trim(),
      b.visa_center, b.pref_earliest, b.pref_latest,
      sf, of, sf + of,
      b.payment_amount, String(b.payment_trx_id).trim(), b.payment_date, from,
      token];
    await q('INSERT INTO applications(' + cols.join(',') + ') VALUES(' + cols.map((_, i) => ph(i + 1)).join(',') + ')', vals);
    const insFile = 'INSERT INTO application_files(app_id,file_type,original_name,stored_name,mime,size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id';
    let photoFileId = null;
    if (files.photo[0]) photoFileId = (await q(insFile, [id, 'photo', files.photo[0].originalname, files.photo[0].filename, files.photo[0].mimetype, files.photo[0].size, now()])).rows[0].id;
    if (files.passport_bio[0]) await q(insFile, [id, 'passport_bio', files.passport_bio[0].originalname, files.passport_bio[0].filename, files.passport_bio[0].mimetype, files.passport_bio[0].size, now()]);
    for (const f of (files.extra_doc || [])) await q(insFile, [id, 'extra_doc', f.originalname, f.filename, f.mimetype, f.size, now()]);
    await q('UPDATE applications SET photo_file_id=$1 WHERE id=$2', [photoFileId, id]);
    await logStatus(id, 'submitted', 'Application submitted with documents & bKash payment info');
    res.json({ ok: true, app_ref: id, total: sf + of });
  } catch (e) { cleanUpFiles(req.files); throw e; }
}));

/* ---------------- public: status check ---------------- */
const CUSTOMER_FIELDS = ['full_name', 'mobile', 'email', 'nid_number', 'occupation', 'employer', 'address',
  'passport_number', 'passport_issue_date', 'passport_expiry_date', 'passport_issue_place',
  'visa_type', 'entry_type', 'purpose_detail', 'arrival_date', 'departure_date', 'indian_address',
  'sponsor_name', 'sponsor_relation', 'visa_center', 'pref_earliest', 'pref_latest',
  'payment_amount', 'payment_trx_id', 'payment_date', 'payment_from_number'];

app.get('/api/public/check', ah(async (req, res) => {
  const row = await getAppByRef(req.query.ref);
  if (!row || String(req.query.mobile || '').replace(/[\s-]/g, '') !== String(row.mobile).replace(/[\s-]/g, ''))
    return res.status(404).json({ error: 'Application not found. Application ID ও mobile number সঠিক কিনা চেক করুন।' });
  const timeline = (await q('SELECT status,note,created_at FROM status_log WHERE app_id=$1 ORDER BY id ASC LIMIT 15', [row.id])).rows;
  const vals = {};
  CUSTOMER_FIELDS.forEach(f => vals[f] = row[f]);
  const files = (await q('SELECT id,file_type,original_name FROM application_files WHERE app_id=$1 ORDER BY id', [row.id])).rows;
  const notifMsg =
    row.status === 'correction_needed' ? row.correction_message :
    row.status === 'payment_rejected' ? row.payment_note :
    row.status === 'rejected' ? row.rejection_reason :
    row.status === 'booking_failed' ? row.booking_failed_reason : null;
  res.json({
    app_ref: row.id,
    status: row.status,
    status_meta: STATUS_META[row.status],
    name: row.full_name,
    center: row.visa_center,
    visa_type: row.visa_type,
    payment_verified: !!row.payment_verified,
    payment_amount: row.payment_amount,
    notification: notifMsg,
    can_correct: ['correction_needed', 'payment_rejected'].includes(row.status),
    values: vals,
    photo_file_id: row.photo_file_id,
    files,
    appointment: row.status === 'booked' ? { date: row.appointment_date, time: row.appointment_time, center: row.visa_center, booking_id: row.booking_id } : null,
    has_receipt: !!row.receipt_path,
    token: row.customer_token
  });
}));

/* ---------------- public: correction ---------------- */
app.post('/api/public/correct', upFields, ah(async (req, res) => {
  try {
    const b = req.body || {};
    const row = await getAppByRef(b.ref);
    if (!row) return res.status(404).json({ error: 'Application not found.' });
    if (String(b.mobile || '').replace(/[\s-]/g, '') !== String(row.mobile).replace(/[\s-]/g, ''))
      return res.status(404).json({ error: 'Mobile number match করে না।' });
    if (!['correction_needed', 'payment_rejected'].includes(row.status))
      return res.status(400).json({ error: 'এই মুহূর্তে কোনো correction লাগছে না।' });

    const sets = [], vals = []; let pi = 1;
    for (const f of CUSTOMER_FIELDS) if (b[f] !== undefined && String(b[f]).trim() !== '') { sets.push(f + '=' + ph(pi++)); vals.push(String(b[f]).trim()); }
    sets.push('updated_at=' + ph(pi++)); vals.push(now());
    sets.push('correction_message=NULL');
    sets.push('correction_responded_at=' + ph(pi++)); vals.push(now());

    const files = req.files || {};
    if (files.photo && files.photo[0]) {
      const old = row.photo_file_id ? await q1('SELECT stored_name FROM application_files WHERE id=$1', [row.photo_file_id]) : null;
      if (old) { try { fs.unlinkSync(path.join(UPLOADS, old.stored_name)); } catch (e) {} }
      const fid = (await q('INSERT INTO application_files(app_id,file_type,original_name,stored_name,mime,size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [row.id, 'photo', files.photo[0].originalname, files.photo[0].filename, files.photo[0].mimetype, files.photo[0].size, now()])).rows[0].id;
      sets.push('photo_file_id=' + ph(pi++)); vals.push(fid);
    }
    for (const f of (files.extra_doc || [])) await q('INSERT INTO application_files(app_id,file_type,original_name,stored_name,mime,size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [row.id, 'extra_doc', f.originalname, f.filename, f.mimetype, f.size, now()]);
    if (sets.length) {
      vals.push(row.id);
      await q('UPDATE applications SET ' + sets.join(',') + ' WHERE id=' + ph(pi), vals);
    }
    const mobileNew = b.mobile && String(b.mobile).trim() ? String(b.mobile).replace(/[\s-]/g, '') : row.mobile;
    const newStatus = row.status === 'payment_rejected' ? 'submitted' : (row.payment_verified ? 'approved' : 'submitted');
    setAppStatus(row, newStatus, 'Customer submitted correction — re-review');
    if (String(mobileNew) !== String(row.mobile)) await q('UPDATE applications SET mobile=$1 WHERE id=$2', [mobileNew, row.id]);
    res.json({ ok: true, status: newStatus });
  } catch (e) { cleanUpFiles(req.files); throw e; }
}));

/* ---------------- public: files & receipt (token secured) ---------------- */
app.get('/api/public/files/:id', ah(async (req, res) => {
  const f = await q1('SELECT f.*, a.customer_token AS tok FROM application_files f JOIN applications a ON a.id=f.app_id WHERE f.id=$1', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (req.query.token !== f.tok) return res.status(403).json({ error: 'forbidden' });
  res.sendFile(path.join(UPLOADS, f.stored_name));
}));
app.get('/api/public/receipt/:ref', ah(async (req, res) => {
  const row = await getAppByRef(req.params.ref);
  if (!row || !row.receipt_path) return res.status(404).json({ error: 'Receipt not ready yet.' });
  if (req.query.token !== row.customer_token) return res.status(403).json({ error: 'forbidden' });
  res.download(row.receipt_path, row.id + '_receipt.pdf');
}));

/* ---------------- admin auth ---------------- */
async function adminAuth(req, res, next) {
  const t = req.cookies.admin_session;
  if (!t) return res.status(401).json({ error: 'unauthorized' });
  const s = await q1('SELECT * FROM sessions WHERE token=$1', [t]);
  if (!s || new Date(s.expires_at) < new Date()) return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.post('/api/admin/login', json, ah(async (req, res) => {
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(String(password), await adminPwHash()))
    return res.status(401).json({ error: 'Password সঠিক নয়।' });
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  await q('INSERT INTO sessions(token,created_at,expires_at) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET created_at=excluded.created_at, expires_at=excluded.expires_at', [token, now(), exp]);
  res.cookie('admin_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
  res.json({ ok: true });
}));
app.post('/api/admin/logout', adminAuth, ah(async (req, res) => {
  await q('DELETE FROM sessions WHERE token=$1', [req.cookies.admin_session]);
  res.clearCookie('admin_session');
  res.json({ ok: true });
}));
app.get('/api/admin/me', adminAuth, (req, res) => res.json({ ok: true }));

/* ---------------- admin: dashboard ---------------- */
app.get('/api/admin/dashboard', adminAuth, ah(async (req, res) => {
  const counts = {};
  STATUSES.forEach(s => counts[s] = 0);
  for (const r of (await q('SELECT status, COUNT(*) AS c FROM applications GROUP BY status')).rows) counts[r.status] = Number(r.c);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const needsAction = (await q("SELECT id,full_name,visa_center,visa_type,mobile,created_at FROM applications WHERE status IN ('submitted','approved','slot_found','booking_failed','payment_rejected') ORDER BY created_at DESC LIMIT 15")).rows;
  const recent = (await q('SELECT id,full_name,visa_center,visa_type,status,created_at FROM applications ORDER BY created_at DESC LIMIT 8')).rows;
  res.json({ counts, total, needsAction, recent });
}));

/* ---------------- admin: apps list/detail ---------------- */
app.get('/api/admin/apps', adminAuth, ah(async (req, res) => {
  const w = [], p = []; let pi = 1;
  let sql = "SELECT a.*, (SELECT COUNT(*) FROM application_files f WHERE f.app_id=a.id AND f.file_type='extra_doc') AS extra_count FROM applications a WHERE 1=1";
  if (req.query.status) { w.push('a.status=' + ph(pi++)); p.push(req.query.status); }
  if (req.query.center) { w.push('a.visa_center=' + ph(pi++)); p.push(req.query.center); }
  if (req.query.q) {
    w.push('(a.id LIKE ' + ph(pi++) + ' OR a.full_name LIKE ' + ph(pi++) + ' OR a.mobile LIKE ' + ph(pi++) + ' OR a.passport_number LIKE ' + ph(pi++) + ')');
    const s = '%' + req.query.q + '%'; p.push(s, s, s, s);
  }
  if (w.length) sql += ' AND ' + w.join(' AND ');
  sql += ' ORDER BY a.created_at DESC LIMIT 300';
  res.json((await q(sql, p)).rows);
}));

app.get('/api/admin/apps/:id', adminAuth, ah(async (req, res) => {
  const row = await getAppByRef(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const files = (await q('SELECT id,file_type,original_name,mime,size,created_at FROM application_files WHERE app_id=$1 ORDER BY id', [row.id])).rows;
  const timeline = (await q('SELECT status,note,created_at FROM status_log WHERE app_id=$1 ORDER BY id ASC LIMIT 30', [row.id])).rows;
  const otps = (await q('SELECT id,otp,purpose,created_at FROM otp_logs WHERE app_id=$1 ORDER BY id DESC LIMIT 20', [row.id])).rows;
  res.json({ ...row, files, timeline, otps, status_meta: STATUS_META[row.status] });
}));

/* ---------------- admin: payment ---------------- */
app.post('/api/admin/apps/:id/payment', adminAuth, json, ah(async (req, res) => {
  const row = await getAppByRef(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { verified, note } = req.body || {};
  if (verified === 1 || verified === true) {
    await q('UPDATE applications SET payment_verified=1, payment_verified_at=$1, payment_note=$2, updated_at=$3 WHERE id=$4', [now(), note || '', now(), row.id]);
    await logStatus(row.id, 'submitted', 'Payment verified' + (note ? ' — ' + note : ''));
    res.json({ ok: true, status: row.status });
  } else {
    await q('UPDATE applications SET payment_verified=0, payment_note=$1, updated_at=$2 WHERE id=$3', [note || 'Payment could not be verified.', now(), row.id]);
    await setAppStatus(row, 'payment_rejected', note || 'Payment rejected');
    res.json({ ok: true, status: 'payment_rejected' });
  }
}));

/* ---------------- admin: correction request ---------------- */
app.post('/api/admin/apps/:id/correction', adminAuth, json, ah(async (req, res) => {
  const row = await getAppByRef(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!['submitted', 'correction_needed', 'approved'].includes(row.status))
    return res.status(400).json({ error: 'This status does not allow correction request.' });
  const message = String((req.body || {}).message || '').trim();
  if (!message) return res.status(400).json({ error: 'Correction message দিতে হবে।' });
  await q('UPDATE applications SET correction_message=$1, correction_requested_at=$2, correction_responded_at=NULL, updated_at=$3 WHERE id=$4', [message, now(), now(), row.id]);
  await setAppStatus(row, 'correction_needed', 'Correction requested: ' + message.slice(0, 120));
  res.json({ ok: true });
}));

/* ---------------- admin: status transitions ---------------- */
const TRANSITIONS = {
  approved: ['submitted', 'correction_needed'],
  booking_in_progress: ['approved', 'slot_found', 'booking_failed'],
  slot_found: ['booking_in_progress', 'slot_found'],
  booked: ['booking_in_progress', 'slot_found'],
  booking_failed: ['booking_in_progress', 'slot_found'],
  rejected: ['submitted', 'payment_rejected', 'correction_needed', 'approved'],
  submitted: ['payment_rejected', 'rejected']
};
app.post('/api/admin/apps/:id/status', adminAuth, json, ah(async (req, res) => {
  const row = await getAppByRef(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { status, note, booking_id, appointment_date, appointment_time, official_payment_ref, booking_notes } = req.body || {};
  if (!TRANSITIONS[status] || !TRANSITIONS[status].includes(row.status))
    return res.status(400).json({ error: `Cannot move from "${row.status}" to "${status}".` });
  if (status === 'approved' && !row.payment_verified)
    return res.status(400).json({ error: 'Payment verified না হলে application accept করা যাবে না।' });

  const sets = ['status=$1', 'updated_at=$2']; const vals = [status, now()]; let pi = 3;
  if (status === 'slot_found' || status === 'booked') {
    if (!appointment_date || !appointment_time) return res.status(400).json({ error: 'Appointment date ও time দিতে হবে।' });
    sets.push('appointment_date=' + ph(pi++), 'appointment_time=' + ph(pi++)); vals.push(appointment_date, appointment_time);
  }
  if (status === 'booked') {
    if (!booking_id) return res.status(400).json({ error: 'Official Booking/Appointment ID দিতে হবে।' });
    sets.push('booking_id=' + ph(pi++), 'official_payment_ref=' + ph(pi++), 'booking_notes=' + ph(pi++), 'booking_at=' + ph(pi++), 'booking_failed_reason=NULL');
    vals.push(String(booking_id).trim(), (official_payment_ref || '').trim(), (booking_notes || '').trim(), now());
  }
  if (status === 'booking_failed') { sets.push('booking_failed_reason=' + ph(pi++)); vals.push(note || 'No reason provided'); }
  if (status === 'rejected') { sets.push('rejection_reason=' + ph(pi++)); vals.push(note || 'No reason provided'); }
  vals.push(row.id);
  await q('UPDATE applications SET ' + sets.join(',') + ' WHERE id=' + ph(pi), vals);

  let receiptPath = null;
  if (status === 'booked') {
    const fresh = await getAppByRef(row.id);
    receiptPath = generateReceipt(fresh);
    await q('UPDATE applications SET receipt_path=$1, receipt_generated_at=$2 WHERE id=$3', [receiptPath, now(), row.id]);
  }
  const noteText = {
    approved: 'Application accepted — added to booking queue',
    booking_in_progress: 'Booking process started',
    slot_found: 'Slot found: ' + appointment_date + ' ' + appointment_time,
    booked: 'Booking completed — booking ID ' + booking_id + ' (receipt auto-generated)',
    booking_failed: 'Booking failed: ' + (note || ''),
    rejected: 'Application rejected: ' + (note || ''),
    submitted: 'Reopened'
  }[status] || '';
  await logStatus(row.id, status, noteText);
  res.json({ ok: true, status, receipt: receiptPath ? '/api/admin/apps/' + row.id + '/receipt' : null });
}));

/* ---------------- admin: otp log ---------------- */
app.post('/api/admin/apps/:id/otp', adminAuth, json, ah(async (req, res) => {
  const row = await getAppByRef(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { otp, purpose } = req.body || {};
  if (!otp || String(otp).trim().length < 3) return res.status(400).json({ error: 'OTP দিতে হবে।' });
  await q('INSERT INTO otp_logs(app_id,otp,purpose,created_at) VALUES($1,$2,$3,$4)', [row.id, String(otp).trim(), (purpose || '').trim(), now()]);
  await logStatus(row.id, row.status, 'OTP recorded (' + (purpose || 'general') + ')');
  res.json({ ok: true });
}));

/* ---------------- admin: receipt & files ---------------- */
app.get('/api/admin/apps/:id/receipt', adminAuth, ah(async (req, res) => {
  const row = await getAppByRef(req.params.id);
  if (!row || !row.receipt_path) return res.status(404).json({ error: 'Receipt not ready.' });
  res.sendFile(row.receipt_path);
}));
app.get('/api/admin/files/:id', adminAuth, ah(async (req, res) => {
  const f = await q1('SELECT * FROM application_files WHERE id=$1', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(UPLOADS, f.stored_name));
}));
app.get('/api/admin/receipts', adminAuth, ah(async (req, res) => {
  res.json((await q('SELECT id,full_name,visa_center,appointment_date,appointment_time,booking_id,receipt_generated_at FROM applications WHERE receipt_path IS NOT NULL ORDER BY booking_at DESC')).rows);
}));

/* ---------------- admin: booking sheet (printable) ---------------- */
app.get('/api/admin/apps/:id/sheet', adminAuth, ah(async (req, res) => {
  const a = await getAppByRef(req.params.id);
  if (!a) return res.status(404).send('Not found');
  const rows = [
    ['Full Name (as per passport)', a.full_name], ['Gender', a.gender], ['Date of Birth', a.dob],
    ['Nationality', a.nationality], ['Mobile (OTP no.)', a.mobile], ['Email', a.email || '-'],
    ['NID Number', a.nid_number || '-'], ['Occupation', a.occupation || '-'], ['Employer', a.employer || '-'],
    ['Current Address', a.address],
    ['Passport Number', a.passport_number], ['Passport Type', a.passport_type],
    ['Passport Issue Date', a.passport_issue_date], ['Passport Expiry Date', a.passport_expiry_date],
    ['Place of Issue', a.passport_issue_place],
    ['Visa Type', a.visa_type], ['Entry Type', a.entry_type], ['Purpose', a.purpose_detail],
    ['Intended Arrival', a.arrival_date], ['Intended Departure', a.departure_date],
    ['Address in India', a.indian_address || '-'], ['Sponsor', a.sponsor_name ? a.sponsor_name + ' (' + a.sponsor_relation + ')' : '-'],
    ['Preferred Visa Center', a.visa_center], ['Preferred Window', a.pref_earliest + ' → ' + a.pref_latest],
    ['Payment', 'BDT ' + a.payment_amount + ' via bKash — TrxID: ' + a.payment_trx_id]
  ];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Booking Sheet ${esc(a.id)}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;color:#0f172a;margin:32px;max-width:900px}
h1{font-size:20px;margin:0 0 4px} .sub{color:#475569;font-size:13px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
td{border:1px solid #cbd5e1;padding:7px 10px;font-size:13.5px;vertical-align:top}
td.l{width:240px;background:#f1f5f9;font-weight:600}
h2{font-size:15px;margin:22px 0 8px;color:#1e3a8a}
ol li{font-size:13.5px;margin-bottom:5px}
.box{border:1px dashed #94a3b8;border-radius:8px;padding:12px 16px;font-size:13px;background:#f8fafc}
@media print { .noprint{display:none} }
</style></head><body>
<h1>Booking Sheet — ${esc(a.id)}</h1>
<div class="sub">Indian Visa Appointment • Generated ${new Date().toUTCString()} • Use this sheet on the official website, then record the result in the Admin Panel.</div>
<table>${rows.map(r => `<tr><td class="l">${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>
<h2>Booking Checklist</h2>
<ol>
<li>Open official site: <a href="${esc(settings.official_site_url)}">${esc(settings.official_site_url)}</a></li>
<li>Login / create account with customer's passport details &amp; mobile number (${esc(a.mobile)}).</li>
<li>Fill the application using the data above (copy-paste fields).</li>
<li>Select center: <b>${esc(a.visa_center)}</b>. Choose a slot inside the preferred window ${esc(a.pref_earliest)} → ${esc(a.pref_latest)}.</li>
<li>When OTP arrives on the customer's phone, the customer shares it — record it in Admin Panel (OTP Log) for tracking.</li>
<li>Pay the official appointment/visa fee on the official site (normal bKash/card flow — never automate with stored PIN).</li>
<li>Download/screenshot the confirmation. Note the Booking ID, appointment date &amp; time.</li>
<li>Return to Admin Panel → <b>Mark Booked</b> with Booking ID + date/time. Receipt PDF is generated automatically.</li>
</ol>
<div class="box">⚠️ Do not share customer credentials beyond this booking. Keep OTP logs minimal. Follow the official site's Terms of Service — booking is completed by a human operator, not a bot.</div>
<button class="noprint" onclick="window.print()" style="margin-top:18px;padding:10px 22px;font-size:14px;cursor:pointer;border:0;border-radius:8px;background:#1e3a8a;color:#fff">🖨️ Print / Save PDF</button>
</body></html>`);
}));

/* ---------------- admin: export ---------------- */
app.get('/api/admin/export.csv', adminAuth, ah(async (req, res) => {
  const rows = (await q('SELECT * FROM applications ORDER BY created_at DESC')).rows;
  const cols = ['id', 'full_name', 'mobile', 'email', 'visa_center', 'visa_type', 'entry_type', 'purpose_detail',
    'arrival_date', 'departure_date', 'passport_number', 'service_fee', 'official_fee', 'total_paid',
    'payment_amount', 'payment_trx_id', 'payment_from_number', 'payment_verified', 'status',
    'appointment_date', 'appointment_time', 'booking_id', 'booking_failed_reason', 'created_at', 'updated_at'];
  const csvEsc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => csvEsc(r[c])).join(','))).join('\n');
  res.setHeader('Content-Disposition', 'attachment; filename="applications_export.csv"');
  res.type('text/csv').send('\uFEFF' + csv);
}));

/* ---------------- admin: settings ---------------- */
app.get('/api/admin/settings', adminAuth, (req, res) => {
  res.json({
    business_name: settings.business_name,
    bkash_number: settings.bkash_number || '',
    service_fee: settings.service_fee,
    official_fee: settings.official_fee,
    official_site_url: settings.official_site_url,
    accept_new: settings.accept_new,
    centers: JSON.parse(settings.centers || '[]')
  });
});
app.post('/api/admin/settings', adminAuth, json, ah(async (req, res) => {
  const b = req.body || {};
  if (b.business_name !== undefined) { settings.business_name = String(b.business_name).trim() || DEFAULTS.business_name; await setSet('business_name', settings.business_name); }
  if (b.bkash_number !== undefined) { settings.bkash_number = String(b.bkash_number).trim().replace(/[\s-]/g, ''); await setSet('bkash_number', settings.bkash_number); }
  if (b.service_fee !== undefined) { settings.service_fee = String(Number(b.service_fee) || 0); await setSet('service_fee', settings.service_fee); }
  if (b.official_fee !== undefined) { settings.official_fee = String(Number(b.official_fee) || 0); await setSet('official_fee', settings.official_fee); }
  if (b.official_site_url !== undefined) { settings.official_site_url = String(b.official_site_url).trim(); await setSet('official_site_url', settings.official_site_url); }
  if (b.accept_new !== undefined) { settings.accept_new = b.accept_new ? '1' : '0'; await setSet('accept_new', settings.accept_new); }
  if (Array.isArray(b.centers)) { settings.centers = JSON.stringify(b.centers.map(c => String(c).trim()).filter(Boolean)); await setSet('centers', settings.centers); }
  if (b.new_password) {
    if (!bcrypt.compareSync(String(b.current_password || ''), await adminPwHash()))
      return res.status(400).json({ error: 'Current password সঠিক নয়।' });
    if (String(b.new_password).length < 8) return res.status(400).json({ error: 'New password অন্তত ৮ character হতে হবে।' });
    await setSet('admin_password_hash', bcrypt.hashSync(String(b.new_password), 10));
  }
  res.json({ ok: true });
}));

/* ---------------- receipt PDF ---------------- */
function generateReceipt(a) {
  const file = path.join(RECEIPTS, a.id + '_receipt.pdf');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const out = fs.createWriteStream(file);
  doc.pipe(out);

  const W = doc.page.width;
  doc.rect(0, 0, W, 96).fill('#1e3a8a');
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(17).text(settings.business_name, 50, 30, { width: W - 100 });
  doc.font('Helvetica').fontSize(11).fillOpacity(0.9).text('Indian Visa Appointment — Booking Receipt', 50, 56, { width: W - 100 });
  doc.fillOpacity(1).fillColor('#111827');

  const rows = [
    ['Application No.', a.id],
    ['Booking / Appointment ID', a.booking_id || '-'],
    ['Applicant Name', a.full_name],
    ['Passport No.', a.passport_number],
    ['Visa Type', (a.visa_type || '') + '  (' + (a.entry_type || '') + ')'],
    ['Visa Center', 'IVAC ' + (a.visa_center || '') + ', Bangladesh'],
    ['Appointment Date', a.appointment_date || '-'],
    ['Appointment Time', a.appointment_time || '-'],
    ['IVAC Processing Fee (official)', a.official_fee ? 'BDT ' + a.official_fee : 'Paid separately'],
    ['Service Fee', a.service_fee ? 'BDT ' + a.service_fee : '-'],
    ['Total Paid to Service', a.total_paid ? 'BDT ' + a.total_paid : '-'],
    ['bKash Trx ID', a.payment_trx_id || '-'],
    ['Paid From (bKash)', a.payment_from_number || '-'],
    ['Official Payment Ref', a.official_payment_ref || '-']
  ];
  let y = 130;
  doc.font('Helvetica').fontSize(10).fillColor('#64748b')
    .text('Receipt generated: ' + new Date().toUTCString(), 50, y - 22, { width: W - 100, align: 'right' });
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#334155').text(k, 50, y, { width: 230 });
    doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(String(v || '-'), 290, y, { width: W - 340 });
    y += 26;
    doc.moveTo(50, y - 8).lineTo(W - 50, y - 8).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
  }
  y += 14;
  doc.font('Helvetica').fontSize(9.5).fillColor('#6b7280')
    .text('Bring this receipt (print or phone) with your original passport on your appointment day. ' +
      'This is a computer-generated receipt issued by the booking service. For appointment details, ' +
      'always verify against the official confirmation from the Indian visa portal.', 50, y, { width: W - 100 });
  doc.end();
  return file;
}

/* ---------------- error handling ---------------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 8 MB each).' : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

/* ---------------- init ---------------- */
(async function init() {
  await q(SCHEMA);
  for (const k of Object.keys(DEFAULTS)) settings[k] = await getSet(k);
  if (!settings.bkash_number) settings.bkash_number = null;
  const adminRow = await q1("SELECT value FROM settings WHERE key='admin_password_hash'");
  if (!adminRow) {
    const pw = 'Admin-' + crypto.randomInt(100000, 999999);
    await setSet('admin_password_hash', bcrypt.hashSync(pw, 10));
    fs.writeFileSync(path.join(DATA, '.admin_password.txt'), pw + '\n', { mode: 0o600 });
    console.log('\n*** FIRST RUN — initial admin password: ' + pw + '  (saved in data/.admin_password.txt) ***\n');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Visa booking system running on http://0.0.0.0:' + PORT);
    console.log('Database: PostgreSQL (Neon) — tables ready');
    console.log('Admin panel: http://localhost:' + PORT + '/admin');
  });
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
