// Kleine Helfer: Datum, Status, Bilder, Toasts, HTML-Escaping
import { PLANT_DB, season, SEASON_NAME } from './plants-db.js';
import { PLANT_IMAGES } from './plant-images.js';

/** Pfad zum Datenbank-Bild einer Pflanzenart (Wikimedia Commons, lokal gespeichert) oder null. */
export function plantImg(type) { const i = PLANT_IMAGES[type]; return i ? `img/plants/${i.f}` : null; }
export function plantImgCredit(type) { return PLANT_IMAGES[type] || null; }

/** Kleinbuchstaben ohne Akzente/Umlaute-Punkte – damit „glucks“ auch „Glückskastanie“ findet. */
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');

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

const VERB_DO = { gegossen: 'gießen', gedüngt: 'düngen', gemäht: 'mähen' };
function status(last, interval, verb) {
  const act = VERB_DO[verb] || verb;
  if (!last) return { cls: 'soon', text: `Noch nie ${verb}`, days: -999 };
  const next = addDays(last, interval);
  const diff = daysDiff(today(), next);
  if (diff < 0) return { cls: 'overdue', text: `${-diff} Tag${-diff === 1 ? '' : 'e'} überfällig`, days: diff, next };
  if (diff === 0) return { cls: 'soon', text: `Heute ${act}!`, days: 0, next };
  if (diff === 1) return { cls: 'soon', text: `Morgen ${act}`, days: 1, next };
  return { cls: 'ok', text: `In ${diff} Tagen ${act}`, days: diff, next };
}

/** Düngepause nach dem Umtopfen (frische Erde ist vorgedüngt): { until, left } oder null. */
export function repotPause(p) {
  if (!p.lastRepotted) return null;
  const rp = PLANT_DB[p.type]?.rp ?? 42;
  if (!rp) return null;
  const until = addDays(p.lastRepotted, rp);
  const left = daysDiff(today(), until);
  return left > 0 ? { until, left, days: rp } : null;
}
export const waterPaused = p => !p.waterInterval && !!PLANT_DB[p.type]?.wpause?.includes(season());
export const waterStatus = p => waterPaused(p) ? { cls: 'ok', text: `${currentSeasonName()}pause – nicht gießen`, days: 9999 } : status(p.lastWatered, waterInterval(p), 'gegossen');
export function fertStatus(p) {
  if (fertInterval(p) === 0) return { cls: 'ok', text: fertSeasonPaused(p) ? `${currentSeasonName()}pause – nicht düngen` : 'Kein Dünger nötig', days: 9999 };
  const rp = repotPause(p);
  if (rp) return { cls: 'ok', text: `Umtopfpause – ab ${fmtDate(rp.until)} düngen`, days: rp.left, next: rp.until, repot: true };
  return status(p.lastFertilized, fertInterval(p), 'gedüngt');
}

/** Mähintervall (nur Rasen) in der aktuellen Jahreszeit; 0 = keine Mäh-Erinnerung. */
export const hasMow = p => !!PLANT_DB[p.type]?.mow;
export function mowInterval(p, s = season()) { return hasMow(p) ? (p.mowInterval || PLANT_DB[p.type].mow[s] || 0) : 0; }
export function mowStatus(p) {
  if (!hasMow(p)) return null;
  if (!mowInterval(p)) return { cls: 'ok', text: `${currentSeasonName()}: nicht mähen`, days: 9999 };
  return status(p.lastMowed, mowInterval(p), 'gemäht');
}
// ─── Umtopf- und Ableger-Erinnerungen (in der App; Push nur nach Auswahl) ───
// Datenfelder in plants-db.js: ry = umtopfen alle N Jahre (0 = nie), prop = { months:[1–12], how:"…" }
const DAY_MS = 86400000;
/** Umtopfen fällig? { due, next, years } – Bezug: letztes Umtopfen, sonst Hinzufügedatum. null = keine Erinnerung. */
export function repotDue(p) {
  const ry = PLANT_DB[p.type]?.ry;
  if (!ry) return null;
  const base = p.lastRepotted || p.addedAt;
  if (!base) return null;
  const [y, m, d] = base.split('-').map(Number);
  const next = `${y + ry}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Umtopfen ist im Frühjahr am besten – fällig ab Erreichen des Datums, Hinweis nur März bis Juni
  const due = daysDiff(today(), next) <= 0;
  const month = new Date().getMonth() + 1;
  return { due: due && month >= 3 && month <= 6, overdueOutOfSeason: due && !(month >= 3 && month <= 6), next, years: ry };
}
/** Gute Zeit für Ableger? { how } im passenden Monat, sonst null. */
export function propagationNow(p, month = new Date().getMonth() + 1) {
  const pr = PLANT_DB[p.type]?.prop;
  return pr && pr.months?.includes(month) ? { how: pr.how || '' } : null;
}

export function urgencyClass(p) {
  const all = [waterStatus(p), fertStatus(p), mowStatus(p)].filter(Boolean);
  if (all.some(x => x.cls === 'overdue')) return 'overdue';
  if (all.some(x => x.cls === 'soon')) return 'soon';
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
