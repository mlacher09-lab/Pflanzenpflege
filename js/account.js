// Nutzerkonto (E-Mail + Passwort) und Synchronisierung mit dem eigenen Server (/api/auth, /api/sync).
// Gast = bisheriges Verhalten: alles bleibt nur auf dem Gerät. Angemeldet: IndexedDB bleibt die Arbeitskopie
// (offline nutzbar), Änderungen werden im Hintergrund abgeglichen.
import { store } from './store.js';
import { api } from './api.js';

const MAX_BATCH_BYTES = 3 * 1024 * 1024;   // Vercel erlaubt ~4,5 MB pro Anfrage
const MAX_BATCH_ITEMS = 400;
const listeners = new Set();
let syncing = null, timer = null;

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(api.url(path), { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { const e = new Error('Server nicht erreichbar – bitte Internetverbindung prüfen.'); e.offline = true; throw e; }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) { const e = new Error(data?.error || `Server antwortete mit HTTP ${res.status}`); e.status = res.status; throw e; }
  return data || {};
}

export const account = {
  user: null,            // { email } oder null (Gast)
  token: null,
  configured: null,      // true/false, ob der Server Konten anbietet (null = unbekannt)
  status: 'guest',       // guest | syncing | synced | offline | error
  lastSync: 0,
  lastError: '',
  get isGuest() { return !this.user; },

  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  _emit() { listeners.forEach(cb => { try { cb(this); } catch { /* ignorieren */ } }); },
  _set(status, err = '') { this.status = status; this.lastError = err; this._emit(); },

  async init() {
    this.token = await store.getSetting('local:authToken', null);
    this.user = this.token ? await store.getSetting('local:authUser', null) : null;
    this.lastSync = (await store.getSetting('local:lastSync', 0)) || 0;
    this.status = this.user ? 'synced' : 'guest';
    try {
      const r = await request('/api/auth', { token: this.token });
      this.configured = !!r.configured;
      if (this.token && r.configured && !r.user) await this._forget();   // Sitzung abgelaufen → Gast, Daten bleiben
      else if (r.user) { this.user = r.user; await store.setSetting('local:authUser', r.user); }
    } catch (e) {
      if (e.offline && this.user) this.status = 'offline';
      else if (!e.offline) this.configured = false;
    }
    window.addEventListener('store-changed', () => this.schedule());
    window.addEventListener('online', () => this.schedule(500));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.schedule(500); });
    this._emit();
  },

  async _session(r) {
    this.token = r.token; this.user = r.user;
    await store.setSetting('local:authToken', r.token);
    await store.setSetting('local:authUser', r.user);
    await store.setSetting('local:syncCursor', 0);
    await store.queueAll();          // vorhandene Gast-Daten ins Konto übernehmen
    this._emit();
    await this.sync();
  },
  async register(email, password) { await this._session(await request('/api/auth', { method: 'POST', body: { action: 'register', email, password } })); },
  async login(email, password) { await this._session(await request('/api/auth', { method: 'POST', body: { action: 'login', email, password } })); },

  async _forget() {
    this.token = null; this.user = null; this.lastSync = 0;
    for (const k of ['local:authToken', 'local:authUser', 'local:syncCursor', 'local:lastSync']) await store.setSetting(k, null);
    this._set('guest');
  },
  async logout({ clearLocal = false } = {}) {
    if (syncing) await syncing.catch(() => {});
    if (this.token) await request('/api/auth', { method: 'POST', token: this.token, body: { action: 'logout' } }).catch(() => {});
    await this._forget();
    if (clearLocal) await store.wipeLocal();
  },
  async deleteAccount(password) {
    await request('/api/auth', { method: 'POST', token: this.token, body: { action: 'delete', password } });
    await this._forget();            // Daten bleiben als Gast auf dem Gerät
  },
  async changePassword(oldPassword, newPassword) {
    await request('/api/auth', { method: 'POST', token: this.token, body: { action: 'change_password', oldPassword, newPassword } });
  },

  /** Verzögerter Abgleich nach lokalen Änderungen. */
  schedule(ms = 3000) {
    if (!this.user) return;
    clearTimeout(timer);
    timer = setTimeout(() => this.sync().catch(() => {}), ms);
  },

  /** Ausgang hochladen (in Paketen), Änderungen anderer Geräte holen. */
  sync() {
    if (!this.user || !this.token) return Promise.resolve(null);
    if (syncing) return syncing;
    syncing = (async () => {
      this._set('syncing');
      let pushed = 0, pulled = 0;
      try {
        let cursor = (await store.getSetting('local:syncCursor', 0)) || 0;
        for (let round = 0; round < 100; round++) {
          const pending = await store.pendingChanges();
          const batch = []; let size = 0;
          for (const c of pending) {
            const len = JSON.stringify(c.data || '').length + 200;
            if (batch.length && (size + len > MAX_BATCH_BYTES || batch.length >= MAX_BATCH_ITEMS)) break;
            batch.push(c); size += len;
          }
          const r = await request('/api/sync', { method: 'POST', token: this.token,
            body: { since: cursor, changes: batch.map(({ store: s, id, data, updatedAt, deleted }) => ({ store: s, id, data, updatedAt, deleted })) } });
          await store.ackChanges(batch);
          pushed += batch.length;
          pulled += await store.applyRemote(r.changes || []);
          cursor = r.cursor ?? cursor;
          await store.setSetting('local:syncCursor', cursor);
          if (!r.more && batch.length === pending.length) break;
        }
        this.lastSync = Date.now();
        await store.setSetting('local:lastSync', this.lastSync);
        this._set('synced');
        if (pulled) window.dispatchEvent(new CustomEvent('store-remote-applied', { detail: { pulled } }));
        return { pushed, pulled };
      } catch (e) {
        if (e.offline) { this._set('offline'); return { offline: true }; }
        if (e.status === 401) { await this._forget(); this._set('guest', 'Sitzung abgelaufen – bitte erneut anmelden.'); return null; }
        this._set('error', e.message);
        return { error: e.message };
      } finally { syncing = null; }
    })();
    return syncing;
  },
};
