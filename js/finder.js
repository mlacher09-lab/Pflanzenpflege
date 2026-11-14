// Standort-Finder: bewertet alle Pflanzen der Datenbank gegen die Bedingungen eines Platzes
import { PLANT_DB, PLANT_NAMES, ROOMS, ROOM_PRESETS, LIGHT_LEVELS, HUM_LEVELS, SIZE_LEVELS, PET_LEVELS } from './plants-db.js';
import { esc, toast, plantImg, plantImgCredit, seasonalWater, seasonalFert, currentSeasonName } from './util.js';
import { openAddModal, getPlants } from './app.js';
import { addWish, getWishlist } from './wishlist.js';
import { analytics } from './analytics.js';

let trackTimer = null;

const $ = id => document.getElementById(id);
const TEMP_RANGE = { cool: [14, 18], normal: [18, 24], warm: [24, 30] };
const LIGHT_ORDER = ['shade', 'partial', 'bright', 'sun'];

/**
 * Bewertet eine Pflanze (0–100) für die gegebenen Bedingungen und erklärt die Einschätzung.
 * criteria: { light, hum, temp, size, care, pet, flower, air }
 */
export function scorePlant(p, c) {
  const reasons = [];   // [text, cls]
  let score = 0;

  // Licht (bis 45 Punkte): exakter Treffer voll, eine Stufe daneben halb
  if (p.light.includes(c.light)) { score += 45; reasons.push([`${LIGHT_LEVELS[c.light].icon} Licht passt`, 'good']); }
  else {
    const idx = LIGHT_ORDER.indexOf(c.light);
    const near = p.light.some(l => Math.abs(LIGHT_ORDER.indexOf(l) - idx) === 1);
    if (near) { score += 20; reasons.push([idx < LIGHT_ORDER.indexOf(p.light[0]) ? 'Etwas zu dunkel' : 'Etwas zu hell', 'warn']); }
    else { reasons.push([idx < LIGHT_ORDER.indexOf(p.light[0]) ? 'Deutlich zu dunkel' : 'Deutlich zu sonnig', 'bad']); }
  }
  // Luftfeuchte (bis 25): Pflanze braucht hum; Raum bietet c.hum
  const dh = c.hum - p.hum;
  if (dh >= 0) { score += 25; reasons.push([dh > 0 && p.hum === 1 ? 'Luftfeuchte unkritisch' : 'Luftfeuchte passt', 'good']); }
  else if (dh === -1) { score += 12; reasons.push(['Luft etwas trocken – gelegentlich besprühen', 'warn']); }
  else { reasons.push(['Luft zu trocken', 'bad']); }
  // Temperatur (bis 20): Überlappung des Raumbereichs mit dem Wohlfühlbereich
  const [lo, hi] = TEMP_RANGE[c.temp];
  if (lo >= p.tmin && hi <= p.tmax) { score += 20; reasons.push(['🌡️ Temperatur ideal', 'good']); }
  else if (hi > p.tmin && lo < p.tmax) { score += 10; reasons.push([lo < p.tmin ? 'Im Winter evtl. zu kühl' : 'Evtl. zu warm', 'warn']); }
  else { reasons.push([lo < p.tmin ? 'Zu kühl' : 'Zu warm', 'bad']); }
  // Pflegeaufwand (bis 10)
  if (p.d <= c.care) { score += 10; if (p.d === 1) reasons.push(['Pflegeleicht', 'good']); }
  else reasons.push(['Anspruchsvoller als gewünscht', 'warn']);

  // Balkon / Terrasse: Freilandeignung
  if (c.outdoor) {
    if (p.out) { score += 10; reasons.push(['Für draußen geeignet', 'good']); }
    else { score -= 15; reasons.push(['Eher Zimmerpflanze – nur im Sommer raus', 'warn']); }
  }
  // Harte Filter
  let excluded = null;
  if (c.trend && !p.trend) excluded = 'keine Trendpflanze';
  if (!c.outdoor && p.indoor === false) excluded = 'nur für Balkon und Garten';
  if (c.pet && p.pet !== 'safe') excluded = p.pet === 'toxic' ? 'giftig für Haustiere' : 'Verträglichkeit je nach Art';
  if (c.size && p.size !== c.size) excluded = excluded || `Größe: ${SIZE_LEVELS[p.size]}`;
  if (c.flower && !p.flower) excluded = excluded || 'blüht nicht';
  if (c.air && !p.air) excluded = excluded || 'nicht als luftreinigend bekannt';
  return { score: Math.max(0, Math.min(100, score)), reasons, excluded };
}

