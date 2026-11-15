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

/** Push-Abo dieses Geräts im Browser lösen (beim Abmelden/Löschen); liefert den Endpunkt für den Server. */
async function dropPushSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    return endpoint;
  } catch { return null; }
}

export const account = {
  user: null,            // { email } oder null (Gast)
  token: null,
  configured: null,      // true/false, ob der Server Konten anbietet (null = unbekannt)
  status: 'guest',       // guest | syncing | synced | offline | error
  lastSync: 0,
  lastError: '',
  household: null,       // null | { id, name, inviteCode, members: [{ email, role, me }] }
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
    if (this.user) await this.loadHousehold().catch(() => {});
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
    this.lastSync = 0; await store.setSetting('local:lastSync', 0);
    await store.queueAll();          // vorhandene Gast-Daten ins Konto übernehmen
    this._emit();
    await this.loadHousehold().catch(() => {});   // Mitglied eines Haushalts? Dann wird dessen Garten geladen
    await this.sync();
  },
  async register(email, password) { await this._session(await request('/api/auth', { method: 'POST', body: { action: 'register', email, password } })); },
  async login(email, password) { await this._session(await request('/api/auth', { method: 'POST', body: { action: 'login', email, password } })); },

  async _forget() {
    this.token = null; this.user = null; this.lastSync = 0;
    this.household = null;
    for (const k of ['local:authToken', 'local:authUser', 'local:syncCursor', 'local:lastSync', 'local:householdId']) await store.setSetting(k, null);
    this._set('guest');
  },
  async logout({ clearLocal = false } = {}) {
    if (syncing) await syncing.catch(() => {});
    const endpoint = await dropPushSubscription();
    if (this.token) await request('/api/auth', { method: 'POST', token: this.token, body: { action: 'logout', endpoint } }).catch(() => {});
    await this._forget();
    if (clearLocal) await store.wipeLocal();
  },
  async deleteAccount(password) {
    await request('/api/auth', { method: 'POST', token: this.token, body: { action: 'delete', password } });
    await dropPushSubscription();
    await this._forget();            // Daten bleiben als Gast auf dem Gerät
  },
  async changePassword(oldPassword, newPassword) {
    await request('/api/auth', { method: 'POST', token: this.token, body: { action: 'change_password', oldPassword, newPassword } });
  },

  // ---- Gemeinsamer Garten (Haushalt) -------------------------------------------------------------
  async _hh(body) {
    const r = await request('/api/household', { method: 'POST', token: this.token, body });
    await this._setHousehold(r.household || null);
    return this.household;
  },
  async _setHousehold(h) {
    this.household = h;
    await store.setSetting('local:householdId', h ? h.id : null);
    this._emit();
  },
  /** Datenraum gewechselt: Cursor zurücksetzen, optional lokale Daten in den neuen Raum hochladen, abgleichen. */
  async _switchSpace({ wipe = false, queue = true } = {}) {
    if (syncing) await syncing.catch(() => {});
    if (wipe) await store.wipeLocal();
    await store.setSetting('local:syncCursor', 0);
    if (queue) await store.queueAll();
    const r = await this.sync();
    window.dispatchEvent(new CustomEvent('store-remote-applied', { detail: { pulled: r?.pulled || 0, switched: true } }));
  },
  /** Holt den Haushalt vom Server. Wechselt der Haushalt auf einem anderen Gerät, folgt dieses Gerät (lokale Daten werden mitgenommen). */
  async loadHousehold() {
    if (!this.user || !this.token) { this.household = null; this._emit(); return null; }
    let r;
    try { r = await request('/api/household', { token: this.token }); }
    catch (e) { if (e.status === 401 || e.status === 503 || e.offline) return this.household; throw e; }
    const known = await store.getSetting('local:householdId', null);
    const h = r.household || null;
    await this._setHousehold(h);
    if (known !== undefined && known !== null && (h?.id || null) !== known) await this._switchSpace();   // z. B. entfernt oder auf anderem Gerät beigetreten
    else if (!known && h) await this._switchSpace();
    return h;
  },
  async createHousehold(name) {
    await this._hh({ action: 'create', name });
    await this._switchSpace();       // eigene Daten werden zum gemeinsamen Garten
    return this.household;
  },
  async joinHousehold(code, { bringData = true } = {}) {
    await this._hh({ action: 'join', code });
    await this._switchSpace({ wipe: !bringData, queue: bringData });
    return this.household;
  },
  /** keepCopy: lokale Daten bleiben und werden in den persönlichen Garten kopiert (dort evtl. noch vorhandene alte Einträge kommen dazu).
   *  sonst: lokal leeren und den persönlichen Garten laden. */
  async leaveHousehold({ keepCopy = true } = {}) {
    await this._hh({ action: 'leave' });
    await this._switchSpace({ wipe: !keepCopy, queue: keepCopy });
  },
  renameHousehold(name) { return this._hh({ action: 'rename', name }); },
  regenerateInvite() { return this._hh({ action: 'regenerate_code' }); },
  removeMember(email) { return this._hh({ action: 'remove_member', email }); },

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
        if (e.status === 413) e.message = 'Ein Eintrag ist zu groß für die Übertragung (max. 4 MB) – bitte das Foto dieser Pflanze neu aufnehmen oder entfernen.';
        this._set('error', e.message);
        return { error: e.message };
      } finally { syncing = null; }
    })();
    return syncing;
  },
};

/** Kurzer Anzeigename für „wer hat gegossen“: Teil der E-Mail vor dem @ (Gast: null). */
export function actorName() {
  const e = account.user?.email;
  return e ? e.split('@')[0] : null;
}
