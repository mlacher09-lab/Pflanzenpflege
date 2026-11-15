// Gemeinsamer Garten (Haushalt/WG).  GET → { household: {...}|null }
// POST { action: 'create'|'join'|'leave'|'rename'|'regenerate_code'|'remove_member', ... } → { household }
import crypto from 'node:crypto';
import { dbConfigured, getPool, ensureSchema } from '../lib/db.js';
import { setCors, send, readBody, authenticate, normalizeEmail } from '../lib/auth.js';
import { HOUSEHOLD_PREFIX, leaveHouseholdTx } from '../lib/space.js';

export const MAX_MEMBERS = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ohne I, O, 0, 1
const CODE_LEN = 8;
const MAX_NAME = 60;

const err = (status, message) => Object.assign(new Error(message), { status });
const newCode = () => Array.from(crypto.randomBytes(CODE_LEN), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const cleanName = n => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

// Bremse gegen Raten des Einladungscodes (pro Nutzer und IP, nur pro Instanz im Speicher).
const tries = new Map();
const MAX_TRIES = 10, WINDOW_MS = 15 * 60_000;
function clientIp(req) { return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(); }
function joinKeys(req, userId) { const ip = clientIp(req); return ip ? [`u:${userId}`, `i:${ip}`] : [`u:${userId}`]; }
function joinBlocked(keys) { const now = Date.now(); return keys.some(k => { const f = tries.get(k); return f && now - f.first < WINDOW_MS && f.n >= MAX_TRIES; }); }
function noteTry(keys) {
  const now = Date.now();
  if (tries.size > 5000) for (const [k, f] of tries) if (now - f.first >= WINDOW_MS) tries.delete(k);
  for (const k of keys) { const f = tries.get(k); if (!f || now - f.first >= WINDOW_MS) tries.set(k, { n: 1, first: now }); else f.n++; }
}
export function _resetJoinLimits() { tries.clear(); }

async function describe(db, userId) {
  const m = (await db.query('SELECT household_id FROM household_members WHERE user_id = $1', [userId])).rows[0];
  if (!m) return null;
  const hh = (await db.query('SELECT id, name, invite_code FROM households WHERE id = $1', [m.household_id])).rows[0];
  if (!hh) return null;
  const members = (await db.query(
    `SELECT u.id, u.email, hm.role FROM household_members hm JOIN users u ON u.id = hm.user_id WHERE hm.household_id = $1 ORDER BY hm.joined_at, u.email`, [hh.id])).rows;
  return { id: hh.id, name: hh.name, inviteCode: hh.invite_code, members: members.map(r => ({ email: r.email, role: r.role, me: r.id === userId })) };
}

async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

/** Mitgliedschaft des Nutzers, Haushaltszeile sperren. */
async function lockedMembership(client, userId) {
  const m = (await client.query('SELECT household_id, role FROM household_members WHERE user_id = $1', [userId])).rows[0];
  if (!m) throw err(400, 'Du bist in keinem Haushalt.');
  await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [m.household_id]);
  return m;
}

