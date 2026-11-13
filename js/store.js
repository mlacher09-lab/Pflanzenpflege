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

export const store = {
  async all(name) { return tx(name, 'readonly', s => s.getAll()); },
  async get(name, id) { return tx(name, 'readonly', s => s.get(id)); },
  async put(name, obj) { await tx(name, 'readwrite', s => s.put(obj)); return obj; },
  async remove(name, id) { return tx(name, 'readwrite', s => s.delete(id)); },
  async clear(name) { return tx(name, 'readwrite', s => s.clear()); },
  async putMany(name, objs) { return tx(name, 'readwrite', s => { objs.forEach(o => s.put(o)); }); },

  async getSetting(key, fallback = null) {
    const row = await this.get('settings', key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) { return this.put('settings', { id: key, value }); },

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

  /** Komplettes Backup als JSON (inkl. Fotos). */
  async exportAll() {
    const [plants, wishlist, settings] = await Promise.all([this.all('plants'), this.all('wishlist'), this.all('settings')]);
    return { app: 'pflanzenpflege', version: 2, exportedAt: new Date().toISOString(), plants, wishlist, settings };
  },

  /** Backup einspielen. mode = 'merge' (Standard) oder 'replace'. */
  async importAll(data, mode = 'merge') {
    if (!data || data.app !== 'pflanzenpflege' || !Array.isArray(data.plants)) throw new Error('Keine gültige Pflanzenpflege-Sicherung');
    if (mode === 'replace') { await this.clear('plants'); await this.clear('wishlist'); }
    await this.putMany('plants', data.plants.filter(p => p && p.id));
    if (Array.isArray(data.wishlist)) await this.putMany('wishlist', data.wishlist.filter(w => w && w.id));
    if (Array.isArray(data.settings)) await this.putMany('settings', data.settings.filter(s => s && s.id && s.id !== 'apiBase' && s.id !== 'appToken'));
    return { plants: data.plants.length, wishlist: data.wishlist?.length || 0 };
  },
};
