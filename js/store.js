// Lokale Datenhaltung mit IndexedDB. Alles bleibt auf dem Gerät; Export/Import erlaubt den Gerätewechsel.
const DB_NAME = 'pflanzenpflege';
const DB_VERSION = 1;
const STORES = ['plants', 'wishlist', 'settings'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ─── Änderungsverfolgung für die Konto-Synchronisierung ────────────────
// Jede lokale Änderung bekommt updatedAt und landet im Ausgang (Outbox); js/account.js schickt sie zum Server.
// Gäste nutzen dieselbe Verfolgung – so werden beim späteren Anmelden alle Daten übernommen.
// Gerätespezifisch bzw. geheim – wird nie synchronisiert (Spiegel in api/sync.js).
const NO_SYNC = new Set(['apiBase', 'appToken', 'authToken', 'syncCursor', 'pendingChanges', 'clientId', 'analytics', 'analyticsConsent', 'lastNotify', 'installDismissed']);
export const syncable = (name, id) => !(name === 'settings' && (String(id).startsWith('local:') || NO_SYNC.has(id)));
const OUTBOX = 'local:outbox';
let outbox = null;          // { "store\u0000id": { store, id, updatedAt, deleted } }
let outboxSave = Promise.resolve();
async function loadOutbox() {
  if (!outbox) { const row = await tx('settings', 'readonly', s => s.get(OUTBOX)); outbox = (row && row.value) || {}; }
  return outbox;
}
function persistOutbox() {
  outboxSave = outboxSave.then(() => tx('settings', 'readwrite', s => s.put({ id: OUTBOX, value: outbox }))).catch(() => {});
  return outboxSave;
}
async function track(name, items, deleted = false) {
  const list = items.filter(o => o && syncable(name, o.id));
  if (!list.length) return;
  await loadOutbox();
  for (const o of list) outbox[name + '\u0000' + o.id] = { store: name, id: o.id, updatedAt: o.updatedAt || Date.now(), deleted };
  await persistOutbox();
  window.dispatchEvent(new CustomEvent('store-changed', { detail: { store: name } }));
}
const stamp = (name, obj) => { if (obj && syncable(name, obj.id)) obj.updatedAt = Date.now(); return obj; };

export const store = {
  async all(name) { return tx(name, 'readonly', s => s.getAll()); },
  async get(name, id) { return tx(name, 'readonly', s => s.get(id)); },
  async put(name, obj) { stamp(name, obj); await tx(name, 'readwrite', s => s.put(obj)); await track(name, [obj]); return obj; },
  async remove(name, id) { await tx(name, 'readwrite', s => s.delete(id)); await track(name, [{ id, updatedAt: Date.now() }], true); },
  async clear(name) {
    const ids = (await this.all(name)).map(o => o.id);
    await tx(name, 'readwrite', s => s.clear());
    const t = Date.now();
    await track(name, ids.map(id => ({ id, updatedAt: t })), true);
  },
  async putMany(name, objs) { objs.forEach(o => stamp(name, o)); await tx(name, 'readwrite', s => { objs.forEach(o => s.put(o)); }); await track(name, objs); },

  async getSetting(key, fallback = null) {
    const row = await this.get('settings', key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    if (key.startsWith('local:')) return tx('settings', 'readwrite', s => s.put({ id: key, value }));   // nicht verfolgen
    return this.put('settings', { id: key, value });
  },

  // ── Schnittstelle für js/account.js ──
  /** Ausstehende lokale Änderungen inkl. aktueller Daten (für den Upload). */
  async pendingChanges() {
    const box = await loadOutbox();
    const out = [];
    for (const [key, c] of Object.entries(box)) {
      if (c.deleted) { out.push({ key, store: c.store, id: c.id, data: null, updatedAt: c.updatedAt, deleted: true }); continue; }
      const data = await this.get(c.store, c.id);
      if (data) out.push({ key, store: c.store, id: c.id, data, updatedAt: data.updatedAt || c.updatedAt, deleted: false });
      else delete box[key];
    }
    return out;
  },
  /** Bestätigte Änderungen aus dem Ausgang entfernen (nur, wenn seitdem nicht erneut geändert). */
  async ackChanges(sent) {
    const box = await loadOutbox();
    for (const c of sent) { const cur = box[c.key]; if (cur && cur.updatedAt <= c.updatedAt) delete box[c.key]; }
    await persistOutbox();
  },
  /** Alle lokalen Daten in den Ausgang legen (beim Anmelden: Gast-Daten ins Konto übernehmen). */
  async queueAll() {
    await loadOutbox();
    const now = Date.now();
    for (const name of STORES) {
      for (const o of await this.all(name)) {
        if (!syncable(name, o.id)) continue;
        const key = name + '\u0000' + o.id;
        if (!outbox[key]) outbox[key] = { store: name, id: o.id, updatedAt: o.updatedAt || now, deleted: false };
      }
    }
    await persistOutbox();
  },
  /** Ausgang leeren (z. B. nach dem Abmelden). */
  async resetOutbox() { outbox = {}; await persistOutbox(); },
  /** Änderungen vom Server übernehmen, ohne sie erneut in den Ausgang zu legen. Gibt die Anzahl zurück. */
  async applyRemote(changes) {
    const box = await loadOutbox();
    const apply = changes.filter(c => c && STORES.includes(c.store) && syncable(c.store, c.id) && !(box[c.store + '\u0000' + c.id]?.updatedAt > c.updatedAt));
    for (const name of STORES) {
      const mine = apply.filter(c => c.store === name);
      if (!mine.length) continue;
      await tx(name, 'readwrite', s => { for (const c of mine) { if (c.deleted || !c.data) s.delete(c.id); else s.put({ ...c.data, id: c.id, updatedAt: c.updatedAt }); } });
    }
    return apply.length;
  },
  /** Lokale Pflanzen/Wünsche löschen, ohne Löschungen zum Server zu schicken (Abmelden mit „Daten löschen“). */
  async wipeLocal() { for (const name of ['plants', 'wishlist']) await tx(name, 'readwrite', s => s.clear()); outbox = {}; await persistOutbox(); },

  /** Übernimmt Daten der ersten App-Version (localStorage) einmalig. */
  async migrateLegacy() {
    try {
      const raw = localStorage.getItem('pfl_v1');
      if (!raw) return 0;
      const plants = JSON.parse(raw);
      const existing = await this.all('plants');
      if (existing.length) { localStorage.removeItem('pfl_v1'); return 0; }
      for (const p of plants) {
        p.photo = localStorage.getItem('pfl_p_' + p.id) || p.photo || null;
        localStorage.removeItem('pfl_p_' + p.id);
      }
      await this.putMany('plants', plants);
      localStorage.removeItem('pfl_v1');
      return plants.length;
    } catch { return 0; }
  },

  /** Komplettes Backup als JSON (inkl. Fotos). Gerätespezifisches und Geheimes (Sitzungs-Token, Zugangscode, Ausgang) bleibt draußen. */
  async exportAll() {
    const [plants, wishlist, allSettings] = await Promise.all([this.all('plants'), this.all('wishlist'), this.all('settings')]);
    const settings = allSettings.filter(s => s && s.id && syncable('settings', s.id));
    return { app: 'pflanzenpflege', version: 2, exportedAt: new Date().toISOString(), plants, wishlist, settings };
  },

  /** Backup einspielen. mode = 'merge' (Standard) oder 'replace'. */
  async importAll(data, mode = 'merge') {
    if (!data || data.app !== 'pflanzenpflege' || !Array.isArray(data.plants)) throw new Error('Keine gültige Pflanzenpflege-Sicherung');
    if (mode === 'replace') { await this.clear('plants'); await this.clear('wishlist'); }
    await this.putMany('plants', data.plants.filter(p => p && p.id));
    if (Array.isArray(data.wishlist)) await this.putMany('wishlist', data.wishlist.filter(w => w && w.id));
    if (Array.isArray(data.settings)) await this.putMany('settings', data.settings.filter(s => s && s.id && syncable('settings', s.id)));
    return { plants: data.plants.length, wishlist: data.wishlist?.length || 0 };
  },
};
