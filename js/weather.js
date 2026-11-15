// Regen- und Frosthinweis für Balkon- und Gartenpflanzen (opt-in, Open-Meteo, ohne API-Key).
// Es werden nur gerundete Koordinaten (2 Nachkommastellen ≈ 1 km) übertragen. Wetterdaten sind Vorhersagen.
import { PLANT_DB } from './plants-db.js';
import { waterStatus, today, addDays, esc, toast } from './util.js';

// ─── Schwellwerte ───
export const RAIN_PAST_MM = 4;        // Regen seit gestern (bzw. seit letztem Gießen), ab dem Gießen entfällt
export const RAIN_FORECAST_MM = 5;    // angesagter Regen für morgen, ab dem Gießen warten kann
export const FROST_DEFAULT_C = 2;     // Warnschwelle (Nachttiefstwert), wenn die Art keinen tmin hat
export const FROST_SENSITIVE_MIN = -5;// nur Arten mit tmin > -5 °C gelten als frostempfindlich
export const CACHE_MS = 3 * 3600e3;   // Wetter-Cache: 3 Stunden
export const FETCH_TIMEOUT_MS = 6000;
const OUTDOOR_ROOM = /balkon|terrasse|garten|draußen|draussen|außen|aussen|hof/i;
const API = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

// ─── Reine Funktionen (ohne Netz/DOM, testbar) ───
/** Draußen stehende Pflanze: reine Außenart oder Raum wie „Balkon“/„Garten“. */
export function isOutdoor(p) {
  return PLANT_DB[p?.type]?.indoor === false || OUTDOOR_ROOM.test(p?.room || '');
}

/** Open-Meteo-„daily“ → { byDay, pastMm (gestern+heute), todayMm, tomorrowMm, forecastMm, minTemp (heute/morgen) }. */
export function rainSummary(daily, todayISO) {
  const time = daily?.time || [], pr = daily?.precipitation_sum || [], tm = daily?.temperature_2m_min || [];
  const byDay = {}, mins = [];
  time.forEach((d, i) => { byDay[d] = Number(pr[i]) || 0; });
  const yesterday = addDays(todayISO, -1), tomorrow = addDays(todayISO, 1);
  time.forEach((d, i) => { if ((d === todayISO || d === tomorrow) && tm[i] != null && !isNaN(tm[i])) mins.push(Number(tm[i])); });
  const mm = d => byDay[d] || 0;
  return {
    byDay, todayMm: mm(todayISO), tomorrowMm: mm(tomorrow),
    pastMm: mm(yesterday) + mm(todayISO), forecastMm: mm(tomorrow),
    minTemp: mins.length ? Math.min(...mins) : null,
  };
}

const fmtMm = n => String(Math.round(n));
const fmtTemp = t => (Math.round(t) < 0 ? '−' : '') + Math.abs(Math.round(t));
const name = p => p.nickname || p.type;
const frostLimit = p => Math.min(PLANT_DB[p.type]?.tmin ?? FROST_DEFAULT_C, FROST_DEFAULT_C);
const frostSensitive = p => (PLANT_DB[p.type]?.tmin ?? FROST_DEFAULT_C) > FROST_SENSITIVE_MIN;

/**
 * Wählt höchstens einen Hinweis: Frost > Regen seit gestern > Regen angesagt. null = nichts anzeigen.
 * dueFn(p) → true, wenn die Pflanze heute/morgen gegossen werden müsste (für Tests ersetzbar).
 */
