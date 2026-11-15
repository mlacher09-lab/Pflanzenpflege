// Push-Erinnerungen (Web Push): Einstellungen, Abo-Verwaltung, Dialog. Nur für angemeldete Nutzer.
import { account } from './account.js';
import { api } from './api.js';
import { store } from './store.js';
import { esc, hasMow } from './util.js';

const PREFS_KEY = 'local:pushPrefs';
const DEFAULT = { enabled: false, water: true, fert: true, repot: false, prop: false, mow: false };
const CATS = [
  { key: 'water', icon: '💧', title: 'Gießen', sub: 'Wenn Pflanzen gegossen werden müssen' },
  { key: 'fert',  icon: '🌱', title: 'Düngen', sub: 'Wenn gedüngt werden sollte' },
  { key: 'repot', icon: '🪴', title: 'Umtopfen', sub: 'Im Frühjahr, höchstens alle 30 Tage pro Pflanze' },
  { key: 'prop',  icon: '✂️', title: 'Ableger züchten (saisonal)', sub: 'Einmal im Monat, solange die Jahreszeit passt' },
  { key: 'mow',   icon: '🌾', title: 'Rasen mähen', sub: 'Wenn gemäht werden sollte', lawn: true },
];

let prefs = { ...DEFAULT };
let ctx = { hasLawn: false, getPlants: null };
let server = null;          // { configured, publicKey } oder null (unbekannt/nicht erreichbar)
let subscribed = false;     // Abo auf diesem Gerät aktiv
let busy = false, msg = '';
let dialog = null;

export function setPushContext(c = {}) { ctx = { ...ctx, ...c }; if (dialog?.open) render(); }

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}
const needsInstall = () => isIOS() && !standalone();

async function hasLawn() {
  if (ctx.hasLawn) return true;
  try { const ps = ctx.getPlants && await ctx.getPlants(); return !!ps?.some(p => p && hasMow(p)); } catch { return false; }
}