export function rankPlants(c, ownedTypes = new Set(), hideOwned = false) {
  return PLANT_NAMES.map(name => ({ name, p: PLANT_DB[name], ...scorePlant(PLANT_DB[name], c) }))
    .filter(r => !r.excluded && !(hideOwned && ownedTypes.has(r.name)))
    .sort((a, b) => b.score - a.score || a.p.d - b.p.d || a.name.localeCompare(b.name, 'de'));
}

function readCriteria() {
  return {
    light: document.querySelector('input[name="fd-light"]:checked')?.value || 'bright',
    hum: Number(document.querySelector('input[name="fd-hum"]:checked')?.value || 2),
    temp: document.querySelector('input[name="fd-temp"]:checked')?.value || 'normal',
    size: $('fd-size').value, care: Number($('fd-care').value || 3),
    pet: $('fd-pet').checked, flower: $('fd-flower').checked, air: $('fd-air').checked, trend: $('fd-trend').checked,
    hideOwned: $('fd-owned').checked, room: $('fd-room').value, outdoor: !!ROOM_PRESETS[$('fd-room').value]?.outdoor,
  };
}

export function initFinder() {
  $('fd-room').innerHTML += ROOMS.map(r => `<option value="${r}">${r}</option>`).join('');
  $('fd-light').innerHTML = Object.entries(LIGHT_LEVELS).map(([k, v]) => `<label><input type="radio" name="fd-light" value="${k}" ${k === 'bright' ? 'checked' : ''}><span>${v.icon} ${v.label}</span></label>`).join('');
  $('fd-room').onchange = e => {
    const pre = ROOM_PRESETS[e.target.value]; if (!pre) return;
    document.querySelectorAll('input[name="fd-hum"]').forEach(r => r.checked = Number(r.value) === pre.hum);
    document.querySelectorAll('input[name="fd-temp"]').forEach(r => r.checked = r.value === pre.temp);
    if (pre.light) document.querySelectorAll('input[name="fd-light"]').forEach(r => r.checked = r.value === pre.light);
    if (pre.pet) $('fd-pet').checked = true;
    renderFinder();
  };
  $('finder-form').addEventListener('change', renderFinder);
  $('finder-form').addEventListener('submit', e => e.preventDefault());
}

const PAGE = 20;
let shown = PAGE, lastKey = '';

