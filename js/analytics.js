// Anonyme Nutzungsstatistik: sammelt Ereignisse, sendet sie gebündelt an /api/event.
// Keine Fotos, keine Namen, keine Notizen – nur Ereignistyp und wenige Eigenschaften. Abschaltbar unter „Mehr“.
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
  enabled: true,
  clientId: null,
  version: '',
  queue: [],
  serverOk: null, // null = unbekannt, false = keine Statistik auf dem Server
  timer: null,

  async init(version) {
    this.version = version;
    this.enabled = (await store.getSetting('analytics', true)) !== false;
    this.clientId = await store.getSetting('clientId');
    if (!this.clientId) { this.clientId = crypto.randomUUID().replace(/-/g, '').slice(0, 24); await store.setSetting('clientId', this.clientId); }
    this.queue = loadQueue();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(true); });
    window.addEventListener('pagehide', () => this.flush(true));
    setInterval(() => this.flush(), 30000);
    if (this.queue.length) setTimeout(() => this.flush(), 1500);
  },
  async setEnabled(on) {
    this.enabled = !!on;
    await store.setSetting('analytics', this.enabled);
    if (!on) { this.queue = []; saveQueue([]); }
  },
  async resetId() {
    this.clientId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    await store.setSetting('clientId', this.clientId);
  },

  track(type, props = {}) {
    if (!this.enabled || this.serverOk === false) return;
    this.queue.push({ t: type, ts: Date.now(), p: props });
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE);
    saveQueue(this.queue);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 4000);
  },

  async flush(useBeacon = false) {
    if (!this.enabled || !this.queue.length || this.serverOk === false) return;
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
