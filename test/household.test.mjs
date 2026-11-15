// Test des gemeinsamen Gartens ohne echte Datenbank: node test/household.test.mjs
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

process.env.DATABASE_URL = 'postgres://test/test';
process.env.AUTH_FAIL_DELAY_MS = '0';
const { setPool, getPool } = await import('../lib/db.js');
const { Pool } = newDb().adapters.createPg();
setPool(new Pool());
const { default: auth } = await import('../api/auth.js');
const { default: sync } = await import('../api/sync.js');
const { default: hh, _resetJoinLimits, MAX_MEMBERS } = await import('../api/household.js');

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.stack); process.exitCode = 1; } }
async function call(handler, method, body, token) {
  const headers = {}; if (token) headers.authorization = 'Bearer ' + token;
  const out = { headers: {} };
  const res = { statusCode: 200, setHeader(k, v) { out.headers[k] = v; }, end(s) { out.body = s ? JSON.parse(s) : null; } };
  await handler({ method, headers, body }, res);
  return { status: res.statusCode, ...out };
}
const act = (token, body) => call(hh, 'POST', body, token);
const info = token => call(hh, 'GET', undefined, token);
const push = (token, since, changes) => call(sync, 'POST', { since, changes }, token);
const plant = (id, name, at) => ({ store: 'plants', id, data: { id, name, updatedAt: at }, updatedAt: at, deleted: false });
async function user(email) {
  const r = await call(auth, 'POST', { action: 'register', email, password: 'geheim1234' });
  assert.equal(r.status, 200); return r.body.token;
}
const names = r => r.body.changes.filter(c => c.store === 'plants').map(c => c.id).sort();

const A = await user('anna@example.de'), B = await user('ben@example.de'), C = await user('cleo@example.de');
let code, hid;

