// Wunschliste: Pflanzen, die angeschafft werden sollen – mit Notiz, Priorität, Standort und Übernahme ins Pflanzenbuch
import { PLANT_DB, resolvePlantName } from './plants-db.js';
import { store, uid } from './store.js';
import { esc, today, toast, confirmDialog } from './util.js';
import { openAddModal, attachAutocomplete } from './app.js';
import { setWishRef } from './scan.js';

const $ = id => document.getElementById(id);
let wishlist = [];
let editingId = null;
export function getWishlist() { return wishlist; }

export async function initWishlist() {
  wishlist = await store.all('wishlist');
  setWishRef(() => wishlist);
  attachAutocomplete($('w-name'), $('w-name-ac'), key => { if (key) $('w-type').value = key; });
  $('wish-save-btn').onclick = saveWish;
  $('wish-form').onsubmit = e => { e.preventDefault(); saveWish(); };
  $('wish-delete-btn').onclick = deleteWish;
}

/** Fügt einen Wunsch hinzu (aus Finder/Scan). Duplikate derselben Art werden nicht doppelt angelegt. */
export async function addWish({ type = null, name, room = '', note = '', photo = null, source = 'manual', priority = 2 }) {
  if (type && wishlist.some(w => w.type === type)) { toast(`${type} ist schon auf der Wunschliste`); return null; }
  const w = { id: uid(), type, name: name || type, room, note, photo, source, priority, addedAt: today() };
  await store.put('wishlist', w);
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
  if (!wishlist.length) { list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  const PRIO = { 3: 'Unbedingt', 2: 'Bald', 1: 'Irgendwann' };
  const SRC = { finder: '🔍 aus dem Finder', scan: '📷 aus dem Scan', manual: '' };
  list.innerHTML = [...wishlist].sort((a, b) => b.priority - a.priority || a.addedAt.localeCompare(b.addedAt)).map(w => {
    const db = w.type ? PLANT_DB[w.type] : null;
    return `<div class="wish-item">
      <div class="emoji">${w.photo ? `<img src="${w.photo}" alt="">` : (db?.e || '🌱')}</div>
      <div class="grow">
        <div class="row" style="gap:8px"><span class="name">${esc(w.name)}</span><span class="prio prio-${w.priority}">${PRIO[w.priority] || 'Bald'}</span></div>
        <div class="muted" style="font-style:italic">${esc(db?.sci || '')}</div>
        <div class="chips" style="margin-top:6px">${w.room ? `<span class="chip">📍 ${esc(w.room)}</span>` : ''}${db ? `<span class="chip">💧 alle ${db.w} Tage</span><span class="chip ${db.pet === 'safe' ? 'good' : db.pet === 'toxic' ? 'bad' : 'warn'}">🐾 ${db.pet === 'safe' ? 'haustiersicher' : db.pet === 'toxic' ? 'giftig' : 'je nach Art'}</span>` : '<span class="chip warn">nicht in der Datenbank</span>'}${SRC[w.source] ? `<span class="chip">${SRC[w.source]}</span>` : ''}</div>
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
    openAddModal({ type: w.type || '', room: w.room, photo: w.photo, light: w.type ? PLANT_DB[w.type]?.light?.[0] : undefined });
    const form = $('form-dialog');
    const onClose = async () => { form.removeEventListener('close', onClose); const plants = await store.all('plants'); if (w.type && plants.some(p => p.type === w.type && p.addedAt === today())) { await removeWish(w.id); toast(`💜 ${w.name} von der Wunschliste ins Pflanzenbuch übernommen`, 'success'); } };
    form.addEventListener('close', onClose);
  });
  list.querySelectorAll('[data-wedit]').forEach(b => b.onclick = () => { const w = wishlist.find(x => x.id === b.dataset.wedit); if (w) openWishModal(w); });
  list.querySelectorAll('[data-wdel]').forEach(b => b.onclick = async () => { const w = wishlist.find(x => x.id === b.dataset.wdel); if (w && await confirmDialog(`„${w.name}“ von der Wunschliste entfernen?`, { okText: 'Entfernen', danger: true })) removeWish(w.id); });
}
