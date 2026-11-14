// Löscht Statistik-Ereignisse, die älter als 24 Monate sind. Wird täglich von Vercel Cron aufgerufen (siehe vercel.json).
// Vercel sendet dabei automatisch "Authorization: Bearer <CRON_SECRET>"; ohne gesetztes CRON_SECRET wird nichts gelöscht.
import { dbConfigured, getPool, ensureSchema } from '../lib/db.js';

function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!process.env.CRON_SECRET) return send(res, 503, { error: 'CRON_SECRET ist auf dem Server nicht gesetzt' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: 'Kein Zugriff' });
  if (!dbConfigured()) return send(res, 503, { error: 'DATABASE_URL fehlt' });
  try {
    await ensureSchema();
    const r = await getPool().query(`DELETE FROM events WHERE ts < now() - interval '24 months'`);
    return send(res, 200, { ok: true, deleted: r.rowCount });
  } catch (e) {
    console.error('cleanup.js', e.message);
    return send(res, 500, { error: 'Löschen fehlgeschlagen' });
  }
}
