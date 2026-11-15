// Synchronisation: POST { since, changes: [{ store, id, data|null, updatedAt, deleted }] }
// → { changes: [...], cursor, more }.  Last-write-wins pro Eintrag (updatedAt des Clients);
// der Cursor basiert auf einer serverseitigen Sequenz (seq), damit Uhren-Unterschiede zwischen Geräten nichts verlieren.
import { dbConfigured, getPool, ensureSchema } from '../lib/db.js';
import { spaceOf, lockSpace } from '../lib/space.js';
import { setCors, send, readBody, authenticate } from '../lib/auth.js';

const MAX_BODY = 4 * 1024 * 1024;
const MAX_CHANGES = 500;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const STORES = new Set(['plants', 'wishlist', 'settings']);
// Gerätespezifisch bzw. geheim – wird nie synchronisiert (Spiegel in js/store.js).
const NO_SYNC = new Set(['apiBase', 'appToken', 'authToken', 'syncCursor', 'pendingChanges', 'clientId', 'analytics', 'analyticsConsent', 'lastNotify', 'installDismissed']);
export function syncable(store, id) {
  return STORES.has(store) && typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.startsWith('local:') && !(store === 'settings' && NO_SYNC.has(id));
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
  if (!dbConfigured()) return send(res, 503, { error: 'Synchronisation nicht eingerichtet (DATABASE_URL fehlt).' });

  let body;
  try { body = await readBody(req, MAX_BODY); } catch (e) { return send(res, e.status || 400, { error: e.message }); }

  let client;
  try {
    const me = await authenticate(req);
    if (!me) return send(res, 401, { error: 'Nicht angemeldet' });
    await ensureSchema();
    const since = Number.isFinite(Number(body.since)) ? Number(body.since) : 0;
    const incoming = (Array.isArray(body.changes) ? body.changes : []).slice(0, MAX_CHANGES);

    client = await getPool().connect();
    await client.query('BEGIN');
    // pro Datenraum serialisieren, damit die seq-Reihenfolge zum Commit passt
    const space = await spaceOf(me.id, client);   // eigener Garten oder gemeinsamer Haushaltsgarten
    await lockSpace(client, space);
    const mine = new Set(), rejected = [];
    for (const c of incoming) {
      if (!c || !syncable(c.store, c.id)) continue;
      const updatedAt = Math.round(Number(c.updatedAt));
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
      const deleted = !!c.deleted;
      if (!deleted && (!c.data || typeof c.data !== 'object' || Array.isArray(c.data))) continue;
      const cur = await client.query('SELECT data, updated_at, deleted FROM items WHERE user_id = $1 AND store = $2 AND id = $3', [space, c.store, c.id]);
      if (cur.rows.length && Number(cur.rows[0].updated_at) >= updatedAt) { // Server ist neuer oder gleich: Client bekommt den Serverstand
        const r = cur.rows[0];
        if (Number(r.updated_at) > updatedAt) rejected.push({ store: c.store, id: c.id, data: r.deleted ? null : r.data, updatedAt: Number(r.updated_at), deleted: !!r.deleted });
        continue;
      }
      const data = deleted ? null : JSON.stringify(c.data);
      if (cur.rows.length) {
        await client.query(`UPDATE items SET data = $4, updated_at = $5, deleted = $6, seq = nextval('items_seq') WHERE user_id = $1 AND store = $2 AND id = $3`,
          [space, c.store, c.id, data, updatedAt, deleted]);
      } else {
        await client.query(`INSERT INTO items (user_id, store, id, data, updated_at, deleted, seq) VALUES ($1,$2,$3,$4,$5,$6,nextval('items_seq'))`,
          [space, c.store, c.id, data, updatedAt, deleted]);
      }
      mine.add(c.store + '\u0000' + c.id);
    }
    // Seq der gerade geschriebenen Zeilen, um sie nicht zurückzusenden (Cursor springt trotzdem darüber)
    const { rows } = await client.query(
      'SELECT store, id, data, updated_at, deleted, seq FROM items WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT 300', [space, since]);
    await client.query('COMMIT');

    const changes = [];
    let cursor = since, size = 0, more = rows.length === 300;
    for (const r of rows) {
      const item = { store: r.store, id: r.id, data: r.deleted ? null : r.data, updatedAt: Number(r.updated_at), deleted: !!r.deleted };
      const own = mine.has(r.store + '\u0000' + r.id);
      if (!own) {
        const len = JSON.stringify(item).length;
        if (changes.length && size + len > MAX_RESPONSE_BYTES) { more = true; break; }
        size += len; changes.push(item);
      }
      cursor = Number(r.seq);
    }
    // Abgelehnte (veraltete) Änderungen: Serverstand immer mitsenden, auch wenn der Cursor schon daran vorbei ist
    const have = new Set(changes.map(c => c.store + '\u0000' + c.id));
    for (const r of rejected) if (!have.has(r.store + '\u0000' + r.id)) changes.push(r);
    return send(res, 200, { changes, cursor, more });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('sync.js', e.message);
    return send(res, 500, { error: 'Synchronisation fehlgeschlagen' });
  } finally {
    client?.release();
  }
}
