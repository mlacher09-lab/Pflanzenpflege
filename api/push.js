// Web-Push-Abos: GET → { configured, publicKey }; POST { action: subscribe|prefs|unsubscribe|test } (nur angemeldet).
import { dbConfigured, getPool } from '../lib/db.js';
import { setCors, send, readBody, authenticate } from '../lib/auth.js';
import { ensurePushSchema, vapidConfigured, vapidPublicKey, cleanPrefs, sendNotification } from '../lib/push.js';

// Nur Endpunkte bekannter Push-Dienste annehmen – sonst könnte der Server beliebige URLs aufrufen (SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export const validEndpoint = e => {
  if (typeof e !== 'string' || e.length > 1000) return false;
  try { const u = new URL(e); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(rx => rx.test(u.hostname)); } catch { return false; }
};

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') return send(res, 200, { configured: vapidConfigured() && dbConfigured(), publicKey: vapidConfigured() ? vapidPublicKey() : null });
  if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!dbConfigured()) return send(res, 503, { error: 'Push nicht eingerichtet (DATABASE_URL fehlt).' });
  if (!vapidConfigured()) return send(res, 503, { error: 'Push nicht eingerichtet (VAPID-Schlüssel fehlen).' });
  let body;
  try { body = await readBody(req, 10_000); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  try {
    const me = await authenticate(req);
    if (!me) return send(res, 401, { error: 'Nicht angemeldet' });
    await ensurePushSchema();
    const pool = getPool();
    const { action } = body;
    if (action === 'subscribe') {
      const s = body.subscription || {};
      if (!validEndpoint(s.endpoint) || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return send(res, 400, { error: 'Ungültiges Abo' });
      const tz = typeof body.tz === 'string' ? body.tz.slice(0, 64) : null;
      const prefs = JSON.stringify(cleanPrefs(body.prefs));
      const keys = JSON.stringify({ p256dh: s.keys.p256dh, auth: s.keys.auth });
      const cur = await pool.query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
      if (cur.rows.length) await pool.query('UPDATE push_subscriptions SET user_id = $2, keys = $3, prefs = $4, tz = $5 WHERE endpoint = $1', [s.endpoint, me.id, keys, prefs, tz]);
      else await pool.query('INSERT INTO push_subscriptions (endpoint, user_id, keys, prefs, tz) VALUES ($1,$2,$3,$4,$5)', [s.endpoint, me.id, keys, prefs, tz]);
      return send(res, 200, { ok: true });
    }
    if (!validEndpoint(body.endpoint)) return send(res, 400, { error: 'Ungültiges Abo' });
    const own = await pool.query('SELECT endpoint, keys FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [body.endpoint, me.id]);
    if (action === 'unsubscribe') {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [body.endpoint, me.id]);
      return send(res, 200, { ok: true });
    }
    if (!own.rows.length) return send(res, 404, { error: 'Abo nicht gefunden' });
    if (action === 'prefs') {
      await pool.query('UPDATE push_subscriptions SET prefs = $2 WHERE endpoint = $1', [body.endpoint, JSON.stringify(cleanPrefs(body.prefs))]);
      return send(res, 200, { ok: true });
    }
    if (action === 'test') {
      try {
        await sendNotification({ endpoint: body.endpoint, keys: own.rows[0].keys }, { title: 'Pflanzenpflege', body: '🌿 Test erfolgreich – so sehen deine Erinnerungen aus.', tag: 'care-test', url: '/' });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [body.endpoint]);
          return send(res, 410, { error: 'Abo abgelaufen – bitte Push neu aktivieren.' });
        }
        return send(res, 502, { error: 'Senden fehlgeschlagen' });
      }
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'Unbekannte Aktion' });
  } catch (e) {
    console.error('push.js', e.message);
    return send(res, 500, { error: 'Push fehlgeschlagen' });
  }
}
