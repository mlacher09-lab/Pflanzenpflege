// Web-Push für Pflanzenpflege: Abos, Fälligkeitsberechnung und Versand.
// util.js nutzt lokale Datumsangaben → Zeitzone des Servers auf Europe/Berlin festlegen.
process.env.TZ = process.env.TZ_PUSH || 'Europe/Berlin';
import * as webpush from 'web-push';
import { getPool, ensureSchema } from './db.js';
import { spaceOf } from './space.js';
import { waterStatus, fertStatus, mowStatus, hasMow, repotDue, propagationNow, today, daysDiff } from '../js/util.js';

export const CATEGORIES = ['water', 'fert', 'repot', 'prop', 'mow'];
const REPOT_EVERY_DAYS = 30;
const PROP_EVERY_DAYS = 30;

export function vapidConfigured() { return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY); }
export function vapidPublicKey() { return process.env.VAPID_PUBLIC_KEY || ''; }

let sender = null;
/** Nur für Tests: eigenen Sender (async (subscription, payloadString) => void) einsetzen. */
export function setSender(fn) { sender = fn; }
export async function sendNotification(sub, payload) {
  if (sender) return sender(sub, JSON.stringify(payload));
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 12 * 3600 });
}

let ready = null;
export function ensurePushSchema() {
  if (!ready) {
    ready = ensureSchema().then(() => getPool().query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint text PRIMARY KEY,
        user_id text NOT NULL,
        keys jsonb NOT NULL,
        prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
        tz text,
        created_at timestamptz DEFAULT now(),
        last_sent jsonb DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
    `)).catch(e => { ready = null; throw e; });
  }
  return ready;
}
/** Nur für Tests. */
export function _resetPushSchema() { ready = null; }

export function cleanPrefs(p) {
  const out = {};
  for (const c of CATEGORIES) out[c] = !!(p && p[c]);
  return out;
}

export async function deleteSubscription(userId, endpoint) {
  await ensurePushSchema();
  await getPool().query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}
export async function deleteSubscriptionsForUser(userId) {
  await ensurePushSchema();
  const r = await getPool().query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
  return r.rowCount;
}

const name = p => p.nickname || p.type || 'Pflanze';
const list = (arr, max = 4) => arr.slice(0, max).join(', ') + (arr.length > max ? `, … (+${arr.length - max})` : '');
const plural = n => `${n} Pflanze${n === 1 ? '' : 'n'}`;
const daysSince = (iso, t) => { const d = iso && String(iso).slice(0, 10); return d ? daysDiff(d, t) : Infinity; };

/**
 * Berechnet die heute fälligen Erinnerungen für Pflanzen nach Auswahl.
 * → { lines: string[], marks: { repot: [ids], prop: [ids] } }
 */
export function dueReminders(plants, prefs, lastSent = {}, t = today()) {
  const lines = [], marks = { repot: [], prop: [] };
  const due = fn => plants.filter(p => { try { return fn(p); } catch { return false; } });
  if (prefs.water) {
    const l = due(p => waterStatus(p).days <= 0).map(name);
    if (l.length) lines.push(`💧 ${plural(l.length)} gießen: ${list(l)}`);
  }
  if (prefs.fert) {
    const l = due(p => { const s = fertStatus(p); return !s.repot && s.days <= 0; }).map(name);
    if (l.length) lines.push(`🌱 ${plural(l.length)} düngen: ${list(l)}`);
  }
  if (prefs.mow) {
    const l = due(p => hasMow(p) && mowStatus(p).days <= 0).map(name);
    if (l.length) lines.push(`✂️ Rasen mähen: ${list(l)}`);
  }
  if (prefs.repot) {
    const ps = due(p => repotDue(p)?.due && !(p.repotSnooze && daysDiff(t, p.repotSnooze) > 0) && daysSince(lastSent[`repot:${p.id}`], t) >= REPOT_EVERY_DAYS);
    if (ps.length) { lines.push(`🪴 Umtopfen fällig: ${list(ps.map(name))}`); marks.repot = ps.map(p => p.id); }
  }
  if (prefs.prop) {
    const ps = due(p => propagationNow(p) && daysSince(lastSent[`prop:${p.id}`], t) >= PROP_EVERY_DAYS);
    if (ps.length) {
      const how = propagationNow(ps[0]).how;
      lines.push(`✂️ Gute Zeit für Ableger: ${list(ps.map(name))}${how ? ' – ' + how : ''}`);
      marks.prop = ps.map(p => p.id);
    }
  }
  return { lines, marks };
}

export async function loadPlants(userId) {
  const space = await spaceOf(userId);
  const { rows } = await getPool().query(`SELECT id, data FROM items WHERE user_id = $1 AND store = 'plants' AND deleted = false`, [space]);
  return rows.map(r => ({ ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data), id: r.id })).filter(p => p && p.type);
}

/** Sendet (falls nötig) die Tages-Erinnerung an ein Abo. → 'sent' | 'none' | 'gone' | 'error' */
export async function processSubscription(row, plantCache = new Map()) {
  const prefs = row.prefs || {};
  if (!CATEGORIES.some(c => prefs[c])) return 'none';
  if (!plantCache.has(row.user_id)) plantCache.set(row.user_id, loadPlants(row.user_id));
  const plants = await plantCache.get(row.user_id);
  const lastSent = row.last_sent || {};
  const { lines, marks } = dueReminders(plants, prefs, lastSent);
  if (!lines.length) return 'none';
  try {
    await sendNotification({ endpoint: row.endpoint, keys: row.keys }, { title: 'Pflanzenpflege', body: lines.join('\n'), tag: 'care', url: '/' });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      await getPool().query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]);
      return 'gone';
    }
    console.error('push send', e.statusCode || e.message);
    return 'error';
  }
  const t = today();
  const upd = { ...lastSent };
  for (const id of marks.repot) upd[`repot:${id}`] = t;
  for (const id of marks.prop) upd[`prop:${id}`] = t;
  if (marks.repot.length || marks.prop.length) {
    await getPool().query('UPDATE push_subscriptions SET last_sent = $2 WHERE endpoint = $1', [row.endpoint, JSON.stringify(upd)]);
  }
  return 'sent';
}

export async function runCron() {
  await ensurePushSchema();
  const { rows } = await getPool().query('SELECT endpoint, user_id, keys, prefs, last_sent FROM push_subscriptions');
  const out = { subscriptions: rows.length, sent: 0, none: 0, removed: 0, errors: 0 };
  const cache = new Map();
  const count = res => { if (res === 'sent') out.sent++; else if (res === 'none') out.none++; else if (res === 'gone') out.removed++; else out.errors++; };
  for (let i = 0; i < rows.length; i += 10) {   // 10 parallel – bleibt im Zeitlimit der Funktion
    const results = await Promise.all(rows.slice(i, i + 10).map(r => processSubscription(r, cache).catch(() => 'error')));
    results.forEach(count);
  }
  return out;
}
