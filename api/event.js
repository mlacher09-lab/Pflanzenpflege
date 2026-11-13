// Nimmt anonyme Nutzungsereignisse der App entgegen und schreibt sie in die Datenbank.
// Es werden keine IP-Adressen, Namen oder Fotos gespeichert – nur Ereignistyp, Eigenschaften und eine zufällige Geräte-Kennung.
import { dbConfigured, getPool, ensureSchema } from '../lib/db.js';

const MAX_EVENTS = 50;
const MAX_PROPS_BYTES = 2000;
const TYPE_RE = /^[a-z][a-z0-9_]{1,31}$/;
const ID_RE = /^[a-z0-9]{8,40}$/;
const PLATFORMS = new Set(['ios', 'android', 'desktop', 'other']);

function setCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]));
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}
function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); }
async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 200_000) throw new Error('Anfrage zu groß'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function cleanProps(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return JSON.stringify(out).length > MAX_PROPS_BYTES ? {} : out;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') return send(res, 200, { ok: true, configured: dbConfigured() });
  if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!dbConfigured()) return send(res, 503, { error: 'Statistik nicht konfiguriert (DATABASE_URL fehlt)' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const client = String(body.client || '');
  if (!ID_RE.test(client)) return send(res, 400, { error: 'Ungültige Kennung' });
  const version = String(body.v || '').slice(0, 20);
  const platform = PLATFORMS.has(body.platform) ? body.platform : 'other';
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const rows = events.filter(e => e && TYPE_RE.test(String(e.t || ''))).map(e => {
    const ts = Number(e.ts);
    const when = ts > 0 && Math.abs(Date.now() - ts) < 7 * 86400000 ? new Date(ts) : new Date();
    return [when, client, e.t, cleanProps(e.p), version, platform];
  });
  if (!rows.length) return send(res, 200, { ok: true, stored: 0 });

  try {
    await ensureSchema();
    const values = [], params = [];
    rows.forEach((r, i) => { const b = i * 6; values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`); params.push(...r); });
    await getPool().query(`INSERT INTO events (ts, client_id, type, props, app_version, platform) VALUES ${values.join(',')}`, params);
    return send(res, 200, { ok: true, stored: rows.length });
  } catch (e) {
    console.error('event.js', e.message);
    return send(res, 500, { error: 'Speichern fehlgeschlagen' });
  }
}
