// Test der Konten- und Sync-API ohne echte Datenbank: node test/accounts.test.mjs
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

process.env.DATABASE_URL = 'postgres://test/test';
process.env.AUTH_FAIL_DELAY_MS = '0';
const { setPool } = await import('../lib/db.js');
const { Pool } = newDb().adapters.createPg();
setPool(new Pool());
const { default: auth, _resetFails } = await import('../api/auth.js');
const cleanup = (await import('../api/cleanup.js')).default;
const { getPool } = await import('../lib/db.js');
const sync = (await import('../api/sync.js')).default;

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.stack); process.exitCode = 1; } }

async function call(handler, method, body, token, extraHeaders = {}) {
  const headers = { ...extraHeaders }; if (token) headers.authorization = 'Bearer ' + token;
  const req = { method, headers, body };
  let out = { headers: {} };
  const res = { statusCode: 200, setHeader(k, v) { out.headers[k] = v; }, end(s) { out.body = s ? JSON.parse(s) : null; } };
  await handler(req, res);
  return { status: res.statusCode, ...out };
}
const post = (b, t, h) => call(auth, 'POST', b, t, h);
const push = (token, since, changes) => call(sync, 'POST', { since, changes }, token);

const plant = (id, name, at) => ({ store: 'plants', id, data: { id, name, updatedAt: at }, updatedAt: at, deleted: false });

console.log('Konten');
let tokA, tokA2;
await test('GET meldet configured, ohne Token user=null', async () => {
  const r = await call(auth, 'GET');
  assert.equal(r.status, 200); assert.equal(r.body.configured, true); assert.equal(r.body.user, null);
});
await test('Registrierung validiert E-Mail und Passwort', async () => {
  assert.equal((await post({ action: 'register', email: 'kaputt', password: 'passwort123' })).status, 400);
  assert.equal((await post({ action: 'register', email: 'a@b.de', password: 'kurz' })).status, 400);
});
await test('Registrierung klappt, E-Mail wird kleingeschrieben', async () => {
  const r = await post({ action: 'register', email: ' Anna@Example.DE ', password: 'geheim1234' });
  assert.equal(r.status, 200); assert.equal(r.body.user.email, 'anna@example.de'); assert.ok(r.body.token.length >= 40);
  tokA = r.body.token;
  const g = await call(auth, 'GET', undefined, tokA);
  assert.equal(g.body.user.email, 'anna@example.de');
});
await test('doppelte Registrierung -> 409', async () => {
  const r = await post({ action: 'register', email: 'ANNA@example.de', password: 'anderes1234' });
  assert.equal(r.status, 409);
});
await test('falsches Passwort / unbekannter Nutzer -> gleiche generische Meldung', async () => {
  const a = await post({ action: 'login', email: 'anna@example.de', password: 'falsch12345' });
  const b = await post({ action: 'login', email: 'niemand@example.de', password: 'falsch12345' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.body.error, 'E-Mail oder Passwort falsch'); assert.equal(b.body.error, a.body.error);
});
await test('Login klappt (zweites Gerät)', async () => {
  const r = await post({ action: 'login', email: 'Anna@example.de', password: 'geheim1234' });
  assert.equal(r.status, 200); tokA2 = r.body.token; assert.notEqual(tokA2, tokA);
});
await test('Brute-Force-Sperre nach vielen Fehlversuchen', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await post({ action: 'login', email: 'opfer@example.de', password: 'x' + i }, null, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(last.status, 429);
});
await test('Registrierungs-Bremse pro IP', async () => {
  _resetFails();
  const h = { 'x-forwarded-for': '198.51.100.7' };
  let last;
  for (let i = 0; i < 6; i++) last = await post({ action: 'register', email: `bremse${i}@example.de`, password: 'geheim1234' }, null, h);
  assert.equal(last.status, 429);
  _resetFails();
});

console.log('Synchronisation');
let curA = 0, curB = 0;
await test('ohne Token -> 401', async () => { assert.equal((await push(null, 0, [])).status, 401); });
await test('Gerät 1 pusht, Gerät 2 zieht', async () => {
  const r1 = await push(tokA, 0, [plant('p1', 'Monstera', 1000), plant('p2', 'Ficus', 1000),
    { store: 'settings', id: 'theme', data: { id: 'theme', value: 'dark', updatedAt: 1000 }, updatedAt: 1000, deleted: false },
    { store: 'settings', id: 'authToken', data: { id: 'authToken', value: 'geheim' }, updatedAt: 1000, deleted: false },
    { store: 'plants', id: 'local:x', data: { id: 'local:x' }, updatedAt: 1000, deleted: false }]);
  assert.equal(r1.status, 200); assert.equal(r1.body.changes.length, 0, 'eigene Änderungen kommen nicht zurück'); curA = r1.body.cursor;
  assert.ok(curA > 0);
  const r2 = await push(tokA2, 0, []);
  const ids = r2.body.changes.map(c => c.store + '/' + c.id).sort();
  assert.deepEqual(ids, ['plants/p1', 'plants/p2', 'settings/theme']);
  assert.equal(r2.body.changes.find(c => c.id === 'p1').data.name, 'Monstera'); curB = r2.body.cursor;
  const again = await push(tokA2, curB, []);
  assert.equal(again.body.changes.length, 0); assert.equal(again.body.cursor, curB);
});
await test('Last-write-wins: neuere Änderung gewinnt, ältere wird abgelehnt und korrigiert', async () => {
  curA = (await push(tokA, curA, [plant('p1', 'Monstera deliciosa', 2000)])).body.cursor; // Gerät 1 neuer
  const late = await push(tokA2, curB, [plant('p1', 'Alt-Stand', 1500)]);      // Gerät 2 älter
  assert.equal(late.body.changes.length, 1, 'Server schickt den neueren Stand zurück');
  assert.equal(late.body.changes[0].data.name, 'Monstera deliciosa'); curB = late.body.cursor;
  const r = await push(tokA, curA, []); curA = r.body.cursor;
  assert.equal(r.body.changes.length, 0, 'abgelehnte Änderung hat nichts überschrieben');
  const upd = await push(tokA2, curB, [plant('p1', 'Neuer als alles', 3000)]); curB = upd.body.cursor;
  const g1 = await push(tokA, curA, []); curA = g1.body.cursor;
  assert.equal(g1.body.changes[0].data.name, 'Neuer als alles');
});
await test('Löschen als Tombstone wird übertragen', async () => {
  const d = await push(tokA, curA, [{ store: 'plants', id: 'p2', data: null, updatedAt: 4000, deleted: true }]); curA = d.body.cursor;
  const r = await push(tokA2, curB, []); curB = r.body.cursor;
  const t = r.body.changes.find(c => c.id === 'p2');
  assert.ok(t && t.deleted === true && t.data === null);
  // ältere Wiederbelebung wird abgelehnt
  const rev = await push(tokA2, curB, [plant('p2', 'Zombie', 3500)]);
  assert.equal(rev.body.changes[0].deleted, true);
});
await test('Daten verschiedener Nutzer sind getrennt', async () => {
  const b = await post({ action: 'register', email: 'ben@example.de', password: 'geheim1234' });
  const r = await push(b.body.token, 0, []);
  assert.equal(r.body.changes.length, 0);
});
await test('zu große Anfrage -> 413', async () => {
  const r = await call(sync, 'POST', { since: 0, changes: [] }, tokA, { 'content-length': String(5 * 1024 * 1024) });
  assert.equal(r.status, 413);
});
await test('Antwort wird bei großen Fotos seitenweise geliefert (more)', async () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(900_000);
  const ch = [1, 2, 3, 4, 5].map(i => ({ store: 'wishlist', id: 'w' + i, data: { id: 'w' + i, photo: big }, updatedAt: 5000 + i, deleted: false }));
  assert.equal((await push(tokA, curA, ch.slice(0, 3))).status, 200);
  assert.equal((await push(tokA, curA, ch.slice(3))).status, 200);
  let cur = 0, got = 0, rounds = 0, more = true;
  while (more) { const r = await push(tokA2, cur, []); got += r.body.changes.filter(c => c.store === 'wishlist').length; cur = r.body.cursor; more = r.body.more; rounds++; assert.ok(rounds < 10); }
  assert.equal(got, 5); assert.ok(rounds > 1);
});

