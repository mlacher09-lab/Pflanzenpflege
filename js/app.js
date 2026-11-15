// Pflanzenpflege – Hauptmodul: Navigation, Pflanzenbuch, Formulare, Detailansicht, Einstellungen
import { PLANT_DB, PLANT_NAMES, ROOMS, LIGHT_LEVELS, LEGACY_LIGHT, PET_LEVELS, resolvePlantName, searchPlants, seasonalTips, season, SEASON_NAME, SEASON_ICON } from './plants-db.js';
import { store, uid } from './store.js';
import { api } from './api.js';
import { esc, norm, today, addDays, fmtDate, waterStatus, fertStatus, urgencyClass, waterInterval, fertInterval, seasonalWater, fertSeasonPaused, currentSeasonName, compressImage, toast, miniMarkdown, confirmDialog, plantImg, plantImgCredit } from './util.js';
import { initScan, onScanShow, onScanHide } from './scan.js';
import { initFinder, renderFinder } from './finder.js';
import { initWishlist, renderWishlist, openWishModal, getWishlist, setWishQuery } from './wishlist.js';
import { analytics } from './analytics.js';

export const APP_VERSION = '2.6.1';
const $ = id => document.getElementById(id);

// ─── STATE ───────────────────────────────────────────────────────────
export let plants = [];
let activeView = 'plants';
let activeTab = 'all';
let activeSort = 'urgency';
let plantQuery = '';
let pendingPhoto = null;
let editingId = null;
let addSource = 'form';
let deferredInstall = null;

export function getPlants() { return plants; }
export async function reloadPlants() { plants = await store.all('plants'); renderPlants(); }

// ─── NAVIGATION ──────────────────────────────────────────────────────
const VIEWS = ['plants', 'scan', 'finder', 'wishlist', 'more'];
const TITLES = { plants: 'Pflanzenpflege', scan: 'Pflanzenpflege', finder: 'Pflanzenpflege', wishlist: 'Pflanzenpflege', more: 'Pflanzenpflege' };

export function navigate(view, { push = true } = {}) {
  if (!VIEWS.includes(view)) view = 'plants';
  if (activeView === 'scan' && view !== 'scan') onScanHide();
  activeView = view;
  VIEWS.forEach(v => $(`view-${v}`).hidden = v !== view);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  $('plants-tabs').hidden = view !== 'plants';
  // Ein einziger Hinzufügen-Button im Kopf – je nach Ansicht für Pflanzen oder Wünsche
  $('add-btn').hidden = !['plants', 'wishlist'].includes(view);
  $('add-btn').dataset.action = view === 'wishlist' ? 'add-wish' : 'add-plant';
  $('add-btn-label').textContent = view === 'wishlist' ? 'Wunsch' : 'Pflanze';
  $('hdr-title').textContent = TITLES[view];
  if (view === 'plants') requestAnimationFrame(updateTabFade);
  if (view === 'scan') onScanShow();
  if (view === 'finder') renderFinder();
  if (view === 'wishlist') renderWishlist();
  if (view === 'more') renderMore();
  if (push) history.replaceState(null, '', view === 'plants' ? location.pathname : `?view=${view}`);
  window.scrollTo({ top: 0 });
}

// Kategorienleiste: weicher Rand zeigt an, dass sich weitere Kategorien seitlich verbergen
function updateTabFade() {
  const tabs = document.querySelector('#plants-tabs .tabs');
  const max = tabs.scrollWidth - tabs.clientWidth;
  tabs.classList.toggle('fade-l', tabs.scrollLeft > 2);
  tabs.classList.toggle('fade-r', max > 2 && tabs.scrollLeft < max - 2);
}

