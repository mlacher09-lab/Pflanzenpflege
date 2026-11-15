// Kalender-Export (.ics, RFC 5545): Gieß-/Düng-/Mähtermine der nächsten Wochen
import { PLANT_DB, season } from './plants-db.js';
import { today, addDays, daysDiff, esc, toast, seasonalWater, seasonalFert, hasMow } from './util.js';

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const KIND = {
  water: { icon: '💧', text: 'Gießen' },
  fert: { icon: '🌱', text: 'Düngen' },
  mow: { icon: '✂️', text: 'Mähen' },
};

export const icsEscape = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Zeile auf max. 75 Oktette falten (UTF-8-Zeichen bleiben ganz). */
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compact = iso => iso.replace(/-/g, '');
const utcStamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Fälligkeitstermine einer Pflanze für eine Art im Zeitraum [startISO, endISO). */
function dueDates(p, kind, startISO, endISO) {
  const out = [];
  const last = { water: p.lastWatered, fert: p.lastFertilized, mow: p.lastMowed }[kind];
  const custom = { water: p.waterInterval, fert: p.fertInterval, mow: p.mowInterval }[kind];
  const ivAt = d => {
    const s = season(parse(d));
    if (kind === 'water') return custom || (PLANT_DB[p.type]?.wpause?.includes(s) ? 0 : seasonalWater(p.type, s));
    if (kind === 'fert') return custom || seasonalFert(p.type, s);
    return hasMow(p) ? (custom || PLANT_DB[p.type].mow?.[s] || 0) : 0;
  };
  if (kind === 'mow' && !hasMow(p)) return out;
  let iv0 = ivAt(startISO);
  let d = last ? addDays(last, iv0 || ivAt(addDays(startISO, 30)) || 7) : startISO;
  if (daysDiff(startISO, d) < 0) d = startISO;
  let guard = 0;
  while (daysDiff(d, endISO) > 0 && guard++ < 500) {
    if (kind === 'fert' && p.lastRepotted) {
      const rp = PLANT_DB[p.type]?.rp ?? 42;
      const until = rp ? addDays(p.lastRepotted, rp) : null;
      if (until && daysDiff(d, until) > 0) { d = until; continue; }
    }
    const iv = ivAt(d);
    if (!iv) { d = addDays(d, 7); continue; }   // Pause: nach einer Woche erneut prüfen
    out.push(d);
    d = addDays(d, iv);
  }
  return out;
}

/** ICS-Text (CRLF) mit je einem ganztägigen Termin pro Tag und Art. */
export function buildICS(plants, { weeks = 8, kinds = ['water', 'fert'], startISO = today(), alarm = true, now = new Date() } = {}) {
  const endISO = addDays(startISO, weeks * 7);
  const groups = new Map();
  for (const kind of kinds) {
    if (!KIND[kind]) continue;
    for (const p of plants) {
      for (const d of dueDates(p, kind, startISO, endISO)) {
        const k = `${d}|${kind}`;
        if (!groups.has(k)) groups.set(k, { d, kind, names: [] });
        groups.get(k).names.push(p.nickname || p.type || 'Pflanze');
      }
    }
  }
  const order = Object.keys(KIND);
  const events = [...groups.values()].sort((a, b) => a.d.localeCompare(b.d) || order.indexOf(a.kind) - order.indexOf(b.kind));
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pflanzenpflege//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Pflanzenpflege'];
  const stamp = utcStamp(now);
  for (const e of events) {
    const k = KIND[e.kind];
    L.push('BEGIN:VEVENT',
      `UID:${compact(e.d)}-${e.kind}@pflanzenpflege`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.d)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.d, 1))}`,
      `SUMMARY:${icsEscape(`${k.icon} ${k.text}: ${e.names.join(', ')}`)}`,
      'TRANSP:TRANSPARENT');
    if (alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`${k.text}: ${e.names.join(', ')}`)}`, 'TRIGGER:PT9H', 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

let dlg, ctx, file;

function selectedOpts() {
  return {
    weeks: +dlg.querySelector('#ics-weeks').value,
    kinds: [...dlg.querySelectorAll('.ics-kind:checked')].map(c => c.value),
  };
}
function prepare() {
  const opts = selectedOpts();
  const text = buildICS(ctx.getPlants(), opts);
  file = new File([text], 'pflanzenpflege.ics', { type: 'text/calendar' });
  const n = (text.match(/BEGIN:VEVENT/g) || []).length;
  dlg.querySelector('#ics-count').textContent = n ? `${n} Termine im Export.` : 'Keine Termine – bitte Auswahl prüfen.';
  const ok = n > 0;
  dlg.querySelector('#ics-dl').disabled = !ok;
  const sh = dlg.querySelector('#ics-share');
  sh.disabled = !ok;
  sh.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
}
function build() {
  dlg = document.createElement('dialog');
  dlg.id = 'ical-dialog';
  dlg.setAttribute('aria-labelledby', 'ical-title');
  dlg.innerHTML = `
    <div class="modal-header"><div><span class="modal-title" id="ical-title">📅 Kalender-Export</span><div class="muted">Termine für Kalender-Apps (.ics)</div></div><button class="close-btn" type="button" aria-label="Schließen">✕</button></div>
    <div class="modal-body">
      <fieldset class="ics-fieldset"><legend class="section-title">Was exportieren?</legend>
        <label class="ics-opt"><input type="checkbox" class="ics-kind" value="water" checked> 💧 Gießen</label>
        <label class="ics-opt"><input type="checkbox" class="ics-kind" value="fert" checked> 🌱 Düngen</label>
        <label class="ics-opt" id="ics-mow-wrap" hidden><input type="checkbox" class="ics-kind" value="mow"> ✂️ Mähen</label>
      </fieldset>
      <div class="form-group"><label for="ics-weeks">Zeitraum</label>
        <select id="ics-weeks"><option value="4">4 Wochen</option><option value="8" selected>8 Wochen</option><option value="12">12 Wochen</option></select></div>
      <p class="muted">Einmaliger Export – bei Änderungen (z. B. nach dem Gießen) erneut exportieren.</p>
      <p class="muted" id="ics-count" aria-live="polite"></p>
    </div>
    <div class="modal-footer"><button class="btn-primary" type="button" id="ics-dl">Herunterladen (.ics)</button><button class="btn-ghost" type="button" id="ics-share" hidden>Teilen</button></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.close-btn').onclick = () => dlg.close();
  dlg.addEventListener('change', prepare);
  dlg.querySelector('#ics-dl').onclick = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Kalenderdatei erstellt');
  };
  // Datei ist bereits vorbereitet, damit navigator.share direkt im Klick (User-Geste) startet
  dlg.querySelector('#ics-share').onclick = () => {
    navigator.share({ files: [file], title: 'Pflanzenpflege-Kalender' }).catch(err => { if (err?.name !== 'AbortError') toast('Teilen nicht möglich', 'error'); });
  };
}
export function openICalExport({ getPlants }) {
  ctx = { getPlants };
  if (!dlg) build();
  dlg.querySelector('#ics-mow-wrap').hidden = !getPlants().some(hasMow);
  prepare();
  dlg.showModal();
}
