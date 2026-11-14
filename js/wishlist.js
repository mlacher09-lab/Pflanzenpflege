// Wunschliste: Pflanzen, die angeschafft werden sollen – mit Notiz, Priorität, Standort und Übernahme ins Pflanzenbuch
import { PLANT_DB, resolvePlantName, searchPlants } from './plants-db.js';
import { store, uid } from './store.js';
import { esc, norm, today, toast, confirmDialog, plantImg, seasonalWater } from './util.js';
import { openAddModal, attachAutocomplete, getPlants } from './app.js';
import { setWishRef } from './scan.js';
import { analytics } from './analytics.js';

const $ = id => document.getElementById(id);
let wishlist = [];
let editingId = null;
let query = '', hitLimit = 6;
export function getWishlist() { return wishlist; }

// ─── SUCHE (Pflanzendatenbank + eigene Wünsche) ──────────────────────
/** Setzt den Suchbegriff von außen (z. B. aus der Suche im Pflanzenbuch). */
export function setWishQuery(q) {
  $('wish-search').value = q; query = q.trim(); hitLimit = 6;
  $('wish-search-clear').hidden = !q;
  renderWishlist();
}
function renderSearch() {
  const box = $('wish-search-results');
  if (!query) { box.hidden = true; box.innerHTML = ''; return; }
  const hits = searchPlants(query);
  const owned = new Set(getPlants().map(p => p.type));
  const wished = new Set(wishlist.map(w => w.type));
  box.hidden = false;
  box.innerHTML = `<div class="search-head">${hits.length ? `${hits.length} ${hits.length === 1 ? 'Art' : 'Arten'} in der Pflanzendatenbank` : 'Keine Art in der Pflanzendatenbank gefunden'}</div>`
    + hits.slice(0, hitLimit).map(n => {
      const db = PLANT_DB[n], img = plantImg(n);
      const state = wished.has(n) ? '<span class="chip wish">gewünscht</span>' : owned.has(n) ? '<span class="chip good">vorhanden</span>' : '';
      return `<div class="search-hit">
        <span class="search-thumb">${img ? `<img src="${img}" alt="" loading="lazy">` : db.e}</span>
        <span class="search-hit-text"><span class="search-hit-name">${esc(n)} ${state}</span><span class="search-hit-sci">${esc(db.sci)} · 💧 alle ${seasonalWater(n)} Tage</span></span>
        ${wished.has(n) ? '' : `<button type="button" class="btn-ghost btn-sm search-hit-btn" data-swish="${esc(n)}" aria-label="${esc(n)} auf die Wunschliste">💜</button>`}
      </div>`;
    }).join('')
    + (hits.length > hitLimit ? `<button type="button" class="btn-ghost more-btn" id="wish-search-more">Alle ${hits.length} Treffer zeigen</button>` : '')
    + (!resolvePlantName(query) ? `<button type="button" class="btn-ghost more-btn" id="wish-search-custom">+ „${esc(query)}“ als eigenen Wunsch anlegen</button>` : '');
  box.querySelectorAll('[data-swish]').forEach(b => b.onclick = async () => {
    if (await addWish({ type: b.dataset.swish, name: b.dataset.swish, source: 'search' })) toast(`💜 ${b.dataset.swish} auf die Wunschliste gesetzt`, 'success');
    renderWishlist();
  });
  const more = $('wish-search-more'); if (more) more.onclick = () => { hitLimit = Infinity; renderSearch(); };
  const custom = $('wish-search-custom'); if (custom) custom.onclick = () => openWishModal({ name: query });
}
const wishMatches = w => !query || norm(query).split(/\s+/).filter(Boolean).every(t => norm([w.name, w.type, w.type && PLANT_DB[w.type]?.sci, w.room, w.note].filter(Boolean).join(' ')).includes(t));

export async function initWishlist() {
  wishlist = await store.all('wishlist');
  setWishRef(() => wishlist);
  attachAutocomplete($('w-name'), $('w-name-ac'), key => { if (key) $('w-type').value = key; });
  $('wish-save-btn').onclick = saveWish;
  $('wish-form').onsubmit = e => { e.preventDefault(); saveWish(); };
  $('wish-delete-btn').onclick = deleteWish;
  const s = $('wish-search');
  s.addEventListener('input', () => { query = s.value.trim(); hitLimit = 6; $('wish-search-clear').hidden = !s.value; renderWishlist(); });
  s.addEventListener('keydown', e => { if (e.key === 'Enter') s.blur(); });
  $('wish-search-clear').onclick = () => { setWishQuery(''); s.focus(); };
}

/** Fügt einen Wunsch hinzu (aus Finder/Scan). Duplikate derselben Art werden nicht doppelt angelegt. */
export async function addWish({ type = null, name, room = '', note = '', photo = null, source = 'manual', priority = 2 }) {
  if (type && wishlist.some(w => w.type === type)) { toast(`${type} ist schon auf der Wunschliste`); return null; }
  const w = { id: uid(), type, name: name || type, room, note, photo, source, priority, addedAt: today() };
  await store.put('wishlist', w);
  analytics.track('wish_added', { plant: type || '(unbekannt)', source, room });
  wishlist.push(w);
  if (!$('view-wishlist').hidden) renderWishlist();
  return w;
}