// ─── RENDER: PFLANZENBUCH ────────────────────────────────────────────
const CIRC = 2 * Math.PI * 27;
function ring(kind, icon, title, ok, total) {
  const frac = total === 0 ? 1 : ok / total;
  const color = frac >= 1 ? 'var(--ok)' : frac >= .5 ? 'var(--soon)' : 'var(--overdue)';
  const sub = total === 0 ? 'Keine Pflanzen' : frac === 1 ? 'Alles erledigt ✓' : `${total - ok} fällig – ansehen`;
  return `<button type="button" class="ring-card" data-care="${kind}" aria-label="${title}: ${ok} von ${total} versorgt – Übersicht öffnen"><div class="ring-wrap"><svg viewBox="0 0 64 64"><circle class="ring-track" cx="32" cy="32" r="27"/><circle class="ring-fill" cx="32" cy="32" r="27" stroke="${color}" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - frac)).toFixed(1)}"/></svg><div class="ring-label">${ok}<span style="opacity:.55;font-size:10px">/${total}</span><small>${icon}</small></div></div><div class="ring-info"><h3>${title}</h3><p>${sub}</p></div><span class="ring-chevron" aria-hidden="true">›</span></button>`;
}
function renderSummary() {
  const el = $('summary');
  if (!plants.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = ring('water', '💧', 'Gießen', plants.filter(p => waterStatus(p).cls === 'ok').length, plants.length)
    + ring('fert', '🌱', 'Düngen', plants.filter(p => fertStatus(p).cls === 'ok').length, plants.length);
}
function sorted(list) {
  const c = [...list];
  if (activeSort === 'name') return c.sort((a, b) => (a.nickname || a.type).localeCompare(b.nickname || b.type, 'de'));
  if (activeSort === 'water') return c.sort((a, b) => waterStatus(a).days - waterStatus(b).days);
  if (activeSort === 'fert') return c.sort((a, b) => fertStatus(a).days - fertStatus(b).days);
  const o = { overdue: 0, soon: 1, ok: 2 };
  return c.sort((a, b) => (o[urgencyClass(a)] - o[urgencyClass(b)]) || (waterStatus(a).days - waterStatus(b).days));
}
/** Suche im eigenen Pflanzenbuch: Spitzname, Art, wissenschaftlicher Name, Alias, Raum, Notizen. */
function matchesQuery(p) {
  if (!plantQuery) return true;
  const db = PLANT_DB[p.type] || {};
  const hay = norm([p.nickname, p.type, db.sci, ...(db.aliases || []), p.room, p.notes].filter(Boolean).join(' '));
  return norm(plantQuery).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
function filtered() {
  const base = plants.filter(matchesQuery);
  if (activeTab === 'water') return sorted(base.filter(p => ['overdue', 'soon'].includes(waterStatus(p).cls)));
  if (activeTab === 'fert') return sorted(base.filter(p => ['overdue', 'soon'].includes(fertStatus(p).cls)));
  return sorted(base);
}
export function lightIcon(l) { return LIGHT_LEVELS[l]?.icon || LIGHT_LEVELS[LEGACY_LIGHT[l]]?.icon || ''; }
export function lightLabel(l) { return LIGHT_LEVELS[l]?.label || l || ''; }

function plantCard(p) {
  const db = PLANT_DB[p.type] || {};
  const w = waterStatus(p), f = fertStatus(p), urg = urgencyClass(p);
  const photo = p.photo || plantImg(p.type) ? `<img src="${p.photo || plantImg(p.type)}" alt="" loading="lazy">` : `<span>${db.e || '🪴'}</span>`;
  return `<article class="plant-card" data-open="${p.id}" tabindex="0" role="button" aria-label="${esc(p.nickname || p.type)}">
    <div class="card-urgency-bar ${urg}"></div>
    <div class="card-body"><div class="card-photo">${photo}</div>
      <div class="card-info"><div class="card-name">${esc(p.nickname || p.type)}</div>
        <div class="card-sci">${p.nickname ? esc(p.type) : esc(db.sci || '')}</div>
        <div class="card-chips">${p.room ? `<span class="chip">📍 ${esc(p.room)}</span>` : ''}${p.light ? `<span class="chip">${lightIcon(p.light)} ${esc(lightLabel(p.light))}</span>` : ''}</div>
      </div></div>
    <div class="card-status">
      <div class="status-row"><div class="status-dot ${w.cls}"></div><span class="status-label">💧 Gießen</span><span class="status-val ${w.cls}">${w.text}</span></div>
      <div class="status-row"><div class="status-dot ${f.cls}"></div><span class="status-label">🌱 Düngen</span><span class="status-val ${f.cls}">${f.text}</span></div>
    </div>
    <div class="card-actions"><button class="action-btn water" data-water="${p.id}">💧 Gegossen</button><button class="action-btn fert" data-fert="${p.id}">🌱 Gedüngt</button></div>
  </article>`;
}
export function renderPlants() {
  renderSummary();
  if ($('care-dialog').open) renderCare();
  const grid = $('plant-grid'), empty = $('empty');
  $('list-bar').hidden = !plants.length;
  if (!plants.length) { grid.innerHTML = ''; empty.hidden = false; updateBadges(); return; }
  empty.hidden = true;
  if (activeTab === 'rooms') {
    const groups = {};
    sorted(plants.filter(matchesQuery)).forEach(p => { (groups[p.room || 'Ohne Raum'] ||= []).push(p); });
    grid.innerHTML = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'de')).map(([room, list]) =>
      `<div style="grid-column:1/-1"><div class="section-title" style="margin-top:6px">📍 ${esc(room)} <span class="muted">· ${list.length}</span></div><div id="plant-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${list.map(plantCard).join('')}</div></div>`
    ).join('') || noHits();
  } else {
    const list = filtered();
    grid.innerHTML = list.length ? list.map(plantCard).join('') : plantQuery ? noHits() : `<p class="muted" style="grid-column:1/-1;padding:20px 0">Keine Pflanzen in dieser Kategorie – alles versorgt. 🌿</p>`;
  }
  updateBadges();
}

function noHits() {
  return `<div class="no-hits" style="grid-column:1/-1"><p>Keine eigene Pflanze passt zu „${esc(plantQuery)}“.</p><button type="button" class="btn-ghost btn-sm" data-nav="wishlist" data-wish-query="${esc(plantQuery)}">In der Pflanzendatenbank suchen</button></div>`;
}

