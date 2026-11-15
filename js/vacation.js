// Urlaubsmodus: Wer muss vor der Reise gegossen werden, wer hält durch, wer braucht Hilfe?
import { PLANT_DB, season } from './plants-db.js';
import { today, addDays, daysDiff, esc, toast, waterInterval, seasonalWater, hasMow, mowInterval } from './util.js';

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** „Mo, 24.11." */
export function fmtShort(iso) {
  const d = parse(iso);
  return `${WD[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}
const label = p => p.nickname || p.type || 'Pflanze';

/** Gießintervall zu Reisebeginn (eigenes Intervall, sonst Standard der Jahreszeit am Starttag); 0 = Winterpause. */
function waterIntervalAt(p, startISO) {
  if (p.waterInterval) return p.waterInterval;
  const s = season(parse(startISO));
  if (PLANT_DB[p.type]?.wpause?.includes(s)) return 0;
  return seasonalWater(p.type, s);
}

/**
 * Reiseplan berechnen (rein, ohne DOM).
 * @returns {{start,end,before:[],hold:[],help:[{plant,water:string[],mow:string[]}],days:number}}
 * before = vor der Abreise gießen (am Abreisetag), hold = hält durch, help = Gießer/in nötig (Daten in water/mow).
 * Eine Pflanze kann in before UND help stehen (vor Abreise gießen, aber Reise zu lang).
 */
export function planVacation(plants, startISO, endISO) {
  const before = [], hold = [], help = [];
  for (const p of plants) {
    const iv = waterIntervalAt(p, startISO);
    let water = [], needBefore = false;
    if (iv > 0) {
      const next = p.lastWatered ? addDays(p.lastWatered, iv) : startISO;
      needBefore = daysDiff(startISO, next) <= 2;
      let d = needBefore ? addDays(startISO, iv) : next;
      while (daysDiff(d, endISO) > 0) { water.push(d); d = addDays(d, iv); }
    }
    let mow = [];
    if (hasMow(p)) {
      const mi = p.mowInterval || PLANT_DB[p.type].mow?.[season(parse(startISO))] || 0;
      if (mi > 0) {
        let d = p.lastMowed ? addDays(p.lastMowed, mi) : startISO;
        if (daysDiff(startISO, d) < 0) d = startISO;
        while (daysDiff(d, endISO) > 0) { mow.push(d); d = addDays(d, mi); }
      }
    }
    if (needBefore) before.push(p);
    if (water.length || mow.length) help.push({ plant: p, water, mow });
    else if (!needBefore) hold.push(p);
  }
  return { start: startISO, end: endISO, before, hold, help, days: Math.max(0, daysDiff(startISO, endISO)) };
}

/** Plan pro Datum: [{date, water:[plant], mow:[plant]}] sortiert. */
export function byDate(plan) {
  const m = new Map();
  for (const h of plan.help) {
    for (const d of h.water) (m.get(d) || m.set(d, { date: d, water: [], mow: [] }).get(d)).water.push(h.plant);
    for (const d of h.mow) (m.get(d) || m.set(d, { date: d, water: [], mow: [] }).get(d)).mow.push(h.plant);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const where = p => p.room ? ` (${p.room})` : '';

/** Textanleitung für die Gießvertretung. */
export function buildGuide(plan, plants = plan.help.map(h => h.plant)) {
  const L = [`Pflanzenpflege während meiner Abwesenheit`, `Zeitraum: ${fmtShort(plan.start)} bis ${fmtShort(plan.end)}`, ''];
  const dates = byDate(plan);
  if (!dates.length) L.push('Alle Pflanzen kommen ohne Hilfe zurecht – es ist nichts zu tun. Danke fürs Nachschauen!', '');
  else {
    L.push('Wann was zu tun ist:');
    for (const d of dates) {
      L.push(`${fmtShort(d.date)}`);
      if (d.water.length) L.push(`  Gießen: ${d.water.map(p => label(p) + where(p)).join(', ')}`);
      if (d.mow.length) L.push(`  Mähen: ${d.mow.map(p => label(p) + where(p)).join(', ')}`);
    }
    L.push('');
  }
  const seen = new Set(), hints = [];
  for (const p of plants) {
    if (seen.has(p.id ?? p)) continue; seen.add(p.id ?? p);
    const tips = (PLANT_DB[p.type]?.tips || []).slice(0, 2);
    const parts = [...tips, ...(p.notes ? [`Notiz: ${p.notes}`] : [])];
    if (parts.length) hints.push(`- ${label(p)}${where(p)}: ${parts.join('; ')}`);
  }
  if (hints.length) L.push('Hinweise zu einzelnen Pflanzen:', ...hints, '');
  L.push('Allgemeine Tipps:',
    '- Erst mit dem Finger prüfen: Ist die oberste Erdschicht trocken, gießen. Im Zweifel lieber etwas weniger.',
    '- Durchdringend gießen, bis Wasser unten austritt, und den Untersetzer nach einer Viertelstunde leeren.',
    '- Zimmertemperatur-Wasser verwenden, nicht auf die Blätter gießen.',
    '- Kakteen und Sukkulenten nur sparsam gießen.', '', 'Vielen Dank!');
  return L.join('\n');
}

const DIY = [
  ['Docht-Bewässerung', 'Eine Wollschnur oder Baumwollkordel (ca. 5 mm) mit einem Ende 5–10 cm tief in die Erde stecken, das andere in ein hoch gestelltes, mit Wasser gefülltes Glas hängen. Die Pflanze zieht sich, was sie braucht.'],
  ['PET-Flasche kopfüber', 'Kleine Löcher in den Deckel stechen, Flasche mit Wasser füllen, verschließen und kopfüber in die Erde stecken. Vorher ausprobieren: Je kleiner die Löcher, desto langsamer fließt es.'],
  ['Badewanne oder Spüle', 'Für viele Pflanzen: Nasse Handtücher auf den Boden legen, Töpfe daraufstellen und einen Streifen Stoff ins Wasser ziehen lassen. Nur mit Abzugsloch und hellem Fenster.'],
  ['Tonkegel / Bewässerungskugeln', 'Tonkegel auf eine Wasserflasche stecken oder Glaskugeln füllen und in die Erde setzen. Sie geben das Wasser langsam und gleichmäßig ab.'],
];
const VIDEO_URL = 'https://www.youtube.com/results?search_query=Pflanzen+Selbstbew%C3%A4sserung+DIY+Urlaub';

let dlg, ctx, lastPlan, lastGuide;

function build() {
  dlg = document.createElement('dialog');
  dlg.id = 'vacation-dialog';
  dlg.setAttribute('aria-labelledby', 'vacation-title');
  dlg.className = 'vacation-dialog';
  dlg.innerHTML = `
    <div class="modal-header"><div><span class="modal-title" id="vacation-title">🧳 Urlaubsmodus</span><div class="muted">Wer überlebt die Reise – und wer braucht Hilfe?</div></div><button class="close-btn" type="button" aria-label="Schließen">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label for="vac-start">Abreise</label><input type="date" id="vac-start"></div>
        <div class="form-group"><label for="vac-end">Rückkehr</label><input type="date" id="vac-end"></div>
      </div>
      <div id="vac-result" aria-live="polite"></div>
      <div class="section-title">Ohne Hilfe verreisen? Selbstbewässerung DIY</div>
      <div class="list-card vac-diy">${DIY.map(([t, x]) => `<div class="list-item" style="cursor:default"><span class="li-text"><strong>${esc(t)}</strong><div class="li-sub">${esc(x)}</div></span></div>`).join('')}</div>
      <p><a href="${VIDEO_URL}" target="_blank" rel="noopener">Video-Anleitungen: Selbstbewässerung DIY (YouTube)</a></p>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.close-btn').onclick = () => dlg.close();
  dlg.querySelector('#vac-start').onchange = render;
  dlg.querySelector('#vac-end').onchange = render;
}

