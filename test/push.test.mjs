// Test der Push-API ohne echte Datenbank/Push-Dienste: node test/push.test.mjs
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

process.env.DATABASE_URL = 'postgres://test/test';
process.env.AUTH_FAIL_DELAY_MS = '0';
process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTests';
process.env.VAPID_PRIVATE_KEY = 'private';
process.env.CRON_SECRET = 'cron-secret';
const { setPool, getPool } = await import('../lib/db.js');
const { Pool } = newDb().adapters.createPg();
setPool(new Pool());
const auth = (await import('../api/auth.js')).default;
const pushApi = (await import('../api/push.js')).default;
const cron = (await import('../api/push-cron.js')).default;
const { setSender, deleteSubscriptionsForUser } = await import('../lib/push.js');
const { today, addDays } = await import('../js/util.js');

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.stack); process.exitCode = 1; } }
async function call(handler, method, body, token) {
  const headers = {}; if (token) headers.authorization = 'Bearer ' + token;
  const out = { headers: {} };
  const res = { statusCode: 200, setHeader(k, v) { out.headers[k] = v; }, end(s) { out.body = s ? JSON.parse(s) : null; } };
  await handler({ method, headers, body }, res);
  return { status: res.statusCode, ...out };
}
const post = (b, t) => call(pushApi, 'POST', b, t);
const runCron = secret => call(cron, 'GET', undefined, secret);

const reg = await call(auth, 'POST', { action: 'register', email: 'push@example.de', password: 'geheim1234' });
const tok = reg.body.token;
const uid = (await getPool().query(`SELECT id FROM users WHERE email = 'push@example.de'`)).rows[0].id;
const seed = async (id, data) => getPool().query(
  `INSERT INTO items (user_id, store, id, data, updated_at, deleted, seq) VALUES ($1,'plants',$2,$3,1,false,nextval('items_seq'))`, [uid, id, JSON.stringify({ id, ...data })]);
const clear = () => getPool().query(`DELETE FROM items WHERE user_id = $1`, [uid]);
const sub = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'pk' + n, auth: 'au' + n } });

let sent = [], failWith = null;
setSender(async (s, payload) => { if (failWith) throw Object.assign(new Error('x'), { statusCode: failWith }); sent.push({ endpoint: s.endpoint, ...JSON.parse(payload) }); });