// ─── PFLEGE-ÜBERSICHT (aus den Statuskreisen) ────────────────────────
let careKind = 'water';
const CARE = {
  water: { title: '💧 Gießen', status: p => waterStatus(p), attr: 'data-water', btn: '💧 Gegossen', all: '💧 Alle als gegossen markieren', done: 'Alle Pflanzen sind gegossen. 🌿', field: 'lastWatered', verb: 'gegossen' },
  fert:  { title: '🌱 Düngen', status: p => fertStatus(p),  attr: 'data-fert',  btn: '🌱 Gedüngt',   all: '🌱 Alle als gedüngt markieren',   done: 'Alle Pflanzen sind versorgt. 🌿', field: 'lastFertilized', verb: 'gedüngt' },
};
const careDue = kind => plants.filter(p => CARE[kind].status(p).cls !== 'ok').sort((a, b) => CARE[kind].status(a).days - CARE[kind].status(b).days);
function careRow(p, kind) {
  const st = CARE[kind].status(p), img = p.photo || plantImg(p.type);
  return `<div class="care-item">
    <button type="button" class="care-item-main" data-open="${p.id}">
      <span class="care-thumb">${img ? `<img src="${img}" alt="" loading="lazy">` : (PLANT_DB[p.type]?.e || '🪴')}</span>
      <span class="care-item-text"><span class="care-item-name">${esc(p.nickname || p.type)}</span><span class="care-item-st ${st.cls}">${st.text}${p.room ? ` · 📍 ${esc(p.room)}` : ''}</span></span>
    </button>
    <button type="button" class="action-btn ${kind} care-item-btn" ${CARE[kind].attr}="${p.id}">${CARE[kind].btn}</button>
  </div>`;
}
function renderCare() {
  const k = CARE[careKind], due = careDue(careKind);
  const overdue = due.filter(p => k.status(p).cls === 'overdue').length;
  $('care-title').textContent = k.title;
  $('care-sub').textContent = due.length ? `${due.length} ${due.length === 1 ? 'Pflanze' : 'Pflanzen'} fällig${overdue ? ` · ${overdue} überfällig` : ''}` : `${plants.length} ${plants.length === 1 ? 'Pflanze' : 'Pflanzen'} versorgt`;
  const upcoming = plants.filter(p => k.status(p).cls === 'ok' && k.status(p).next).sort((a, b) => k.status(a).days - k.status(b).days).slice(0, 5);
  const paused = careKind === 'fert' && plants.some(fertSeasonPaused);
  $('care-body').innerHTML = (due.length ? due.map(p => careRow(p, careKind)).join('') : `<div class="care-empty"><div class="empty-icon">✅</div><p>${k.done}</p></div>`)
    + (paused ? `<p class="muted care-note">${SEASON_ICON[season()]} ${currentSeasonName()}pause: Die meisten Pflanzen werden jetzt nicht gedüngt – die Intervalle passen sich automatisch an die Jahreszeit an.</p>` : '')
    + (upcoming.length ? `<div class="section-title">Als Nächstes</div>${upcoming.map(p => `<button type="button" class="care-next" data-open="${p.id}"><span>${esc(p.nickname || p.type)}</span><span class="muted">${fmtDate(k.status(p).next)}</span></button>`).join('')}` : '');
  $('care-footer').hidden = due.length < 2;
  $('care-all-btn').textContent = k.all;
}
function openCare(kind) { careKind = kind; renderCare(); $('care-dialog').showModal(); }
async function careAll() {
  const k = CARE[careKind], due = careDue(careKind);
  if (!due.length) return;
  if (!await confirmDialog(`${due.length} Pflanzen als ${k.verb} markieren?`, { okText: 'Ja, alle' })) return;
  const d = today();
  for (const p of due) p[k.field] = d;
  await store.putMany('plants', due);
  analytics.track('care', { kind: careKind, bulk: due.length });
  toast(`${careKind === 'water' ? '💧' : '🌱'} ${due.length} Pflanzen ${k.verb}!`, 'success');
  renderPlants();
}
function updateBadges() {
  const count = plants.filter(p => urgencyClass(p) !== 'ok').length;
  for (const id of ['notif-badge', 'nav-badge']) { const b = $(id); b.hidden = !count; b.textContent = count; }
  if ('setAppBadge' in navigator) { (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {}); }
}

// ─── AKTIONEN ────────────────────────────────────────────────────────
async function markWatered(id) {
  const p = plants.find(x => x.id === id); if (!p) return;
  p.lastWatered = today(); await store.put('plants', p);
  analytics.track('care', { kind: 'water' });
  toast(`💧 ${p.nickname || p.type} gegossen!`, 'success'); renderPlants();
}
async function markFertilized(id) {
  const p = plants.find(x => x.id === id); if (!p) return;
  p.lastFertilized = today(); await store.put('plants', p);
  analytics.track('care', { kind: 'fert' });
  toast(`🌱 ${p.nickname || p.type} gedüngt!`, 'success'); renderPlants();
}

// ─── FORMULAR ────────────────────────────────────────────────────────
function setPhotoPreview(dataURL) {
  pendingPhoto = dataURL;
  $('photo-placeholder').hidden = !!dataURL;
  $('photo-preview-wrap').hidden = !dataURL;
  $('photo-preview-wrap').innerHTML = dataURL ? `<div class="photo-preview"><img src="${dataURL}" alt=""><button type="button" class="photo-remove" id="photo-remove" aria-label="Foto entfernen">✕</button></div>` : '';
  if (dataURL) $('photo-remove').onclick = () => { setPhotoPreview(null); $('f-photo').value = ''; };
}
function setLight(val) { document.querySelectorAll('input[name="light"]').forEach(r => r.checked = r.value === val); }
function typeHint() {
  const key = resolvePlantName($('f-type').value);
  $('f-type-hint').textContent = key ? `${PLANT_DB[key].e} ${key} · ${PLANT_DB[key].sci} · gießen alle ${seasonalWater(key)} Tage (${currentSeasonName()})` : ($('f-type').value.trim() ? 'Unbekannte Art – bitte aus der Liste wählen oder Scan nutzen' : '');
}

