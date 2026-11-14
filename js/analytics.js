// Anonyme Nutzungsstatistik: sammelt Ereignisse, sendet sie gebündelt an /api/event.
// Keine Fotos, keine Namen, keine Notizen – nur Ereignistyp und wenige Eigenschaften.
// Nur mit Einwilligung (Abfrage beim ersten Start); änderbar unter „Mehr → Nutzungsstatistik & Cookies“.
import { store } from './store.js';
import { api } from './api.js';

const QUEUE_KEY = 'pfl_events';
const MAX_QUEUE = 200;

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'other';
}
function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* egal */ } }

export const analytics = {
  enabled: false,
  needsConsent: false,  // true, solange beim ersten Start noch keine Entscheidung getroffen wurde
  pending: [],          // Ereignisse vor der Entscheidung – nur im Arbeitsspeicher, nie gesendet ohne Einwilligung
  clientId: null,
  version: '',
  queue: [],
  serverOk: null, // null = unbekannt, false = keine Statistik auf dem Server
  timer: null,

  async init(version) {
    this.version = version;
    let consent = await store.getSetting('analyticsConsent');
    if (consent == null && (await store.getSetting('analytics')) === false) { consent = 'denied'; await store.setSetting('analyticsConsent', consent); } // früher abgeschaltet
    this.needsConsent = consent == null;
    this.enabled = consent === 'granted';
    if (this.enabled) await this.ensureId();
    this.queue = this.enabled ? loadQueue() : [];
    if (!this.enabled) saveQueue([]);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(true); });
    window.addEventListener('pagehide', () => this.flush(true));
    setInterval(() => this.flush(), 30000);
    if (this.queue.length) setTimeout(() => this.flush(), 1500);
  },
  async ensureId() {
    this.clientId = await store.getSetting('clientId');
    if (!this.clientId) { this.clientId = crypto.randomUUID().replace(/-/g, '').slice(0, 24); await store.setSetting('clientId', this.clientId); }
  },
  /** Einwilligung erteilen oder widerrufen. */
  async setConsent(on) {
    this.enabled = !!on;
    this.needsConsent = false;
    await store.setSetting('analyticsConsent', on ? 'granted' : 'denied');
    await store.setSetting('analytics', this.enabled);
    if (on) {
      await this.ensureId();
      this.queue.push(...this.pending); saveQueue(this.queue);
      if (this.queue.length) setTimeout(() => this.flush(), 1500);
    } else {
      this.queue = []; saveQueue([]);
      this.clientId = null; await store.setSetting('clientId', null);   // Kennung bei Widerruf verwerfen
    }
    this.pending = [];
  },
  async resetId() {
    if (!this.enabled) return;
    this.clientId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    await store.setSetting('clientId', this.clientId);
  },

  track(type, props = {}) {
    if (this.needsConsent) { if (this.pending.length < 20) this.pending.push({ t: type, ts: Date.now(), p: props }); return; }
    if (!this.enabled || this.serverOk === false) return;
    this.queue.push({ t: type, ts: Date.now(), p: props });
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE);
    saveQueue(this.queue);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 4000);
  },

  async flush(useBeacon = false) {
    if (!this.enabled || !this.queue.length || this.serverOk === false) return;
    if (this.serverOk === null && !useBeacon) {
      // Erst prüfen, ob der Server eine Statistik-Datenbank hat – vermeidet Fehlermeldungen in der Konsole
      try {
        const h = await fetch(api.url('/api/event'), { method: 'GET' });
        const d = h.ok ? await h.json() : null;
        if (!d || !d.configured) { this.serverOk = false; this.queue = []; saveQueue([]); return; }
        this.serverOk = true;
      } catch { return; }
    }
    if (this.serverOk !== true && useBeacon) return;
    const batch = this.queue.slice(0, 50);
    const payload = JSON.stringify({ client: this.clientId, v: this.version, platform: platform(), events: batch });
    const url = api.url('/api/event');
    if (useBeacon && navigator.sendBeacon) {
      if (navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))) { this.queue = this.queue.slice(batch.length); saveQueue(this.queue); }
      return;
    }
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
      if (res.status === 503 || res.status === 404) { this.serverOk = false; this.queue = []; saveQueue([]); return; }
      if (res.ok) { this.serverOk = true; this.queue = this.queue.slice(batch.length); saveQueue(this.queue); if (this.queue.length) this.flush(); }
    } catch { /* offline – bleibt in der Warteschlange */ }
  },
};
