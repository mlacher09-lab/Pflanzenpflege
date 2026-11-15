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
    base = (base || '').trim().replace(/\/+$/, '').replace(/\/api(\/analyze)?$/, '');
    token = (token || '').trim();
    // HTTP-Header erlauben nur Latin-1 – sonst scheitert fetch() und es sähe aus wie „nicht erreichbar“.
    if (/[^\x20-\xFF]/.test(token)) throw new Error('Der Zugangscode enthält Zeichen, die nicht übertragen werden können (z. B. €, Emoji). Bitte den Code auf dem Server ändern.');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    this.base = base; this.token = token;
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
      if (!res.ok) {
        this.status = 'error';
        const hint = [404, 405].includes(res.status) ? ' – unter dieser Adresse läuft kein Erkennungs-Server. Bitte die Vercel-Adresse der App als Server-Adresse eintragen.' : '';
        return { ok: false, reason: `HTTP ${res.status}${hint}` };
      }
      let data;
      try { data = await res.json(); } catch { this.status = 'error'; return { ok: false, reason: 'Antwort ist kein Erkennungs-Server (falsche Server-Adresse?)' }; }
      this.provider = data.provider || null;
      const tokenOk = data.tokenOk !== false;
      this.status = !data.configured ? 'none' : !tokenOk ? 'token' : 'ok';
      return { ...data, ok: !!data.configured && tokenOk, reason: !data.configured ? 'kein Schlüssel' : !tokenOk ? 'Zugangscode fehlt oder ist falsch' : undefined };
    } catch (e) {
      this.status = 'error';
      return { ok: false, reason: e.name === 'AbortError' ? 'Zeitüberschreitung' : this.base ? `${this.base} nicht erreichbar – Adresse prüfen` : 'Nicht erreichbar (offline?)' };
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