/** Öffnet das Formular; prefill = { type, photo, room, light, nickname } */
export function openAddModal(prefill = {}) {
  editingId = null; addSource = prefill.source || 'form';
  $('form-title').textContent = 'Pflanze hinzufügen';
  $('delete-btn').hidden = true;
  $('plant-form').reset();
  $('f-type').value = prefill.type || '';
  $('f-nick').value = prefill.nickname || '';
  $('f-room').value = prefill.room || '';
  setLight(prefill.light || (prefill.type && PLANT_DB[prefill.type]?.light?.[0]) || 'bright');
  $('f-watered').value = today(); $('f-fertilized').value = today();
  $('f-edit-id').value = '';
  setPhotoPreview(prefill.photo || null);
  typeHint();
  $('form-dialog').showModal();
}
export function openEditModal(id) {
  const p = plants.find(x => x.id === id); if (!p) return;
  editingId = id;
  $('form-title').textContent = 'Pflanze bearbeiten';
  $('delete-btn').hidden = false;
  $('plant-form').reset();
  $('f-type').value = p.type; $('f-nick').value = p.nickname || ''; $('f-room').value = p.room || '';
  $('f-watered').value = p.lastWatered || ''; $('f-fertilized').value = p.lastFertilized || '';
  $('f-wint').value = p.waterInterval || ''; $('f-fint').value = p.fertInterval || '';
  $('f-notes').value = p.notes || '';
  setLight(LEGACY_LIGHT[p.light] || p.light || 'bright');
  setPhotoPreview(p.photo || null);
  typeHint();
  $('detail-dialog').close();
  $('form-dialog').showModal();
}
async function saveForm() {
  const raw = $('f-type').value.trim();
  const type = resolvePlantName(raw);
  if (!type) { toast(raw ? `„${raw}“ ist nicht in der Pflanzenliste` : 'Bitte eine Pflanzenart wählen', 'error'); $('f-type').focus(); return; }
  const id = editingId || uid();
  const old = editingId ? plants.find(x => x.id === id) : null;
  const data = {
    ...(old || { id, addedAt: today() }),
    type, nickname: $('f-nick').value.trim(), room: $('f-room').value.trim(),
    light: document.querySelector('input[name="light"]:checked')?.value || 'bright',
    lastWatered: $('f-watered').value || null, lastFertilized: $('f-fertilized').value || null,
    waterInterval: Number($('f-wint').value) || null, fertInterval: Number($('f-fint').value) || null,
    notes: $('f-notes').value.trim(), photo: pendingPhoto || null,
  };
  await store.put('plants', data);
  if (!editingId) analytics.track('plant_added', { plant: type, source: addSource, photo: !!data.photo, room: data.room ? 'ja' : 'nein' });
  plants = await store.all('plants');
  renderPlants();
  $('form-dialog').close();
  toast(editingId ? `✔ ${data.nickname || data.type} gespeichert` : `🌱 ${data.nickname || data.type} hinzugefügt`, 'success');
  if (activeView !== 'plants') navigate('plants');
}
async function deleteCurrent() {
  const p = plants.find(x => x.id === editingId); if (!p) return;
  if (!await confirmDialog(`„${p.nickname || p.type}“ wirklich aus dem Pflanzenbuch löschen?`, { okText: 'Löschen', danger: true })) return;
  await store.remove('plants', p.id);
  analytics.track('plant_deleted', { plant: p.type });
  plants = plants.filter(x => x.id !== p.id);
  renderPlants(); $('form-dialog').close(); toast('🗑 Pflanze entfernt');
}

