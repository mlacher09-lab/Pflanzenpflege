// Auswertung der gesammelten Ereignisse. Nur mit ADMIN_TOKEN (Header x-admin-token) abrufbar.
import { dbConfigured, getPool, ensureSchema } from '../lib/db.js';

function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!process.env.ADMIN_TOKEN) return send(res, 503, { error: 'ADMIN_TOKEN ist auf dem Server nicht gesetzt' });
  if (req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) return send(res, 401, { error: 'Kein Zugriff' });
  if (!dbConfigured()) return send(res, 503, { error: 'DATABASE_URL fehlt' });

  const days = Math.min(365, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 30));
  const since = `now() - interval '${days} days'`;
  const q = (sql, params = []) => getPool().query(sql, params).then(r => r.rows);
  try {
    await ensureSchema();
    const [totals, daily, byType, plantsAdded, plantsAll, scans, scanOutcomes, finder, finderLight, finderRooms, wishes, platforms, versions, care] = await Promise.all([
      q(`SELECT count(*)::int AS events, count(DISTINCT client_id)::int AS clients,
                count(DISTINCT client_id) FILTER (WHERE ts > now() - interval '7 days')::int AS clients_7d,
                count(DISTINCT client_id) FILTER (WHERE ts > now() - interval '1 day')::int AS clients_1d,
                min(ts) AS first_event
           FROM events WHERE ts > ${since}`),
      q(`SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, count(DISTINCT client_id)::int AS clients, count(*)::int AS events
           FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY 1`),
      q(`SELECT type, count(*)::int AS n, count(DISTINCT client_id)::int AS clients FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT props->>'plant' AS plant, count(*)::int AS n FROM events WHERE type = 'plant_added' AND ts > ${since} AND props ? 'plant' GROUP BY 1 ORDER BY 2 DESC LIMIT 25`),
      q(`SELECT props->>'plant' AS plant, count(*)::int AS n FROM events WHERE type = 'plant_added' AND props ? 'plant' GROUP BY 1 ORDER BY 2 DESC LIMIT 25`),
      q(`SELECT props->>'plant' AS plant, count(*)::int AS n, round(avg((props->>'confidence')::numeric), 2) AS confidence
           FROM events WHERE type = 'scan' AND props->>'result' = 'ok' AND ts > ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`),
      q(`SELECT props->>'result' AS result, count(*)::int AS n FROM events WHERE type = 'scan' AND ts > ${since} GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT count(*)::int AS searches,
                round(100.0 * count(*) FILTER (WHERE (props->>'pet')::boolean) / NULLIF(count(*), 0))::int AS pet_pct,
                round(100.0 * count(*) FILTER (WHERE (props->>'trend')::boolean) / NULLIF(count(*), 0))::int AS trend_pct,
                round(100.0 * count(*) FILTER (WHERE (props->>'flower')::boolean) / NULLIF(count(*), 0))::int AS flower_pct,
                round(100.0 * count(*) FILTER (WHERE (props->>'air')::boolean) / NULLIF(count(*), 0))::int AS air_pct
           FROM events WHERE type = 'finder_search' AND ts > ${since}`),
      q(`SELECT props->>'light' AS light, props->>'hum' AS hum, count(*)::int AS n FROM events WHERE type = 'finder_search' AND ts > ${since} GROUP BY 1, 2 ORDER BY 3 DESC`),
      q(`SELECT coalesce(nullif(props->>'room', ''), '– frei –') AS room, count(*)::int AS n FROM events WHERE type = 'finder_search' AND ts > ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      q(`SELECT props->>'plant' AS plant, count(*)::int AS n, count(*) FILTER (WHERE type = 'wish_bought')::int AS bought
           FROM events WHERE type IN ('wish_added', 'wish_bought') AND ts > ${since} AND props ? 'plant' GROUP BY 1 ORDER BY 2 DESC LIMIT 25`),
      q(`SELECT platform, count(DISTINCT client_id)::int AS clients FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT app_version, count(DISTINCT client_id)::int AS clients FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT props->>'kind' AS kind, count(*)::int AS n FROM events WHERE type = 'care' AND ts > ${since} GROUP BY 1`),
    ]);
    return send(res, 200, { ok: true, days, generatedAt: new Date().toISOString(), totals: totals[0], daily, byType, plantsAdded, plantsAll, scans, scanOutcomes, finder: finder[0], finderLight, finderRooms, wishes, platforms, versions, care });
  } catch (e) {
    console.error('stats.js', e.message);
    return send(res, 500, { error: 'Auswertung fehlgeschlagen' });
  }
}
