// Konten: Registrierung, Anmeldung, Abmeldung, Passwort ändern, Konto löschen.
// POST { action: 'register'|'login'|'logout'|'delete'|'change_password', ... }   GET → { configured, user }
import crypto from 'node:crypto';
import { dbConfigured, getPool, ensureSchema } from '../lib/db.js';
import { leaveHouseholdTx } from '../lib/space.js';
import { setCors, send, readBody, normalizeEmail, validEmail, passwordError, hashPassword, verifyPassword, fakeVerify, createSession, authenticate } from '../lib/auth.js';

// Brute-Force-Bremse: feste Verzögerung bei Fehlversuchen + Zähler pro E-Mail/IP (nur pro Instanz im Speicher).
const fails = new Map();
const MAX_FAILS = 10, WINDOW_MS = 15 * 60_000;
const failDelay = () => new Promise(r => setTimeout(r, Number(process.env.AUTH_FAIL_DELAY_MS ?? 700)));
function clientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}
function failKeys(req, email) {
  const ip = clientIp(req);
  return ip ? [`e:${email}`, `i:${ip}`] : [`e:${email}`];
}
function blocked(keys) {
  const now = Date.now();
  return keys.some(k => { const f = fails.get(k); return f && now - f.first < WINDOW_MS && f.n >= MAX_FAILS; });
}
function noteFail(keys) {
  const now = Date.now();
  if (fails.size > 5000) for (const [k, f] of fails) if (now - f.first >= WINDOW_MS) fails.delete(k);
  for (const k of keys) { const f = fails.get(k); if (!f || now - f.first >= WINDOW_MS) fails.set(k, { n: 1, first: now }); else f.n++; }
}

// Registrierungs-Bremse: max. 5 Registrierungen (auch versuchte) pro IP im gleichen Zeitfenster.
const regs = new Map();
const MAX_REGS = 5;
function regLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  if (regs.size > 5000) for (const [k, f] of regs) if (now - f.first >= WINDOW_MS) regs.delete(k);
  const f = regs.get(ip);
  if (!f || now - f.first >= WINDOW_MS) { regs.set(ip, { n: 1, first: now }); return false; }
  f.n++;
  return f.n > MAX_REGS;
}
export function _resetFails() { fails.clear(); regs.clear(); }

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') {
    if (!dbConfigured()) return send(res, 200, { configured: false, user: null });
    try {
      const u = await authenticate(req);
      return send(res, 200, { configured: true, user: u ? { email: u.email } : null });
    } catch (e) { console.error('auth GET', e.message); return send(res, 500, { error: 'Serverfehler' }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!dbConfigured()) return send(res, 503, { error: 'Konten sind auf diesem Server nicht eingerichtet (DATABASE_URL fehlt).' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  const action = String(body.action || '');

  try {
    await ensureSchema();
    const pool = getPool();

    if (action === 'register') {
      if (regLimited(clientIp(req))) return send(res, 429, { error: 'Zu viele Registrierungen. Bitte versuche es später erneut.' });
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return send(res, 400, { error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
      const pe = passwordError(body.password);
      if (pe) return send(res, 400, { error: pe });
      const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (exists.rows.length) return send(res, 409, { error: 'Diese E-Mail-Adresse ist bereits registriert.' });
      const id = crypto.randomUUID();
      try {
        await pool.query('INSERT INTO users (id, email, pw_hash) VALUES ($1,$2,$3)', [id, email, await hashPassword(body.password)]);
      } catch (e) {
        if (/unique|duplicate/i.test(e.message)) return send(res, 409, { error: 'Diese E-Mail-Adresse ist bereits registriert.' });
        throw e;
      }
      return send(res, 200, { token: await createSession(id), user: { email } });
    }

    if (action === 'login') {
      const email = normalizeEmail(body.email);
      const keys = failKeys(req, email);
      if (blocked(keys)) return send(res, 429, { error: 'Zu viele Fehlversuche. Bitte versuche es in einigen Minuten erneut.' });
      const { rows } = await pool.query('SELECT id, pw_hash FROM users WHERE email = $1', [email]);
      const user = rows[0];
      const pw = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      const ok = user ? await verifyPassword(pw, user.pw_hash) : (await fakeVerify(pw), false);
      if (!ok) { noteFail(keys); await failDelay(); return send(res, 401, { error: 'E-Mail oder Passwort falsch' }); }
      for (const k of keys) fails.delete(k);
      await pool.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < $2', [user.id, new Date()]);
      return send(res, 200, { token: await createSession(user.id), user: { email } });
    }

    // Alle weiteren Aktionen brauchen eine gültige Sitzung.
    const me = await authenticate(req);
    if (!me) return send(res, 401, { error: 'Nicht angemeldet' });

    if (action === 'logout') {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [me.tokenHash]);
      // Push-Abo dieses Geräts lösen, damit Erinnerungen nicht beim nächsten Nutzer des Geräts landen
      if (typeof body.endpoint === 'string' && body.endpoint) {
        try { const { deleteSubscription } = await import('../lib/push.js'); await deleteSubscription(me.id, body.endpoint); }
        catch (e) { console.error('push logout', e.message); }
      }
      return send(res, 200, { ok: true });
    }

    if (action === 'delete' || action === 'change_password') {
      const pwField = action === 'delete' ? body.password : body.oldPassword;
      const keys = failKeys(req, me.email);
      if (blocked(keys)) return send(res, 429, { error: 'Zu viele Fehlversuche. Bitte versuche es in einigen Minuten erneut.' });
      const { rows } = await pool.query('SELECT pw_hash FROM users WHERE id = $1', [me.id]);
      if (!rows[0] || !(await verifyPassword(typeof pwField === 'string' ? pwField.slice(0, 200) : '', rows[0].pw_hash))) {
        noteFail(keys); await failDelay(); return send(res, 403, { error: 'Das Passwort ist falsch.' });
      }
      if (action === 'delete') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await leaveHouseholdTx(client, me.id);
          await client.query('DELETE FROM items WHERE user_id = $1', [me.id]);
          await client.query('DELETE FROM sessions WHERE user_id = $1', [me.id]);
          await client.query('DELETE FROM users WHERE id = $1', [me.id]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
        // Push-Abos des Nutzers entfernen (eigene Tabelle; Fehler hier dürfen die Löschung nicht scheitern lassen)
        try { const { deleteSubscriptionsForUser } = await import('../lib/push.js'); await deleteSubscriptionsForUser(me.id); }
        catch (e) { console.error('push cleanup', e.message); }
        return send(res, 200, { ok: true });
      }
      const pe = passwordError(body.newPassword);
      if (pe) return send(res, 400, { error: pe });
      await pool.query('UPDATE users SET pw_hash = $1 WHERE id = $2', [await hashPassword(body.newPassword), me.id]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [me.id, me.tokenHash]);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error('auth.js', e.message);
    return send(res, 500, { error: 'Serverfehler – bitte später erneut versuchen.' });
  }
}
