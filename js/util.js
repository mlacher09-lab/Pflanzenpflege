// Kleine Helfer: Datum, Status, Bilder, Toasts, HTML-Escaping
import { PLANT_DB, season, SEASON_NAME } from './plants-db.js';
import { PLANT_IMAGES } from './plant-images.js';

/** Pfad zum Datenbank-Bild einer Pflanzenart (Wikimedia Commons, lokal gespeichert) oder null. */
export function plantImg(type) { const i = PLANT_IMAGES[type]; return i ? `img/plants/${i.f}` : null; }
export function plantImgCredit(type) { return PLANT_IMAGES[type] || null; }

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function daysDiff(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
export function fmtDate(s) {
  if (!s) return '–';
  const diff = daysDiff(today(), s);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  if (diff > 1 && diff < 7) return `in ${diff} Tagen`;
  if (diff < 0 && diff > -7) return `vor ${-diff} Tagen`;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

// Saisonale Anpassung der Standard-Intervalle (Faktor auf die Tage; 0 = Pause).
// Abgestimmt auf die Saisontipps in plants-db.js: im Sommer öfter, im Herbst/Winter seltener gießen,
// im Winter nicht düngen. Eigene Intervalle (p.waterInterval / p.fertInterval) bleiben unverändert.
const WATER_FACTOR = {
  drought:   { spring: 1, summer: 0.85, autumn: 1.3,  winter: 2 },
  moisture:  { spring: 1, summer: 0.8,  autumn: 1.2,  winter: 1.4 },
  flowering: { spring: 1, summer: 0.8,  autumn: 1.25, winter: 1.5 },
  foliage:   { spring: 1, summer: 0.85, autumn: 1.25, winter: 1.5 },
};
const FERT_FACTOR = { spring: 1, summer: 1, autumn: 2, winter: 0 };
const scale = (days, factor) => Math.max(1, Math.round(days * factor));

/** Standard-Gießintervall einer Art in der aktuellen (oder angegebenen) Jahreszeit. */
export function seasonalWater(type, s = season()) {
  const db = PLANT_DB[type];
  const base = db?.w || 7;
  return scale(base, WATER_FACTOR[db?.cat || 'foliage']?.[s] ?? 1);
}
/** Standard-Düngeintervall einer Art in der aktuellen Jahreszeit; 0 = nicht düngen. */
export function seasonalFert(type, s = season()) {
  const f = PLANT_DB[type]?.f;
  const base = f == null ? 14 : f;
  if (base === 0 || FERT_FACTOR[s] === 0) return 0;
  return scale(base, FERT_FACTOR[s]);
}
/** true, wenn die Düngung nur wegen der Jahreszeit pausiert (nicht grundsätzlich unnötig). */
export function fertSeasonPaused(p) {
  if (p.fertInterval) return false;
  const f = PLANT_DB[p.type]?.f;
  return (f == null || f > 0) && seasonalFert(p.type) === 0;
}
export const currentSeasonName = () => SEASON_NAME[season()];

export function waterInterval(p) { return p.waterInterval || seasonalWater(p.type); }
export function fertInterval(p)  { return p.fertInterval || seasonalFert(p.type); }

function status(last, interval, verb) {
  if (!last) return { cls: 'soon', text: `Noch nie ${verb}`, days: -999 };
  const next = addDays(last, interval);
  const diff = daysDiff(today(), next);
  if (diff < 0) return { cls: 'overdue', text: `${-diff} Tag${-diff === 1 ? '' : 'e'} überfällig`, days: diff, next };
  if (diff === 0) return { cls: 'soon', text: `Heute ${verb === 'gegossen' ? 'gießen' : 'düngen'}!`, days: 0, next };
  if (diff === 1) return { cls: 'soon', text: `Morgen ${verb === 'gegossen' ? 'gießen' : 'düngen'}`, days: 1, next };
  return { cls: 'ok', text: `In ${diff} Tagen ${verb === 'gegossen' ? 'gießen' : 'düngen'}`, days: diff, next };
}
export const waterStatus = p => status(p.lastWatered, waterInterval(p), 'gegossen');
export const fertStatus  = p => fertInterval(p) === 0 ? { cls: 'ok', text: fertSeasonPaused(p) ? `${currentSeasonName()}pause – nicht düngen` : 'Kein Dünger nötig', days: 9999 } : status(p.lastFertilized, fertInterval(p), 'gedüngt');
export function urgencyClass(p) {
  const w = waterStatus(p), f = fertStatus(p);
  if (w.cls === 'overdue' || f.cls === 'overdue') return 'overdue';
  if (w.cls === 'soon' || f.cls === 'soon') return 'soon';
  return 'ok';
}

/** Bild verkleinern und als JPEG-Data-URL zurückgeben. */
export function compressImage(fileOrBlob, max = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > h && w > max) { h = h * max / w; w = max; } else if (h > max) { w = w * max / h; h = max; }
      const c = document.createElement('canvas');
      c.width = Math.round(w); c.height = Math.round(h);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}
export function dataURLtoBlob(dataURL) {
  const [head, data] = dataURL.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function toast(msg, type = '') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** Einfaches Markdown (fett, Listen, Absätze) → HTML, mit Escaping. */
export function miniMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s*(.+)$/gm, '<strong>$1</strong>')
    .replace(/^\s*[-•*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

export function confirmDialog(message, { okText = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    const dlg = document.getElementById('confirm-dialog');
    dlg.querySelector('.confirm-msg').textContent = message;
    const ok = dlg.querySelector('.confirm-ok');
    ok.textContent = okText;
    ok.className = danger ? 'btn-danger confirm-ok' : 'btn-primary confirm-ok';
    const done = v => { dlg.close(); ok.onclick = null; dlg.querySelector('.confirm-cancel').onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    dlg.querySelector('.confirm-cancel').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}