async function uniqueCode(db) {
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    if (!(await db.query('SELECT 1 FROM households WHERE invite_code = $1', [code])).rows.length) return code;
  }
  throw err(500, 'Serverfehler – bitte später erneut versuchen.');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!dbConfigured()) return send(res, 503, { error: 'Gemeinsamer Garten ist auf diesem Server nicht eingerichtet (DATABASE_URL fehlt).' });

  let body = {};
  if (req.method === 'POST') { try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); } }

  try {
    await ensureSchema();
    const me = await authenticate(req);
    if (!me) return send(res, 401, { error: 'Nicht angemeldet' });
    const pool = getPool();
    if (req.method === 'GET') return send(res, 200, { household: await describe(pool, me.id) });

    const action = String(body.action || '');

    if (action === 'create') {
      const name = cleanName(body.name) || 'Unser Garten';
      await withTx(async client => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [me.id]);   // verhindert doppeltes Anlegen
        if ((await client.query('SELECT 1 FROM household_members WHERE user_id = $1', [me.id])).rows.length) throw err(409, 'Du bist bereits in einem Haushalt.');
        const id = HOUSEHOLD_PREFIX + crypto.randomBytes(12).toString('hex');
        await client.query('INSERT INTO households (id, name, invite_code, created_by) VALUES ($1,$2,$3,$4)', [id, name, await uniqueCode(client), me.id]);
        await client.query(`INSERT INTO household_members (user_id, household_id, role) VALUES ($1,$2,'owner')`, [me.id, id]);
      });
    } else if (action === 'join') {
      const keys = joinKeys(req, me.id);
      if (joinBlocked(keys)) return send(res, 429, { error: 'Zu viele Versuche. Bitte versuche es in einigen Minuten erneut.' });
      const code = String(body.code || '').trim().toUpperCase().replace(/[\s-]/g, '');
      if ((await pool.query('SELECT 1 FROM household_members WHERE user_id = $1', [me.id])).rows.length) return send(res, 409, { error: 'Du bist bereits in einem Haushalt. Verlasse ihn zuerst.' });
      const hh = code.length === CODE_LEN ? (await pool.query('SELECT id FROM households WHERE invite_code = $1', [code])).rows[0] : null;
      if (!hh) { noteTry(keys); return send(res, 404, { error: 'Einladungscode nicht gefunden.' }); }
      await withTx(async client => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [me.id]);   // Reihenfolge Nutzer → Haushalt (wie leave)
        await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [hh.id]);
        if ((await client.query('SELECT 1 FROM household_members WHERE user_id = $1', [me.id])).rows.length) throw err(409, 'Du bist bereits in einem Haushalt. Verlasse ihn zuerst.');
        if (!(await client.query('SELECT 1 FROM households WHERE id = $1', [hh.id])).rows.length) throw err(404, 'Einladungscode nicht gefunden.');
        const n = Number((await client.query('SELECT count(*) AS n FROM household_members WHERE household_id = $1', [hh.id])).rows[0].n);
        if (n >= MAX_MEMBERS) throw err(409, `Dieser Haushalt ist voll (max. ${MAX_MEMBERS} Mitglieder).`);
        await client.query(`INSERT INTO household_members (user_id, household_id, role) VALUES ($1,$2,'member')`, [me.id, hh.id]);
      });
      for (const k of keys) tries.delete(k);
    } else if (action === 'leave') {
      await withTx(async client => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [me.id]);
        if (!(await leaveHouseholdTx(client, me.id))) throw err(400, 'Du bist in keinem Haushalt.');
      });
      return send(res, 200, { household: null });
    } else if (action === 'rename') {
      const name = cleanName(body.name);
      if (!name) return send(res, 400, { error: 'Bitte gib einen Namen ein.' });
      await withTx(async client => {
        const m = await lockedMembership(client, me.id);
        await client.query('UPDATE households SET name = $1 WHERE id = $2', [name, m.household_id]);
      });
    } else if (action === 'regenerate_code') {
      await withTx(async client => {
        const m = await lockedMembership(client, me.id);
        if (m.role !== 'owner') throw err(403, 'Nur der Besitzer kann den Einladungscode erneuern.');
        await client.query('UPDATE households SET invite_code = $1 WHERE id = $2', [await uniqueCode(client), m.household_id]);
      });
    } else if (action === 'remove_member') {
      const email = normalizeEmail(body.email);
      await withTx(async client => {
        const m = await lockedMembership(client, me.id);
        if (m.role !== 'owner') throw err(403, 'Nur der Besitzer kann Mitglieder entfernen.');
        const t = (await client.query(
          `SELECT u.id FROM household_members hm JOIN users u ON u.id = hm.user_id WHERE hm.household_id = $1 AND u.email = $2`, [m.household_id, email])).rows[0];
        if (!t) throw err(404, 'Mitglied nicht gefunden.');
        if (t.id === me.id) throw err(400, 'Du kannst dich nicht selbst entfernen – nutze „Haushalt verlassen“.');
        await client.query('DELETE FROM household_members WHERE user_id = $1', [t.id]);
      });
    } else {
      return send(res, 400, { error: 'Unbekannte Aktion' });
    }
    return send(res, 200, { household: await describe(pool, me.id) });
  } catch (e) {
    if (e.status && e.status < 500) return send(res, e.status, { error: e.message });
    console.error('household.js', e.message);
    return send(res, 500, { error: 'Serverfehler – bitte später erneut versuchen.' });
  }
}
