// Täglicher Push-Versand (Vercel Cron, siehe vercel.json). Geschützt wie api/cleanup.js über CRON_SECRET.
import { dbConfigured } from '../lib/db.js';
import { send } from '../lib/auth.js';
import { vapidConfigured, runCron } from '../lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!process.env.CRON_SECRET) return send(res, 503, { error: 'CRON_SECRET ist auf dem Server nicht gesetzt' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: 'Kein Zugriff' });
  if (!dbConfigured()) return send(res, 503, { error: 'DATABASE_URL fehlt' });
  if (!vapidConfigured()) return send(res, 503, { error: 'VAPID-Schlüssel fehlen' });
  try { return send(res, 200, { ok: true, ...(await runCron()) }); }
  catch (e) { console.error('push-cron.js', e.message); return send(res, 500, { error: 'Versand fehlgeschlagen' }); }
}