// Autocomplete für Pflanzenart-Felder
export function attachAutocomplete(input, listEl, onPick) {
  let items = [], sel = -1;
  const close = () => { listEl.hidden = true; sel = -1; };
  const render = () => {
    items = searchPlants(input.value).slice(0, 8);
    if (!items.length) { close(); return; }
    listEl.innerHTML = items.map((n, i) => `<div class="ac-item ${i === sel ? 'sel' : ''}" data-i="${i}"><span>${PLANT_DB[n].e}</span><span>${esc(n)}</span><small>${esc(PLANT_DB[n].sci)}</small></div>`).join('');
    listEl.hidden = false;
  };
  const pick = i => { if (items[i] == null) return; input.value = items[i]; close(); onPick?.(items[i]); };
  input.addEventListener('input', () => { sel = -1; render(); onPick?.(null, true); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', e => {
    if (listEl.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { pick(sel); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  listEl.addEventListener('mousedown', e => { const it = e.target.closest('.ac-item'); if (it) { e.preventDefault(); pick(Number(it.dataset.i)); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

// ─── DETAIL ──────────────────────────────────────────────────────────
let diagPhoto = null;
export function openDetail(id) {
  const p = plants.find(x => x.id === id); if (!p) return;
  const db = PLANT_DB[p.type] || {};
  const w = waterStatus(p), f = fertStatus(p);
  const hero = $('detail-hero');
  const cr = !p.photo && plantImgCredit(p.type);
  hero.innerHTML = p.photo || plantImg(p.type) ? `<img src="${p.photo || plantImg(p.type)}" alt="">${cr ? `<span class="img-credit">Bild: ${esc(cr.by)}, ${esc(cr.lic)}</span>` : ''}` : `<span>${db.e || '🪴'}</span>`;
  $('d-name').textContent = p.nickname || p.type;
  $('d-sci').textContent = p.nickname ? `${p.type} · ${db.sci || ''}` : (db.sci || '');
  const dots = [1, 2, 3].map(i => `<span class="diff-dot ${i <= (db.d || 1) ? 'on' : ''}"></span>`).join('');
  const diffLabel = ['', 'Leicht', 'Mittel', 'Anspruchsvoll'][db.d || 1];
  const tips = seasonalTips(p.type);
  const petCls = db.pet === 'safe' ? 'good' : db.pet === 'toxic' ? 'bad' : 'warn';
  diagPhoto = null;
  $('detail-body').innerHTML = `
    <div class="next-dates">
      <span class="next-date-chip water">💧 Gießen: <strong>${w.next ? fmtDate(w.next) : 'jetzt'}</strong></span>
      <span class="next-date-chip fert">🌱 Düngen: <strong>${fertInterval(p) === 0 ? (fertSeasonPaused(p) ? `${currentSeasonName()}pause` : 'nicht nötig') : f.next ? fmtDate(f.next) : 'jetzt'}</strong></span>
    </div>
    <div class="chips" style="margin:-6px 0 16px">
      ${p.room ? `<span class="chip">📍 ${esc(p.room)}</span>` : ''}${p.light ? `<span class="chip">${lightIcon(p.light)} ${esc(lightLabel(p.light))}</span>` : ''}
      ${db.pet ? `<span class="chip ${petCls}">🐾 ${PET_LEVELS[db.pet]}</span>` : ''}${db.air ? `<span class="chip good">🍃 Luftreinigend</span>` : ''}
    </div>
    <div class="care-grid">
      <div class="care-card"><div class="care-card-icon">💧</div><div class="care-card-label">Gießrhythmus</div><div class="care-card-val">Alle ${waterInterval(p)} Tage <span class="muted">${p.waterInterval ? '(eigen)' : `(${currentSeasonName()})`}</span></div></div>
      <div class="care-card"><div class="care-card-icon">🌱</div><div class="care-card-label">Düngeintervall</div><div class="care-card-val">${fertInterval(p) === 0 ? (fertSeasonPaused(p) ? `Pause <span class="muted">(${currentSeasonName()})</span>` : 'Nicht düngen') : `Alle ${fertInterval(p)} Tage <span class="muted">${p.fertInterval ? '(eigen)' : `(${currentSeasonName()})`}</span>`}</div></div>
      <div class="care-card"><div class="care-card-icon">☀️</div><div class="care-card-label">Licht</div><div class="care-card-val">${esc(db.lt || '–')}</div></div>
      <div class="care-card"><div class="care-card-icon">🌡️</div><div class="care-card-label">Temperatur</div><div class="care-card-val">${esc(db.tmp || '–')}</div></div>
      <div class="care-card"><div class="care-card-icon">💦</div><div class="care-card-label">Luftfeuchte</div><div class="care-card-val">${esc(db.hm || '–')}</div></div>
      <div class="care-card"><div class="care-card-icon">🎯</div><div class="care-card-label">Schwierigkeit</div><div class="care-card-val">${diffLabel}<span class="diff-dots">${dots}</span></div></div>
    </div>
    ${p.notes ? `<div class="tips-section"><h3>Notizen</h3><p style="font-size:14px;white-space:pre-wrap">${esc(p.notes)}</p></div>` : ''}
    ${db.tips ? `<div class="tips-section"><h3>Pflegetipps</h3><ul class="tips-list">${db.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${tips.length ? `<div class="tips-section seasonal-tips"><h3>${SEASON_ICON[season()]} Saisontipps ${SEASON_NAME[season()]}</h3><ul class="tips-list">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="detail-actions">
      <button class="btn-primary btn-water" data-dwater="${p.id}">💧 Jetzt gegossen</button>
      <button class="btn-primary btn-fert" data-dfert="${p.id}">🌱 Jetzt gedüngt</button>
      <button class="btn-ghost" data-edit="${p.id}">✏️ Bearbeiten</button>
    </div>
    <div class="tips-section">
      <h3>🔍 Gesundheitscheck</h3>
      <p class="muted" style="margin-bottom:10px">Ein aktuelles Foto wird vom Erkennungs-Server analysiert: Zustand, mögliche Probleme, konkrete Maßnahmen.</p>
      <input type="file" accept="image/*" capture="environment" id="diag-file" hidden>
      <div class="row">
        <button class="btn-ghost grow" id="diag-pick">📷 ${p.photo ? 'Neues Foto' : 'Foto aufnehmen'}</button>
        <button class="btn-primary grow" id="diag-run" ${p.photo || api.status === 'ok' ? '' : 'disabled'}>Analyse starten</button>
      </div>
      <div id="diag-result"></div>
    </div>
    <div style="margin-top:8px"><span class="muted">Hinzugefügt ${p.addedAt ? fmtDate(p.addedAt) : '–'} · zuletzt gegossen ${fmtDate(p.lastWatered)} · gedüngt ${fmtDate(p.lastFertilized)}</span></div>`;
  $('diag-pick').onclick = () => $('diag-file').click();
  $('diag-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    diagPhoto = await compressImage(file);
    $('diag-result').innerHTML = `<img src="${diagPhoto}" alt="" style="max-height:200px;border-radius:10px;margin-top:10px">`;
    $('diag-run').disabled = false;
  };
  $('diag-run').onclick = () => runDiagnose(p);
  $('detail-dialog').showModal();
}
async function runDiagnose(p) {
  const image = diagPhoto || p.photo;
  const out = $('diag-result'), btn = $('diag-run');
  if (!image) { toast('Bitte zuerst ein Foto aufnehmen', 'error'); return; }
  if (api.status !== 'ok') { const h = await api.health(); if (!h.ok) { out.innerHTML = `<div class="ai-box error">Kein Erkennungs-Server erreichbar (${esc(h.reason || 'nicht konfiguriert')}). Einrichtung unter „Mehr → KI-Erkennung“.</div>`; return; } }
  btn.disabled = true;
  out.innerHTML = `<div class="spinner-row"><div class="spinner"></div>Analyse läuft…</div>`;
  try {
    const db = PLANT_DB[p.type] || {};
    const res = await api.analyze({ mode: 'diagnose', image, context: { type: p.type, sci: db.sci, nickname: p.nickname, room: p.room, light: lightLabel(p.light) } });
    out.innerHTML = `<div class="ai-box">${miniMarkdown(res.text || '')}</div>`;
    analytics.track('diagnose', { plant: p.type, ok: true });
  } catch (e) {
    out.innerHTML = `<div class="ai-box error">Analyse fehlgeschlagen: ${esc(e.message)}</div>`;
    analytics.track('diagnose', { plant: p.type, ok: false });
  }
  btn.disabled = false;
}

// ─── BENACHRICHTIGUNGEN ──────────────────────────────────────────────
function renderNotifPanel() {
  const urgent = sorted(plants.filter(p => urgencyClass(p) !== 'ok'));
  const list = $('notif-list');
  list.innerHTML = urgent.length ? urgent.map(p => {
    const w = waterStatus(p), f = fertStatus(p), lines = [];
    if (w.cls !== 'ok') lines.push(`💧 ${w.text}`);
    if (f.cls !== 'ok') lines.push(`🌱 ${f.text}`);
    return `<div class="notif-item" data-open="${p.id}"><strong>${esc(p.nickname || p.type)}</strong><br><span class="muted">${lines.join(' · ')}</span></div>`;
  }).join('') : `<p class="muted" style="padding:6px 0">Alles im grünen Bereich! 🌿</p>`;
}
async function checkAndNotify() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const due = plants.filter(p => urgencyClass(p) !== 'ok');
  if (!due.length) return;
  const key = 'lastNotify', last = await store.getSetting(key);
  if (last === today()) return;
  await store.setSetting(key, today());
  const body = due.length === 1 ? `${due[0].nickname || due[0].type} braucht Aufmerksamkeit.` : `${due.length} Pflanzen brauchen Aufmerksamkeit.`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification('Pflanzenpflege', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'care' });
    else new Notification('Pflanzenpflege', { body, icon: 'icons/icon-192.png' });
  } catch { /* ignorieren */ }
}

// ─── MEHR / EINSTELLUNGEN ────────────────────────────────────────────
async function renderMore() {
  $('app-version').textContent = `v${APP_VERSION}`;
  const pill = $('notif-pill'), sub = $('notif-sub');
  if (typeof Notification === 'undefined') { pill.textContent = 'Nicht verfügbar'; sub.textContent = 'Dieser Browser unterstützt keine Benachrichtigungen.'; }
  else if (Notification.permission === 'granted') { pill.textContent = 'An'; pill.className = 'status-pill ok'; sub.textContent = 'Beim Öffnen der App wirst du an fällige Pflanzen erinnert.'; }
  else if (Notification.permission === 'denied') { pill.textContent = 'Blockiert'; pill.className = 'status-pill warn'; sub.textContent = 'In den Browser-/Systemeinstellungen für diese App erlauben.'; }
  else { pill.textContent = 'Aus'; pill.className = 'status-pill'; sub.textContent = 'Antippen, um Erinnerungen zu erlauben.'; }
  $('analytics-toggle').checked = analytics.enabled;
  renderAnalyticsPill();
  $('api-pill').textContent = '…'; $('api-sub').textContent = 'Prüfe Verbindung…';
  const h = await api.health();
  const apiPill = $('api-pill');
  if (h.ok) { apiPill.textContent = 'Bereit'; apiPill.className = 'status-pill ok'; $('api-sub').textContent = `Verbunden${api.base ? ` mit ${api.base}` : ''} · Anbieter: ${h.provider || 'KI'}`; }
  else if (api.status === 'none') { apiPill.textContent = 'Kein Schlüssel'; apiPill.className = 'status-pill warn'; $('api-sub').textContent = 'Server erreichbar, aber ANTHROPIC_API_KEY fehlt (siehe README).'; }
  else if (api.status === 'token') { apiPill.textContent = 'Zugangscode nötig'; apiPill.className = 'status-pill warn'; $('api-sub').textContent = api.token ? 'Der eingetragene Zugangscode ist falsch.' : 'Server bereit – bitte unten den Zugangscode eintragen.'; }
  else { apiPill.textContent = 'Offline'; apiPill.className = 'status-pill warn'; $('api-sub').textContent = `Nicht erreichbar (${h.reason || '–'}). Scan funktioniert dann nur manuell.`; }
}
function renderAnalyticsPill() {
  const pill = $('analytics-pill');
  pill.textContent = analytics.enabled ? 'An' : 'Aus';
  pill.className = `status-pill${analytics.enabled ? ' ok' : ''}`;
}
/** Einwilligung beim ersten Start: Statistik erst nach ausdrücklichem „Erlauben“. */
function askConsent() {
  const dlg = $('consent-dialog');
  const decide = async allow => { await analytics.setConsent(allow); dlg.close(); renderAnalyticsPill(); };
  $('consent-allow').onclick = () => decide(true);
  $('consent-deny').onclick = () => decide(false);
  dlg.addEventListener('cancel', e => e.preventDefault());   // Esc schließt nicht ohne Entscheidung
  dlg.showModal();
}
async function exportBackup(share = false) {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `pflanzenpflege-${today()}.json`;
  analytics.track('backup', { kind: share ? 'share' : 'export', plants: data.plants.length });
  if (share) {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Pflanzenpflege-Sicherung' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    toast('Teilen nicht möglich – Datei wird heruntergeladen');
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`⬇️ ${data.plants.length} Pflanzen exportiert`, 'success');
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const n = data.plants?.length ?? 0;
    const replace = plants.length ? !(await confirmDialog(`Sicherung mit ${n} Pflanzen gefunden. Mit vorhandenen ${plants.length} Pflanzen zusammenführen? („Abbrechen“ = vorhandene ersetzen)`, { okText: 'Zusammenführen' })) : false;
    const r = await store.importAll(data, replace ? 'replace' : 'merge');
    plants = await store.all('plants'); renderPlants(); await renderWishlist();
    analytics.track('backup', { kind: 'import', plants: r.plants });
    toast(`⬆️ ${r.plants} Pflanzen, ${r.wishlist} Wünsche importiert`, 'success');
  } catch (e) { toast(`Import fehlgeschlagen: ${e.message}`, 'error'); }
}
async function applyTheme(val) {
  if (val === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = val;
  await store.setSetting('theme', val);
}

// ─── SERVICE WORKER / INSTALL ────────────────────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const showUpdate = w => { $('update-bar').hidden = false; $('update-btn').onclick = () => { w.postMessage('SKIP_WAITING'); }; };
    if (reg.waiting) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => { const nw = reg.installing; nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw); }); });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing) { refreshing = true; location.reload(); } });
  } catch (e) { console.warn('Service Worker nicht registriert:', e); }
}
window.addEventListener('beforeinstallprompt', async e => {
  e.preventDefault(); deferredInstall = e;
  if (await store.getSetting('installDismissed')) return;
  $('install-banner').hidden = false;
});
window.addEventListener('appinstalled', () => { $('install-banner').hidden = true; toast('📲 App installiert', 'success'); });