export function pickBanner({ summary, plants, todayISO, dueFn = p => waterStatus(p).days <= 1 }) {
  if (!summary) return null;
  const out = (plants || []).filter(isOutdoor);
  if (!out.length) return null;

  // 1) Frost: empfindliche Pflanzen, Tiefstwert heute/morgen unter ihrer Schwelle
  if (summary.minTemp != null) {
    const cold = out.filter(p => frostSensitive(p) && summary.minTemp <= frostLimit(p));
    if (cold.length) {
      const names = [...new Set(cold.map(name))];
      const list = names.slice(0, 3).join(', ') + (names.length > 3 ? ' u. a.' : '');
      return { kind: 'frost', icon: '❄️', ids: cold.map(p => p.id), action: null,
        text: `❄️ Frost bis ${fmtTemp(summary.minTemp)} °C erwartet – ${list} reinholen oder schützen.` };
    }
  }
  const due = out.filter(dueFn);
  if (!due.length) return null;

  // 2) Regen seit gestern bzw. seit dem letzten Gießen der jeweiligen Pflanze
  const yesterday = addDays(todayISO, -1);
  const rainSince = p => [yesterday, todayISO].filter(d => !p.lastWatered || d > p.lastWatered)
    .reduce((s, d) => s + (summary.byDay?.[d] || 0), 0);
  const wet = due.filter(p => rainSince(p) >= RAIN_PAST_MM);
  if (wet.length) {
    const mm = Math.max(...wet.map(rainSince));
    return { kind: 'rain', icon: '🌧️', ids: wet.map(p => p.id), action: 'markWatered',
      text: `🌧️ Seit gestern ${fmtMm(mm)} mm Regen – Balkon- und Gartenpflanzen musst du heute nicht gießen.` };
  }
  // 3) Regen angesagt
  if (summary.forecastMm >= RAIN_FORECAST_MM) {
    return { kind: 'forecast', icon: '🌦️', ids: due.map(p => p.id), action: null,
      text: `🌦️ Morgen sind ${fmtMm(summary.forecastMm)} mm Regen angesagt – Gießen kann warten.` };
  }
  return null;
}

// ─── Einstellungen & Speicher (Store wird erst bei Bedarf geladen) ───
const getStore = async () => (await import('./store.js')).store;
const DEFAULT_CFG = { enabled: false, lat: null, lon: null, place: '' };
async function getCfg() { try { return { ...DEFAULT_CFG, ...(await (await getStore()).getSetting('local:weather', {})) }; } catch { return { ...DEFAULT_CFG }; } }
async function setCfg(c) { try { await (await getStore()).setSetting('local:weather', c); } catch { /* ignorieren */ } }
const hasPlace = c => c.lat != null && c.lon != null;
const round2 = n => Math.round(n * 100) / 100;

let ctx = null;          // { getPlants, markWatered } aus initWeather
let statusText = 'Aus';
const setStatusFromCfg = c => { statusText = c.enabled ? `An${c.place ? ' · ' + c.place : ''}` : 'Aus'; };

/** Kurztext für eine Status-Pille: „An · Berlin“ oder „Aus“ (gilt nach initWeather/Einstellungen). */
export function weatherStatusText() { return statusText; }