async function fetchServer() {
  try {
    const r = await fetch(api.url('/api/push'), { headers: api.headers() });
    server = r.ok ? await r.json() : null;
  } catch { server = null; }
}
async function post(body) {
  const r = await fetch(api.url('/api/push'), { method: 'POST', headers: { ...api.headers(), Authorization: `Bearer ${account.token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Fehler'), { status: r.status });
  return j;
}
async function currentSub() {
  if (!pushSupported()) return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; }
}
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
const serverPrefs = () => ({ water: prefs.water, fert: prefs.fert, repot: prefs.repot, prop: prefs.prop, mow: prefs.mow && ctx.hasLawn });
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

export async function initPush(opts = {}) {
  if (opts.getPlants) ctx.getPlants = opts.getPlants;
  if (opts.hasLawn !== undefined) ctx.hasLawn = opts.hasLawn;
  prefs = { ...DEFAULT, ...(await store.getSetting(PREFS_KEY, {}) || {}) };
  if (account.user) await fetchServer();
  const sub = await currentSub();
  subscribed = !!sub && prefs.enabled && Notification.permission === 'granted';
  if (!ctx.hasLawn) ctx.hasLawn = await hasLawn();
  return { prefs, subscribed };
}

export function pushStatusText() {
  if (!pushSupported() || (server && !server.configured)) return 'Nicht verfügbar';
  if (!account.user) return 'Konto nötig';
  return subscribed ? 'An' : 'Aus';
}

async function savePrefs() { await store.setSetting(PREFS_KEY, prefs); }

async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Benachrichtigungen sind blockiert. Erlaube sie in den Browser-/System-Einstellungen für diese App.');
  if (!server?.publicKey) throw new Error('Der Server hat keine Push-Schlüssel.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(server.publicKey) });
  await post({ action: 'subscribe', subscription: sub.toJSON(), prefs: serverPrefs(), tz: tz() });
  prefs.enabled = true; subscribed = true; await savePrefs();
}
async function disable() {
  const sub = await currentSub();
  if (sub) { await post({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  prefs.enabled = false; subscribed = false; await savePrefs();
}

async function run(fn, ok = '') {
  if (busy) return;
  busy = true; msg = ''; render();
  try { await fn(); msg = ok; } catch (e) { msg = e.message || 'Fehler'; }
  busy = false; render();
}

function hint() {
  if (!pushSupported()) return needsInstall() ? '' : 'Dieser Browser unterstützt keine Push-Benachrichtigungen.';
  return '';
}

function render() {
  if (!dialog) return;
  const body = dialog.querySelector('.modal-body');
  const pill = pushStatusText();
  let info = '';
  if (needsInstall()) info = 'Auf dem iPhone/iPad funktioniert Push nur, wenn die App zum Home-Bildschirm hinzugefügt ist (Teilen → „Zum Home-Bildschirm“, iOS 16.4 oder neuer). Öffne sie dann von dort.';
  else if (!pushSupported()) info = hint();
  else if (!account.user) info = 'Push-Erinnerungen brauchen ein Konto (Mehr → Konto).';
  else if (server && !server.configured) info = 'Push ist auf diesem Server nicht eingerichtet.';
  else if (!server) info = 'Server nicht erreichbar – bitte später erneut versuchen.';
  else if (Notification.permission === 'denied') info = 'Benachrichtigungen sind blockiert. Erlaube sie in den Browser-/System-Einstellungen und öffne diesen Dialog erneut.';
  const usable = !info;
  const showMow = ctx.hasLawn;
  body.innerHTML = `
    <div class="list-card sub-menu">
      <label class="list-item" style="cursor:pointer"><span class="li-icon">🔔</span><span class="li-text">Push-Erinnerungen<div class="li-sub">Täglich morgens eine Benachrichtigung – auch bei geschlossener App. Nur für ausgewählte Kategorien.</div></span><span class="status-pill">${esc(pill)}</span><input type="checkbox" id="push-master" style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0" ${subscribed ? 'checked' : ''} ${usable && !busy ? '' : 'disabled'}></label>
      ${CATS.filter(c => !c.lawn || showMow).map(c => `<label class="list-item" style="cursor:pointer"><span class="li-icon">${c.icon}</span><span class="li-text">${c.title}<div class="li-sub">${c.sub}</div></span><input type="checkbox" data-cat="${c.key}" style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0" ${prefs[c.key] ? 'checked' : ''} ${busy ? 'disabled' : ''}></label>`).join('')}
      <button class="list-item" id="push-test" ${subscribed && !busy ? '' : 'disabled'}><span class="li-icon">📨</span><span class="li-text">Test senden<div class="li-sub">Schickt sofort eine Beispiel-Benachrichtigung</div></span></button>
    </div>
    ${info ? `<p class="muted" style="margin:12px 4px">${esc(info)}</p>` : ''}
    ${msg ? `<p class="muted" role="status" style="margin:12px 4px">${esc(msg)}</p>` : ''}
    <p class="muted" style="margin:12px 4px">Dafür speichert der Server deine Pflanzen (wie bei der Synchronisation) und die Adresse deines Geräts für Push-Nachrichten. Beim Ausschalten oder Löschen des Kontos wird sie entfernt.</p>`;
  body.querySelector('#push-master').onchange = e => run(() => e.target.checked ? enable() : disable(), e.target.checked ? 'Push-Erinnerungen sind an.' : 'Push-Erinnerungen sind aus.');
  body.querySelectorAll('[data-cat]').forEach(cb => cb.onchange = async () => {
    prefs[cb.dataset.cat] = cb.checked; await savePrefs();
    if (subscribed) { const sub = await currentSub(); if (sub) post({ action: 'prefs', endpoint: sub.endpoint, prefs: serverPrefs() }).catch(e => { msg = e.message; render(); }); }
  });
  body.querySelector('#push-test').onclick = () => run(async () => {
    const sub = await currentSub(); if (!sub) throw new Error('Kein aktives Abo – bitte Push neu aktivieren.');
    try { await post({ action: 'test', endpoint: sub.endpoint }); }
    catch (e) { if (e.status === 410 || e.status === 404) { subscribed = false; prefs.enabled = false; await savePrefs(); } throw e; }
  }, 'Test gesendet – die Benachrichtigung sollte gleich erscheinen.');
}

export async function openPushSettings() {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'push-dialog'; dialog.setAttribute('aria-labelledby', 'push-title');
    dialog.innerHTML = `<div class="modal-header"><div><span class="modal-title" id="push-title">Push-Erinnerungen</span><div class="muted">Pflege-Hinweise aufs Handy</div></div><button class="close-btn" aria-label="Schließen">✕</button></div><div class="modal-body"></div>`;
    dialog.querySelector('.close-btn').onclick = () => dialog.close();
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }
  msg = '';
  render();
  dialog.showModal();
  await initPush();
  render();
}