// ─── EVENTS ──────────────────────────────────────────────────────────
function bindEvents() {
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-nav],[data-action],[data-close],[data-open],[data-water],[data-fert],[data-edit],[data-dwater],[data-dfert],[data-care],.tab');
    if (!t) return;
    if (t.dataset.nav) { navigate(t.dataset.nav); if (t.dataset.wishQuery != null) setWishQuery(t.dataset.wishQuery); }
    else if (t.dataset.action === 'add-plant') openAddModal();
    else if (t.dataset.action === 'add-wish') openWishModal();
    else if (t.dataset.close) $(t.dataset.close).close();
    else if (t.dataset.open) { $('notif-panel').hidden = true; openDetail(t.dataset.open); }
    else if (t.dataset.water) { e.stopPropagation(); markWatered(t.dataset.water); }
    else if (t.dataset.fert) { e.stopPropagation(); markFertilized(t.dataset.fert); }
    else if (t.dataset.dwater) { await markWatered(t.dataset.dwater); $('detail-dialog').close(); }
    else if (t.dataset.dfert) { await markFertilized(t.dataset.dfert); $('detail-dialog').close(); }
    else if (t.dataset.edit) openEditModal(t.dataset.edit);
    else if (t.dataset.care) openCare(t.dataset.care);
    else if (t.classList.contains('tab') && t.dataset.tab) { activeTab = t.dataset.tab; document.querySelectorAll('#plants-tabs .tab').forEach(x => x.classList.toggle('active', x === t)); t.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }); renderPlants(); }
  });
  document.addEventListener('keydown', e => { const c = e.target.closest?.('.plant-card'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(c.dataset.open); } });
  $('sort-select').onchange = e => { activeSort = e.target.value; renderPlants(); };
  const search = $('plant-search');
  search.addEventListener('input', () => { plantQuery = search.value.trim(); $('plant-search-clear').hidden = !search.value; renderPlants(); });
  search.addEventListener('keydown', e => { if (e.key === 'Enter') search.blur(); });
  $('plant-search-clear').onclick = () => { search.value = ''; plantQuery = ''; $('plant-search-clear').hidden = true; renderPlants(); search.focus(); };
  document.querySelector('#plants-tabs .tabs').addEventListener('scroll', updateTabFade, { passive: true });
  window.addEventListener('resize', updateTabFade);
  requestAnimationFrame(updateTabFade);
  $('save-btn').onclick = saveForm;
  $('plant-form').onsubmit = e => { e.preventDefault(); saveForm(); };
  $('delete-btn').onclick = deleteCurrent;
  $('care-all-btn').onclick = careAll;
  $('f-photo-btn').onclick = () => $('f-photo').click();
  $('f-photo').onchange = async e => { const f = e.target.files[0]; if (f) setPhotoPreview(await compressImage(f)); };
  attachAutocomplete($('f-type'), $('f-type-ac'), typeHint);
  $('notif-btn').onclick = e => { e.stopPropagation(); const p = $('notif-panel'); p.hidden = !p.hidden; if (!p.hidden) renderNotifPanel(); };
  document.addEventListener('click', e => { const p = $('notif-panel'); if (!p.hidden && !p.contains(e.target) && !$('notif-btn').contains(e.target)) p.hidden = true; });
  $('backup-menu-btn').onclick = () => { $('share-btn').hidden = !(navigator.share && navigator.canShare); $('backup-dialog').showModal(); };
  $('privacy-menu-btn').onclick = () => { $('analytics-toggle').checked = analytics.enabled; $('privacy-dialog').showModal(); };
  $('export-btn').onclick = () => { $('backup-dialog').close(); exportBackup(false); };
  $('share-btn').onclick = () => { $('backup-dialog').close(); exportBackup(true); };
  $('import-btn').onclick = () => { $('import-file').click(); $('backup-dialog').close(); };
  $('import-file').onchange = e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
  $('notif-enable-btn').onclick = async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') { const r = await Notification.requestPermission(); if (r === 'granted') { toast('🔔 Erinnerungen aktiviert', 'success'); await store.setSetting('lastNotify', null); checkAndNotify(); } }
    renderMore();
  };
  $('api-settings-btn').onclick = () => { $('api-base').value = api.base; $('api-token').value = api.token; $('api-dialog').showModal(); };
  $('api-save-btn').onclick = async () => { await api.save($('api-base').value, $('api-token').value); $('api-dialog').close(); const h = await api.health(); toast(h.ok ? '✔ Erkennungs-Server verbunden' : `Server nicht bereit: ${h.reason || 'nicht erreichbar'}`, h.ok ? 'success' : 'error'); renderMore(); };
  $('theme-select').onchange = e => applyTheme(e.target.value);
  $('analytics-toggle').onchange = async e => { await analytics.setConsent(e.target.checked); renderAnalyticsPill(); toast(e.target.checked ? 'Nutzungsstatistik an' : 'Nutzungsstatistik aus – es wird nichts mehr gesendet'); };
  $('analytics-reset').onclick = async () => { await analytics.resetId(); toast('Neue zufällige Kennung erzeugt', 'success'); };
  $('install-btn').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('install-banner').hidden = true; };
  $('install-dismiss').onclick = () => { $('install-banner').hidden = true; store.setSetting('installDismissed', true); };
  document.querySelectorAll('dialog:not(#consent-dialog)').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  preventZoom();
}

