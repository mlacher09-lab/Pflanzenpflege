// Verbindung zur Server-Funktion /api/analyze (Pflanzenerkennung & Gesundheitscheck).
// Der KI-Schlüssel liegt nur auf dem Server – die App sendet lediglich das Foto.
import { store } from './store.js';

export const api = {
  base: '',
  token: '',
  status: 'unknown', // unknown | ok | none | token | error
  provider: null,

  async load() {
    this.base = (await store.getSetting('apiBase', '')) || '';
    this.token = (await store.getSetting('appToken', '')) || '';
  },
  async save(base, token) {
    this.base = (base || '').trim().replace(/\/+$/, '');
    this.token = (token || '').trim();
    await store.setSetting('apiBase', this.base);
    await store.setSetting('appToken', this.token);
  },
  url(path) { return (this.base || '') + path; },
  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['x-app-token'] = this.token;
    return h;
  },

  /** Prüft, ob ein Erkennungs-Server erreichbar und konfiguriert ist. */
  async health() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(this.url('/api/analyze'), { method: 'GET', headers: this.headers(), signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { this.status = 'error'; return { ok: false, reason: `HTTP ${res.status}` }; }
      const data = await res.json();
      this.provider = data.provider || null;
      const tokenOk = data.tokenOk !== false;
      this.status = !data.configured ? 'none' : !tokenOk ? 'token' : 'ok';
      return { ...data, ok: !!data.configured && tokenOk, reason: !data.configured ? 'kein Schlüssel' : !tokenOk ? 'Zugangscode fehlt oder ist falsch' : undefined };
    } catch (e) {
      this.status = 'error';
      return { ok: false, reason: e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Nicht erreichbar' };
    }
  },

  /**
   * mode = 'identify' | 'diagnose'
   * image: Data-URL (JPEG), context: { type, sci, nickname, room, light }
   */
  async analyze({ mode, image, context = {} }) {
    const res = await fetch(this.url('/api/analyze'), {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ mode, image, context }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* leer */ }
    if (!res.ok) {
      const msg = data?.error || `Server antwortete mit HTTP ${res.status}`;
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return data;
  },
};