console.log('Konto verwalten');
await test('Passwort ändern: alte Sitzungen anderer Geräte enden', async () => {
  assert.equal((await post({ action: 'change_password', oldPassword: 'falsch', newPassword: 'neuespasswort1' }, tokA)).status, 403);
  assert.equal((await post({ action: 'change_password', oldPassword: 'geheim1234', newPassword: 'kurz' }, tokA)).status, 400);
  assert.equal((await post({ action: 'change_password', oldPassword: 'geheim1234', newPassword: 'neuespasswort1' }, tokA)).status, 200);
  assert.equal((await push(tokA2, 0, [])).status, 401);
  assert.equal((await post({ action: 'login', email: 'anna@example.de', password: 'geheim1234' })).status, 401);
  const l = await post({ action: 'login', email: 'anna@example.de', password: 'neuespasswort1' }); assert.equal(l.status, 200); tokA2 = l.body.token;
});
await test('Abmelden macht Token ungültig', async () => {
  assert.equal((await post({ action: 'logout' }, tokA2)).status, 200);
  assert.equal((await push(tokA2, 0, [])).status, 401);
});
await test('Konto löschen braucht Passwort und entfernt alles', async () => {
  assert.equal((await post({ action: 'delete', password: 'falsch' }, tokA)).status, 403);
  assert.equal((await post({ action: 'delete', password: 'neuespasswort1' }, tokA)).status, 200);
  assert.equal((await push(tokA, 0, [])).status, 401);
  assert.equal((await post({ action: 'login', email: 'anna@example.de', password: 'neuespasswort1' })).status, 401);
  const re = await post({ action: 'register', email: 'anna@example.de', password: 'geheim1234' });
  assert.equal(re.status, 200);
  assert.equal((await push(re.body.token, 0, [])).body.changes.length, 0, 'keine Altdaten übrig');
});
await test('Cleanup löscht abgelaufene Sitzungen', async () => {
  process.env.CRON_SECRET = 't';
  const pool = getPool();
  const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
  await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`, ['abgelaufen', rows[0].id, new Date(Date.now() - 86400_000)]);
  const r = await call(cleanup, 'GET', undefined, 'falsch');
  assert.equal(r.status, 401);
  const ok = await call(cleanup, 'GET', undefined, null, { authorization: 'Bearer t' });
  assert.equal(ok.status, 200); assert.ok(ok.body.sessions >= 1);
});
await test('ohne DATABASE_URL -> 503', async () => {
  const saved = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try { assert.equal((await post({ action: 'login', email: 'a@b.de', password: 'x' })).status, 503); assert.equal((await call(auth, 'GET')).body.configured, false); }
  finally { process.env.DATABASE_URL = saved; }
});

console.log(`${passed} Tests bestanden`);
process.exit(process.exitCode || 0);