// ─── KEIN ZOOM ───────────────────────────────────────────────────────
// Versehentliches Zoomen (Zwei-Finger-Geste, Doppeltipp, Strg+Mausrad/Trackpad) unterbinden.
// iOS Safari ignoriert user-scalable=no im Viewport, daher zusätzlich die Gesten-Ereignisse abfangen.
function preventZoom() {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
  document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}

// ─── INIT ────────────────────────────────────────────────────────────
async function init() {
  const theme = await store.getSetting('theme', 'auto');
  if (theme !== 'auto') document.documentElement.dataset.theme = theme;
  $('theme-select').value = theme;
  $('room-list').innerHTML = ROOMS.map(r => `<option value="${r}">`).join('');
  $('f-light').innerHTML = Object.entries(LIGHT_LEVELS).map(([k, v]) => `<label><input type="radio" name="light" value="${k}"><span>${v.label} (${v.example})</span></label>`).join('');
  const migrated = await store.migrateLegacy();
  if (migrated) toast(`🌿 ${migrated} Pflanzen aus der alten Version übernommen`, 'success');
  await api.load();
  await analytics.init(APP_VERSION);
  plants = await store.all('plants');
  for (const p of plants) { if (!PLANT_DB[p.type]) { const fixed = resolvePlantName(p.type) || (p.type === 'Leuchterblume' ? 'Klivie' : null); if (fixed) { p.type = fixed; await store.put('plants', p); } } }
  bindEvents();
  initScan(); initFinder(); await initWishlist();
  renderPlants();
  const view = new URLSearchParams(location.search).get('view');
  navigate(view || 'plants', { push: false });
  registerSW();
  api.health().then(() => { /* Status für Scan vorbereiten */ });
  checkAndNotify();
  if (analytics.needsConsent) askConsent();
  analytics.track('app_open', { plants: plants.length, wishes: getWishlist().length, standalone: matchMedia('(display-mode: standalone)').matches, theme: document.documentElement.dataset.theme || 'auto', view: view || 'plants' });
}
init();