async function fetchJson(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Wetterdaten laden: 3-h-Cache, bei Netzfehler veralteter Cache vom selben Tag, sonst null. */
async function loadDaily(cfg, { force = false } = {}) {
  const st = await getStore();
  let cache = null; try { cache = await st.getSetting('local:weatherCache', null); } catch { /* */ }
  const same = cache && cache.lat === cfg.lat && cache.lon === cfg.lon && cache.daily?.time?.includes(today());
  if (same && !force && Date.now() - cache.t < CACHE_MS) return cache.daily;
  try {
    const q = `latitude=${cfg.lat}&longitude=${cfg.lon}&daily=precipitation_sum,temperature_2m_min&past_days=2&forecast_days=2&timezone=auto`;
    const j = await fetchJson(`${API}?${q}`);
    if (!j?.daily?.time) throw new Error('Unerwartete Antwort');
    try { await st.setSetting('local:weatherCache', { t: Date.now(), lat: cfg.lat, lon: cfg.lon, daily: j.daily }); } catch { /* */ }
    return j.daily;
  } catch { return same ? cache.daily : null; }
}

// ─── Banner ───
function bannerEl() {
  let el = document.getElementById('weather-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'weather-banner'; el.className = 'weather-banner'; el.hidden = true;
    el.setAttribute('role', 'status');
    const ref = document.getElementById('summary');
    if (ref?.parentNode) ref.parentNode.insertBefore(el, ref);
    else (document.querySelector('main') || document.body).prepend(el);
  }
  return el;
}
async function getDismissed() {
  try { const d = await (await getStore()).getSetting('local:weatherDismissed', null); return d?.date === today() ? d : { date: today(), keys: [], toasted: false }; }
  catch { return { date: today(), keys: [], toasted: false }; }
}
async function putDismissed(d) { try { await (await getStore()).setSetting('local:weatherDismissed', d); } catch { /* */ } }

async function render(b, { ignoreDismissed = false } = {}) {
  const el = bannerEl();
  const dis = await getDismissed();
  if (!b || (!ignoreDismissed && dis.keys.includes(b.kind))) { el.hidden = true; el.innerHTML = ''; return; }
  el.className = `weather-banner wb-${b.kind}`;
  el.innerHTML = `<span class="wb-text">${esc(b.text)}</span>`
    + (b.action ? '<button type="button" class="btn-primary btn-sm wb-act">Als gegossen markieren</button>' : '')
    + '<button type="button" class="close-btn wb-close" aria-label="Hinweis ausblenden">✕</button>';
  el.hidden = false;
  el.querySelector('.wb-close').onclick = async () => { el.hidden = true; dis.keys.push(b.kind); await putDismissed(dis); };
  const act = el.querySelector('.wb-act');
  if (act) act.onclick = async () => {
    act.disabled = true;
    try { await ctx?.markWatered?.(b.ids); el.hidden = true; dis.keys.push(b.kind); await putDismissed(dis); }
    catch { act.disabled = false; toast('Konnte nicht markiert werden', 'error'); }
  };
  if (!dis.toasted) { dis.toasted = true; await putDismissed(dis); toast(b.text.replace(/ – .*$/, '')); }
}

/** Wetter prüfen und Banner aktualisieren. Gibt { summary, banner } oder null zurück (nie Exception). */
async function check({ force = false, ignoreDismissed = false } = {}) {
  try {
    const cfg = await getCfg(); setStatusFromCfg(cfg);
    const el = document.getElementById('weather-banner');
    if (!cfg.enabled || !hasPlace(cfg) || !ctx) { if (el) el.hidden = true; return null; }
    const plants = (await ctx.getPlants()) || [];
    if (!plants.some(isOutdoor)) { if (el) el.hidden = true; return { summary: null, banner: null, outdoor: 0 }; }
    const daily = await loadDaily(cfg, { force });
    if (!daily) return { summary: null, banner: null, outdoor: plants.filter(isOutdoor).length, offline: true };
    const summary = rainSummary(daily, today());
    const banner = pickBanner({ summary, plants, todayISO: today() });
    await render(banner, { ignoreDismissed });
    return { summary, banner, outdoor: plants.filter(isOutdoor).length };
  } catch { return null; }
}

/** Beim App-Start aufrufen; still, wenn deaktiviert, ohne Außenpflanzen oder offline. */
export async function initWeather({ getPlants, markWatered }) {
  ctx = { getPlants, markWatered };
  await check();
}

// ─── Einstellungsdialog ───
let dlg = null;
const $ = s => dlg.querySelector(s);

async function refreshDialog() {
  const cfg = await getCfg(); setStatusFromCfg(cfg);
  $('#wx-on').checked = !!cfg.enabled;
  $('#wx-place').textContent = hasPlace(cfg) ? `📍 ${cfg.place || 'Aktueller Standort'} (${cfg.lat}, ${cfg.lon})` : 'Noch kein Ort gewählt.';
  $('#wx-check').disabled = !cfg.enabled || !hasPlace(cfg);
}
async function choose(place) {
  const cfg = await getCfg();
  await setCfg({ ...cfg, lat: round2(place.lat), lon: round2(place.lon), place: place.place });
  $('#wx-results').innerHTML = ''; $('#wx-q').value = '';
  await refreshDialog();
}
async function search() {
  const q = $('#wx-q').value.trim(), box = $('#wx-results');
  if (q.length < 2) return;
  box.innerHTML = '<div class="muted">Suche …</div>';
  try {
    const j = await fetchJson(`${GEO}?name=${encodeURIComponent(q)}&count=5&language=de&format=json`);
    const res = j.results || [];
    if (!res.length) { box.innerHTML = '<div class="muted">Kein Ort gefunden.</div>'; return; }
    box.innerHTML = `<div class="list-card">${res.map((r, i) => `<button type="button" class="list-item" data-i="${i}"><span class="li-text">${esc(r.name)}<div class="li-sub">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</div></span></button>`).join('')}</div>`;
    box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const r = res[+b.dataset.i]; choose({ lat: r.latitude, lon: r.longitude, place: r.name }); });
  } catch { box.innerHTML = '<div class="muted">Suche nicht möglich – bist du online?</div>'; }
}
function locate() {
  const box = $('#wx-results');
  if (!navigator.geolocation) { box.innerHTML = '<div class="muted">Standortabfrage wird nicht unterstützt.</div>'; return; }
  box.innerHTML = '<div class="muted">Standort wird ermittelt …</div>';
  navigator.geolocation.getCurrentPosition(
    pos => choose({ lat: pos.coords.latitude, lon: pos.coords.longitude, place: 'Aktueller Standort' }),
    () => { box.innerHTML = '<div class="muted">Standort nicht verfügbar – bitte Ort suchen.</div>'; },
    { timeout: 10000, maximumAge: 600000 });
}
async function runCheck() {
  const out = $('#wx-result'); out.hidden = false; out.textContent = 'Prüfe Wetter …';
  const r = await check({ force: true, ignoreDismissed: true });
  if (!r) out.textContent = 'Wetter konnte nicht geladen werden.';
  else if (r.offline) out.textContent = 'Wetter konnte nicht geladen werden – bist du online?';
  else if (!r.outdoor) out.textContent = 'Keine Balkon- oder Gartenpflanzen vorhanden (Raum „Balkon“, „Terrasse“ oder „Garten“ wählen).';
  else {
    const s = r.summary;
    out.textContent = `Gestern + heute: ${fmtMm(s.pastMm)} mm Regen · Morgen: ${fmtMm(s.forecastMm)} mm · Tiefstwert: ${s.minTemp == null ? '–' : fmtTemp(s.minTemp) + ' °C'}. ${r.banner ? 'Hinweis oben eingeblendet.' : 'Aktuell kein Hinweis nötig.'}`;
  }
}
function build() {
  dlg = document.createElement('dialog');
  dlg.id = 'weather-dialog'; dlg.setAttribute('aria-labelledby', 'weather-title');
  dlg.innerHTML = `
  <div class="modal-header"><div><span class="modal-title" id="weather-title">Regen-Hinweise</span><div class="muted">Für Balkon- und Gartenpflanzen</div></div><button type="button" class="close-btn" aria-label="Schließen">✕</button></div>
  <div class="modal-body">
    <p class="muted">Beim Öffnen der App zeigt dir ein Hinweis, wenn es geregnet hat, Regen angesagt ist oder Frost droht. Die Daten kommen von Open-Meteo; dorthin werden nur Koordinaten gesendet, auf 2 Nachkommastellen gerundet (ca. 1 km). Wetterdaten sind Vorhersagen – im Zweifel Erde prüfen.</p>
    <div class="list-card sub-menu"><label class="list-item" style="cursor:pointer"><span class="li-icon">🌧️</span><span class="li-text">Regen-Hinweise für Garten &amp; Balkon<div class="li-sub">Nur für Pflanzen draußen</div></span><input type="checkbox" id="wx-on" style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0"></label></div>
    <div class="form-group wx-loc"><label for="wx-q">Ort</label>
      <div class="wx-row"><input id="wx-q" type="search" placeholder="Stadt suchen, z. B. Hamburg" autocomplete="off"><button type="button" class="btn-ghost btn-sm" id="wx-search">Suchen</button></div>
      <button type="button" class="btn-ghost btn-sm" id="wx-geo">📍 Aktuellen Standort verwenden</button>
      <div id="wx-results" aria-live="polite"></div>
      <div id="wx-place" class="muted"></div></div>
    <button type="button" class="btn-primary" id="wx-check">Jetzt prüfen</button>
    <div class="ai-box" id="wx-result" role="status" hidden></div>
  </div>`;
  document.body.appendChild(dlg);
  $('.close-btn').onclick = () => dlg.close();
  $('#wx-search').onclick = search;
  $('#wx-q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  $('#wx-geo').onclick = locate;
  $('#wx-check').onclick = runCheck;
  $('#wx-on').onchange = async e => {
    const cfg = await getCfg(); await setCfg({ ...cfg, enabled: e.target.checked });
    await refreshDialog();
    if (e.target.checked && hasPlace(cfg)) runCheck(); else if (!e.target.checked) check();
  };
}
/** Öffnet den Einstellungsdialog (wird beim ersten Aufruf erzeugt). */
export async function openWeatherSettings() {
  if (!dlg) build();
  $('#wx-result').hidden = true;
  await refreshDialog();
  dlg.showModal();
}