console.log('Push');
await test('GET meldet configured und publicKey', async () => {
  const r = await call(pushApi, 'GET');
  assert.equal(r.body.configured, true); assert.equal(r.body.publicKey, 'BPublicKeyForTests');
});
await test('subscribe braucht Anmeldung', async () => {
  assert.equal((await post({ action: 'subscribe', subscription: sub(), prefs: { water: true } })).status, 401);
});
await test('subscribe speichert, prefs ändert, ungültiges Abo -> 400', async () => {
  assert.equal((await post({ action: 'subscribe', subscription: { endpoint: 'x' }, prefs: {} }, tok)).status, 400);
  // SSRF-Schutz: nur bekannte Push-Dienste
  assert.equal((await post({ action: 'subscribe', subscription: { endpoint: 'https://169.254.169.254/latest', keys: { p256dh: 'a', auth: 'b' } }, prefs: {} }, tok)).status, 400);
  assert.equal((await post({ action: 'subscribe', subscription: { endpoint: 'https://evil.example/x', keys: { p256dh: 'a', auth: 'b' } }, prefs: {} }, tok)).status, 400);
  assert.equal((await post({ action: 'subscribe', subscription: sub(), prefs: { water: true }, tz: 'Europe/Berlin' }, tok)).status, 200);
  assert.equal((await post({ action: 'prefs', endpoint: sub().endpoint, prefs: { water: true, fert: true, bogus: true } }, tok)).status, 200);
  const { rows } = await getPool().query('SELECT prefs FROM push_subscriptions');
  assert.equal(rows.length, 1); assert.equal(rows[0].prefs.fert, true); assert.equal(rows[0].prefs.bogus, undefined);
});
await test('test-Aktion sendet', async () => {
  sent = [];
  assert.equal((await post({ action: 'test', endpoint: sub().endpoint }, tok)).status, 200);
  assert.equal(sent.length, 1);
  assert.equal((await post({ action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/fremd-999' }, tok)).status, 404);
});
await test('Cron braucht CRON_SECRET', async () => {
  assert.equal((await runCron()).status, 401);
  assert.equal((await runCron('falsch')).status, 401);
  delete process.env.CRON_SECRET; assert.equal((await runCron('x')).status, 503); process.env.CRON_SECRET = 'cron-secret';
});
await test('nichts fällig -> nichts gesendet', async () => {
  await clear(); await seed('a', { type: 'Monstera', lastWatered: today(), lastFertilized: today(), addedAt: today() });
  sent = [];
  const r = await runCron('cron-secret');
  assert.equal(r.status, 200); assert.equal(sent.length, 0); assert.equal(r.body.sent, 0);
});
await test('nur gewählte Kategorien, eine Nachricht', async () => {
  await clear();
  await seed('a', { type: 'Monstera', nickname: 'Moni', lastWatered: '2020-01-01', lastFertilized: '2020-01-01', addedAt: '2020-01-01' });
  await seed('b', { type: 'Ficus', lastWatered: '2020-01-01', addedAt: '2020-01-01' });
  sent = [];
  await post({ action: 'prefs', endpoint: sub().endpoint, prefs: { water: true } }, tok);
  const r = await runCron('cron-secret');
  assert.equal(r.body.sent, 1); assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Pflanzenpflege'); assert.equal(sent[0].tag, 'care');
  assert.match(sent[0].body, /💧 2 Pflanzen gießen: .*Moni/); assert.doesNotMatch(sent[0].body, /düngen/);
  sent = [];
  await post({ action: 'prefs', endpoint: sub().endpoint, prefs: {} }, tok);
  await runCron('cron-secret'); assert.equal(sent.length, 0);
});
await test('Umtopfen höchstens alle 30 Tage pro Pflanze', async () => {
  await clear();
  const { PLANT_DB } = await import('../js/plants-db.js');
  const type = Object.keys(PLANT_DB).find(k => PLANT_DB[k].ry);
  const RealDate = Date;   // Umtopf-Hinweis gibt es nur März–Juni: Uhr auf den 15. April stellen
  globalThis.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(2027, 3, 15, 8); } static now() { return new RealDate(2027, 3, 15, 8).getTime(); } };
  try {
  await seed('r', { type, lastRepotted: '2000-01-01', addedAt: '2000-01-01', lastWatered: today() });
  await post({ action: 'prefs', endpoint: sub().endpoint, prefs: { repot: true } }, tok);
  sent = [];
  await runCron('cron-secret'); assert.equal(sent.length, 1); assert.match(sent[0].body, /🪴/);
  await runCron('cron-secret'); assert.equal(sent.length, 1);
  await getPool().query(`UPDATE push_subscriptions SET last_sent = $1`, [JSON.stringify({ 'repot:r': addDays(today(), -31) })]);
  await runCron('cron-secret'); assert.equal(sent.length, 2);
  } finally { globalThis.Date = RealDate; }
});
await test('Ableger: einmal pro Monat', async () => {
  await clear();
  const { PLANT_DB } = await import('../js/plants-db.js');
  const m = new Date().getMonth() + 1;
  const type = Object.keys(PLANT_DB).find(k => PLANT_DB[k].prop?.months?.includes(m));
  if (!type) return console.log('    (übersprungen: keine Art mit Ableger-Saison)');
  await seed('s', { type, addedAt: today(), lastWatered: today(), lastFertilized: today() });
  await getPool().query(`UPDATE push_subscriptions SET last_sent = '{}'`);
  await post({ action: 'prefs', endpoint: sub().endpoint, prefs: { prop: true } }, tok);
  sent = [];
  await runCron('cron-secret'); assert.equal(sent.length, 1); assert.match(sent[0].body, /Ableger/);
  await runCron('cron-secret'); assert.equal(sent.length, 1);
});
await test('410 entfernt das Abo', async () => {
  await clear(); await seed('a', { type: 'Monstera', lastWatered: '2020-01-01', addedAt: '2020-01-01' });
  await post({ action: 'prefs', endpoint: sub().endpoint, prefs: { water: true } }, tok);
  failWith = 410;
  const r = await runCron('cron-secret'); failWith = null;
  assert.equal(r.body.removed, 1);
  assert.equal((await getPool().query('SELECT 1 FROM push_subscriptions')).rows.length, 0);
});
await test('unsubscribe und deleteSubscriptionsForUser', async () => {
  await post({ action: 'subscribe', subscription: sub(1), prefs: {} }, tok);
  await post({ action: 'subscribe', subscription: sub(2), prefs: {} }, tok);
  assert.equal((await post({ action: 'unsubscribe', endpoint: sub(1).endpoint }, tok)).status, 200);
  assert.equal(await deleteSubscriptionsForUser(uid), 1);
});
console.log(`${passed} Tests bestanden`);