export function openWishModal(prefill = {}) {
  editingId = prefill.id || null;
  $('wish-title').textContent = editingId ? 'Wunsch bearbeiten' : 'Wunsch hinzufügen';
  $('wish-delete-btn').hidden = !editingId;
  $('wish-form').reset();
  $('w-name').value = prefill.name || prefill.type || '';
  $('w-type').value = prefill.type || '';
  $('w-room').value = prefill.room || '';
  $('w-prio').value = prefill.priority || 2;
  $('w-note').value = prefill.note || '';
  $('w-photo').value = prefill.photo || '';
  $('w-edit-id').value = editingId || '';
  $('wish-dialog').showModal();
}
async function saveWish() {
  const name = $('w-name').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben', 'error'); return; }
  const type = resolvePlantName(name);
  const old = editingId ? wishlist.find(w => w.id === editingId) : null;
  const w = { ...(old || { id: uid(), addedAt: today(), source: 'manual' }), name: type || name, type, room: $('w-room').value.trim(), priority: Number($('w-prio').value), note: $('w-note').value.trim(), photo: $('w-photo').value || old?.photo || null };
  await store.put('wishlist', w);
  if (!editingId) analytics.track('wish_added', { plant: type || '(unbekannt)', source: 'manual', room: w.room });
  wishlist = await store.all('wishlist');
  $('wish-dialog').close(); renderWishlist();
  toast(editingId ? '✔ Wunsch gespeichert' : '💜 Wunsch hinzugefügt', 'success');
}
async function deleteWish() {
  const w = wishlist.find(x => x.id === editingId); if (!w) return;
  if (!await confirmDialog(`„${w.name}“ von der Wunschliste entfernen?`, { okText: 'Entfernen', danger: true })) return;
  await removeWish(w.id); $('wish-dialog').close();
}
async function removeWish(id) { await store.remove('wishlist', id); wishlist = wishlist.filter(w => w.id !== id); renderWishlist(); }

export function renderWishlist() {
  const list = $('wishlist-list'), empty = $('wishlist-empty');
  renderSearch();
  if (!wishlist.length) { list.innerHTML = ''; empty.hidden = !!query; return; }
  empty.hidden = true;
  const visible = wishlist.filter(wishMatches);
  if (query && !visible.length) { list.innerHTML = ''; return; }
  const PRIO = { 3: 'Unbedingt', 2: 'Bald', 1: 'Irgendwann' };
  const SRC = { finder: '🔍 aus dem Finder', scan: '📷 aus dem Scan', manual: '' };
  list.innerHTML = (query ? `<div class="search-head">Auf deiner Wunschliste</div>` : '') + [...visible].sort((a, b) => b.priority - a.priority || a.addedAt.localeCompare(b.addedAt)).map(w => {
    const db = w.type ? PLANT_DB[w.type] : null;
    return `<div class="wish-item">
      <div class="emoji">${w.photo || (w.type && plantImg(w.type)) ? `<img src="${w.photo || plantImg(w.type)}" alt="" loading="lazy">` : (db?.e || '🌱')}</div>
      <div class="grow">
        <div class="row" style="gap:8px"><span class="name">${esc(w.name)}</span><span class="prio prio-${w.priority}">${PRIO[w.priority] || 'Bald'}</span></div>
        <div class="muted" style="font-style:italic">${esc(db?.sci || '')}</div>
        <div class="chips" style="margin-top:6px">${w.room ? `<span class="chip">📍 ${esc(w.room)}</span>` : ''}${db ? `<span class="chip">💧 alle ${seasonalWater(w.type)} Tage</span><span class="chip ${db.pet === 'safe' ? 'good' : db.pet === 'toxic' ? 'bad' : 'warn'}">🐾 ${db.pet === 'safe' ? 'haustiersicher' : db.pet === 'toxic' ? 'giftig' : 'je nach Art'}</span>` : '<span class="chip warn">nicht in der Datenbank</span>'}${SRC[w.source] ? `<span class="chip">${SRC[w.source]}</span>` : ''}</div>
        ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
        <div class="result-actions">
          <button class="btn-primary btn-sm" data-wbuy="${w.id}">🪴 Gekauft – ins Pflanzenbuch</button>
          <button class="btn-ghost btn-sm" data-wedit="${w.id}">✏️</button>
          <button class="btn-ghost btn-sm" data-wdel="${w.id}" aria-label="Entfernen">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-wbuy]').forEach(b => b.onclick = () => {
    const w = wishlist.find(x => x.id === b.dataset.wbuy); if (!w) return;
    openAddModal({ type: w.type || '', room: w.room, photo: w.photo, light: w.type ? PLANT_DB[w.type]?.light?.[0] : undefined, source: 'wishlist' });
    const form = $('form-dialog');
    const onClose = async () => { form.removeEventListener('close', onClose); const plants = await store.all('plants'); if (w.type && plants.some(p => p.type === w.type && p.addedAt === today())) { analytics.track('wish_bought', { plant: w.type }); await removeWish(w.id); toast(`💜 ${w.name} von der Wunschliste ins Pflanzenbuch übernommen`, 'success'); } };
    form.addEventListener('close', onClose);
  });
  list.querySelectorAll('[data-wedit]').forEach(b => b.onclick = () => { const w = wishlist.find(x => x.id === b.dataset.wedit); if (w) openWishModal(w); });
  list.querySelectorAll('[data-wdel]').forEach(b => b.onclick = async () => { const w = wishlist.find(x => x.id === b.dataset.wdel); if (w && await confirmDialog(`„${w.name}“ von der Wunschliste entfernen?`, { okText: 'Entfernen', danger: true })) removeWish(w.id); });
}