console.log('Haushalt');
await test('ohne Anmeldung -> 401, GET ohne Haushalt -> null', async () => {
  assert.equal((await call(hh, 'GET')).status, 401);
  assert.equal((await info(A)).body.household, null);
});
await test('anlegen: Besitzer, 8-stelliger Code', async () => {
  await push(A, 0, [plant('p1', 'Monstera', 1000)]);
  const r = await act(A, { action: 'create', name: '  WG   Nord ' });
  assert.equal(r.status, 200);
  const h = r.body.household; hid = h.id; code = h.inviteCode;
  assert.match(h.id, /^hh_/); assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/); assert.equal(h.name, 'WG Nord');
  assert.deepEqual(h.members, [{ email: 'anna@example.de', role: 'owner', me: true }]);
  assert.equal((await act(A, { action: 'create', name: 'noch einer' })).status, 409);
});
await test('beitreten: falscher Code -> 404, Code case-insensitive -> ok, doppelt -> 409', async () => {
  assert.equal((await act(B, { action: 'join', code: 'AAAAAAAA' })).status, 404);
  const r = await act(B, { action: 'join', code: ' ' + code.toLowerCase() + ' ' });
  assert.equal(r.status, 200); assert.equal(r.body.household.members.length, 2);
  assert.equal(r.body.household.members.find(m => m.me).role, 'member');
  assert.equal((await act(B, { action: 'join', code })).status, 409);
});
await test('Sync: A schiebt, B holt – und umgekehrt', async () => {
  // A hat "p1" vor dem Anlegen im persönlichen Raum; nach dem Anlegen lädt der Client neu hoch
  await push(A, 0, [plant('p1', 'Monstera', 1000), plant('p2', 'Ficus', 1100)]);
  const b = await push(B, 0, []);
  assert.deepEqual(names(b), ['p1', 'p2']);
  await push(B, b.body.cursor, [plant('p3', 'Basilikum', 1200)]);
  assert.deepEqual(names(await push(A, 0, [])), ['p1', 'p2', 'p3']);
});
await test('Nicht-Mitglied sieht nichts', async () => {
  assert.deepEqual(names(await push(C, 0, [])), []);
  await push(C, 0, [plant('c1', 'Kaktus', 1300)]);
  assert.ok(!names(await push(A, 0, [])).includes('c1'));
  assert.deepEqual(names(await push(C, 0, [])), ['c1']);
});
await test('Mitglieder: nur Mitglieder sehen Code; Umbenennen durch jedes Mitglied', async () => {
  assert.equal((await info(C)).body.household, null);
  const r = await act(B, { action: 'rename', name: 'Grüne WG' });
  assert.equal(r.body.household.name, 'Grüne WG');
  assert.equal((await act(B, { action: 'rename', name: '  ' })).status, 400);
  assert.equal((await act(C, { action: 'rename', name: 'x' })).status, 400);
});
await test('Code erneuern nur für Besitzer; alter Code ungültig', async () => {
  assert.equal((await act(B, { action: 'regenerate_code' })).status, 403);
  const r = await act(A, { action: 'regenerate_code' });
  assert.notEqual(r.body.household.inviteCode, code);
  assert.equal((await act(C, { action: 'join', code })).status, 404);
  code = r.body.household.inviteCode;
});
await test('Mitglied entfernen nur durch Besitzer', async () => {
  const j = await act(C, { action: 'join', code }); assert.equal(j.status, 200);
  assert.equal((await act(B, { action: 'remove_member', email: 'cleo@example.de' })).status, 403);
  assert.equal((await act(A, { action: 'remove_member', email: 'anna@example.de' })).status, 400);
  assert.equal((await act(A, { action: 'remove_member', email: 'nobody@example.de' })).status, 404);
  const r = await act(A, { action: 'remove_member', email: 'Cleo@example.de' });
  assert.equal(r.status, 200); assert.equal(r.body.household.members.length, 2);
  assert.equal((await info(C)).body.household, null);
  assert.deepEqual(names(await push(C, 0, [])), ['c1'], 'C ist zurück im persönlichen Garten');
});
await test('Verlassen: Sync geht zurück in den persönlichen Raum', async () => {
  assert.equal((await act(C, { action: 'leave' })).status, 400);
  const r = await act(B, { action: 'leave' });
  assert.equal(r.status, 200); assert.equal(r.body.household, null);
  assert.deepEqual(names(await push(B, 0, [])), [], 'B hatte persönlich nichts');
  assert.deepEqual(names(await push(A, 0, [])), ['p1', 'p2', 'p3'], 'Haushalt behält Daten');
});
await test('Besitzerwechsel: Besitzer geht, ältestes Mitglied wird Besitzer', async () => {
  await act(B, { action: 'join', code });
  await act(C, { action: 'join', code });
  const r = await act(A, { action: 'leave' });
  assert.equal(r.status, 200);
  const h = (await info(B)).body.household;
  assert.equal(h.members.find(m => m.email === 'ben@example.de').role, 'owner');
  assert.equal(h.members.find(m => m.email === 'cleo@example.de').role, 'member');
  assert.deepEqual(names(await push(B, 0, [])), ['p1', 'p2', 'p3'], 'Daten bleiben beim Haushalt');
  code = h.inviteCode;
  await act(A, { action: 'join', code });
});
await test('Mitgliederlimit', async () => {
  const pool = getPool();
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const t = await user(`extra${i}@example.de`);
    const r = await act(t, { action: 'join', code });
    const n = (await pool.query('SELECT count(*) AS n FROM household_members')).rows[0].n;
    if (Number(n) > MAX_MEMBERS) assert.fail('Limit überschritten');
    if (i >= MAX_MEMBERS - 3) { assert.equal(r.status, 409); assert.match(r.body.error, /voll/); }
  }
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM household_members WHERE household_id = $1', [(await info(B)).body.household.id])).rows[0].n), MAX_MEMBERS);
});
await test('Rate-Limit beim Raten von Codes', async () => {
  _resetJoinLimits();
  const t = await user('rater@example.de');
  let last;
  for (let i = 0; i < 12; i++) last = await act(t, { action: 'join', code: 'ZZZZZZZ' + (i % 9 + 1) });
  assert.equal(last.status, 429);
});
await test('Konto löschen: Mitgliedschaft weg, Besitzer wechselt, letztes Mitglied löscht Haushalt samt Daten', async () => {
  const pool = getPool();
  const D = await user('dora@example.de'), E = await user('emil@example.de');
  const c = (await act(D, { action: 'create', name: 'Zwei' })).body.household;
  await act(E, { action: 'join', code: c.inviteCode });
  await push(D, 0, [plant('d1', 'Farn', 2000)]);
  assert.equal((await call(auth, 'POST', { action: 'delete', password: 'geheim1234' }, D)).status, 200);
  const h = (await info(E)).body.household;
  assert.equal(h.members.length, 1); assert.equal(h.members[0].role, 'owner');
  assert.deepEqual(names(await push(E, 0, [])), ['d1']);
  assert.equal((await call(auth, 'POST', { action: 'delete', password: 'geheim1234' }, E)).status, 200);
  assert.equal((await pool.query('SELECT 1 FROM households WHERE id = $1', [c.id])).rows.length, 0);
  assert.equal((await pool.query('SELECT 1 FROM items WHERE user_id = $1', [c.id])).rows.length, 0);
  assert.equal((await pool.query(`SELECT 1 FROM household_members WHERE household_id = $1`, [c.id])).rows.length, 0);
});
await test('ohne DATABASE_URL -> 503', async () => {
  const saved = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try { assert.equal((await call(hh, 'GET')).status, 503); } finally { process.env.DATABASE_URL = saved; }
});

console.log(`${passed} Tests bestanden`);
process.exit(process.exitCode || 0);