const list = (arr, fn) => `<div class="list-card">${arr.map(fn).join('')}</div>`;
const row = (p, sub) => `<div class="list-item" style="cursor:default"><span class="li-text">${esc(label(p))}${p.room ? ` <span class="muted">· ${esc(p.room)}</span>` : ''}${sub ? `<div class="li-sub">${esc(sub)}</div>` : ''}</span></div>`;

function render() {
  const s = dlg.querySelector('#vac-start').value, e = dlg.querySelector('#vac-end').value;
  const out = dlg.querySelector('#vac-result');
  if (!s || !e || daysDiff(s, e) < 1) { out.innerHTML = '<p class="muted">Bitte Abreise und eine spätere Rückkehr wählen.</p>'; lastPlan = null; return; }
  const plan = lastPlan = planVacation(ctx.getPlants(), s, e);
  lastGuide = buildGuide(plan);
  const sec = (t, n, body) => `<div class="section-title">${t} (${n})</div>${n ? body : '<p class="muted">Keine.</p>'}`;
  out.innerHTML = `<p class="muted">${plan.days} Tage Abwesenheit. Düngen kann in dieser Zeit warten.</p>`
    + sec('💧 Vor der Abreise gießen', plan.before.length, list(plan.before, p => row(p)))
    + `<button class="btn-primary" type="button" id="vac-watered" ${plan.before.length ? '' : 'disabled'}>Vor der Abreise gegossen</button>`
    + sec('✅ Hält durch', plan.hold.length, list(plan.hold, p => row(p)))
    + sec('🆘 Braucht Hilfe während der Reise', plan.help.length, list(plan.help, h => row(h.plant,
        [h.water.length ? 'Gießen: ' + h.water.map(fmtShort).join(', ') : '', h.mow.length ? 'Mähen: ' + h.mow.map(fmtShort).join(', ') : ''].filter(Boolean).join(' · '))))
    + `<div class="modal-footer vac-actions"><button class="btn-ghost" type="button" id="vac-share">Pflegeanleitung teilen</button><button class="btn-ghost" type="button" id="vac-print">Drucken</button></div>`;
  out.querySelector('#vac-watered').onclick = async () => { await ctx.markWatered(plan.before.map(p => p.id)); render(); };
  out.querySelector('#vac-share').onclick = shareGuide;
  out.querySelector('#vac-print').onclick = printGuide;
}

async function shareGuide() {
  if (!lastGuide) return;
  const title = 'Pflanzenpflege während meiner Abwesenheit';
  try {
    if (navigator.share) { await navigator.share({ title, text: lastGuide }); return; }
    await navigator.clipboard.writeText(lastGuide);
    toast('Pflegeanleitung in die Zwischenablage kopiert');
  } catch (err) { if (err?.name !== 'AbortError') toast('Teilen nicht möglich', 'error'); }
}
function printGuide() {
  if (!lastGuide) return;
  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blockiert', 'error'); return; }
  w.document.write(`<!doctype html><html lang="de"><meta charset="utf-8"><title>Pflegeanleitung</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:2em auto;padding:0 1em}pre{white-space:pre-wrap;font:inherit}</style><pre>${esc(lastGuide)}</pre>`);
  w.document.close(); w.focus(); w.print();
}

export function openVacation({ getPlants, markWatered }) {
  ctx = { getPlants, markWatered };
  if (!dlg) build();
  const t = today();
  dlg.querySelector('#vac-start').value = addDays(t, 1);
  dlg.querySelector('#vac-end').value = addDays(t, 8);
  render();
  dlg.showModal();
}
