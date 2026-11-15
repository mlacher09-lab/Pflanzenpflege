// Gemeinsame Helfer für Konten: Passwort-Hashing (scrypt), Sitzungen, Anfrage-/Antwort-Hilfen.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { getPool, ensureSchema } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = 180;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

export function setCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]));
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-app-token');
  res.setHeader('Vary', 'Origin');
}
export function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }

/** Liest den JSON-Body (Vercel liefert ihn evtl. schon geparst). Wirft Error mit .status = 413/400. */
export async function readBody(req, maxBytes = 20_000) {
  const declared = Number(req.headers?.['content-length'] || 0);
  if (declared > maxBytes) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
  try {
    if (req.body !== undefined && req.body !== null && req.body !== '') {
      if (typeof req.body === 'string') { if (req.body.length > maxBytes) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 }); return JSON.parse(req.body); }
      return req.body;
    }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 }); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error('Ungültige Anfrage'), { status: 400 });
  }
}

export function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
export function validEmail(email) { return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email); }
export function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`;
  if (pw.length > MAX_PASSWORD) return 'Das Passwort ist zu lang.';
  return null;
}

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(pw, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const got = await scrypt(String(pw), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}
let dummyHash = null;
/** Rechnet einen Hash durch, damit „Nutzer unbekannt“ nicht schneller antwortet als „Passwort falsch“. */
export async function fakeVerify(pw) { dummyHash ||= await hashPassword('dummy-password'); await verifyPassword(pw, dummyHash); }

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await getPool().query(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)`,
    [sha256(token), userId, new Date(), new Date(Date.now() + SESSION_DAYS * 86400000)]);
  return token;
}
export function bearerToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers?.authorization || ''));
  return m ? m[1] : null;
}
/** Gibt { id, email, tokenHash } der gültigen Sitzung zurück oder null. */
export async function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  await ensureSchema();
  const tokenHash = sha256(token);
  const { rows } = await getPool().query(
    `SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [tokenHash]);
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, email: row.email, tokenHash };
}