export function renderFinder() {
  const c = readCriteria();
  const key = JSON.stringify(c);
  if (key !== lastKey) { shown = PAGE; lastKey = key; }   // neue Kriterien → wieder bei den besten Treffern beginnen
  $('fd-light-hint').textContent = LIGHT_LEVELS[c.light].hint;
  const owned = new Set(getPlants().map(p => p.type));
  const wished = new Set(getWishlist().map(w => w.type));
  const results = rankPlants(c, owned, c.hideOwned);
  const good = results.filter(r => r.score >= 60);
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => analytics.track('finder_search', { light: c.light, hum: c.hum, temp: c.temp, room: c.room, size: c.size, care: c.care, pet: c.pet, flower: c.flower, air: c.air, trend: c.trend, results: good.length, top: results[0]?.name || '' }), 2500);
  $('finder-count').textContent = results.length ? `${good.length} gut passende Pflanzen${results.length > good.length ? ` · ${results.length - good.length} mit Einschränkungen` : ''}` : 'Keine Pflanze erfüllt alle Filter – lockere einen Filter.';
  $('finder-results').innerHTML = results.slice(0, shown).map(r => {
    const img = plantImg(r.name);
    const preview = r.reasons.slice(0, 2);
    return `<button type="button" class="result" data-fopen="${esc(r.name)}" aria-label="${esc(r.name)} – Details öffnen">
      <div class="emoji">${img ? `<img src="${img}" alt="${esc(r.name)}" loading="lazy">` : r.p.e}<div class="score"><div class="num">${r.score}</div><div class="lbl">Punkte</div></div></div>
      <div class="result-info">
        <div class="name">${esc(r.name)}${owned.has(r.name) ? ' <span class="chip good">vorhanden</span>' : ''}${wished.has(r.name) ? ' <span class="chip wish">gewünscht</span>' : ''}</div>
        <div class="sci">${esc(r.p.sci)}</div>
        <div class="chips">${preview.map(([t, cls]) => `<span class="chip ${cls}">${esc(t)}</span>`).join('')}</div>
      </div>
    </button>`;
  }).join('') + (results.length > shown
    ? `<button type="button" class="btn-ghost more-btn" id="finder-more">Mehr anzeigen <span class="muted">· noch ${results.length - shown} Treffer</span></button>`
    : '');
  const more = $('finder-more');
  if (more) more.onclick = () => { shown += PAGE; renderFinder(); };
  $('finder-results').querySelectorAll('[data-fopen]').forEach(b => b.onclick = () => {
    const r = results.find(x => x.name === b.dataset.fopen);
    if (r) openFinderDetail(r, c, owned, wished);
  });
}

function openFinderDetail(r, c, owned, wished) {
  const p = r.p, name = r.name, cr = plantImgCredit(name), img = plantImg(name);
  const petCls = p.pet === 'safe' ? 'good' : p.pet === 'toxic' ? 'bad' : 'warn';
  $('finder-dlg-title').textContent = `${p.e} ${name}`;
  $('finder-dlg-body').innerHTML = `${img ? `<img src="${img}" alt="${esc(name)}" class="finder-dlg-img">` : ''}
    <div class="sci">${esc(p.sci)} · <strong>${r.score} Punkte</strong></div>
    <div class="chips" style="margin-top:8px">${r.reasons.map(([t, cls]) => `<span class="chip ${cls}">${esc(t)}</span>`).join('')}<span class="chip ${petCls}">🐾 ${PET_LEVELS[p.pet]}</span><span class="chip">📏 ${SIZE_LEVELS[p.size].split(' ')[0]}</span>${p.flower ? '<span class="chip">🌸 blüht</span>' : ''}${p.air ? '<span class="chip">🍃 luftreinigend</span>' : ''}${p.trend ? '<span class="chip wish">✨ Trend</span>' : ''}${p.out ? '<span class="chip">🌤 Balkon</span>' : ''}</div>
    <div class="finder-dlg-care"><strong>💧 Gießen</strong> alle ${seasonalWater(name)} Tage · <strong>🌱 Düngen</strong> ${p.f === 0 ? 'nicht nötig' : seasonalFert(name) === 0 ? `${currentSeasonName()}pause` : `alle ${seasonalFert(name)} Tage`} <span class="muted">(${currentSeasonName()})</span> · <strong>☀️</strong> ${esc(p.lt)} · <strong>💦</strong> ${esc(HUM_LEVELS[p.hum])} · <strong>🌡️</strong> ${esc(p.tmp)}<ul>${p.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    ${cr ? `<div class="muted" style="font-size:11px">Bild: ${esc(cr.by)}, ${esc(cr.lic)} · <a href="${esc(cr.url)}" target="_blank" rel="noopener">Wikimedia Commons</a></div>` : ''}`;
  const dlg = $('finder-dialog');
  $('finder-dlg-wish').onclick = async () => {
    await addWish({ type: name, name, room: c.room, source: 'finder' });
    toast(`💜 ${name} auf die Wunschliste gesetzt`, 'success');
    dlg.close(); renderFinder();
  };
  $('finder-dlg-add').onclick = () => { dlg.close(); openAddModal({ type: name, room: c.room, light: c.light, source: 'finder' }); };
  dlg.showModal();
}
