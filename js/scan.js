// Scan-Modus: Kamera-Vorschau, Foto aufnehmen, Pflanze erkennen, Gesundheitscheck, Übernahme ins Pflanzenbuch
import { PLANT_DB, resolvePlantName } from './plants-db.js';
import { api } from './api.js';
import { esc, compressImage, toast, miniMarkdown, plantImg, seasonalWater } from './util.js';
import { openAddModal, navigate, getPlants, attachAutocomplete } from './app.js';
import { addWish } from './wishlist.js';
import { analytics } from './analytics.js';

const $ = id => document.getElementById(id);
let stream = null;
let facing = 'environment';
let photo = null;        // Data-URL des aktuellen Fotos
let lastResult = null;
let visible = false;
let camGen = 0;          // erhöht sich bei jedem Stopp – verwirft verspätet gestartete Kameras

export function initScan() {
  $('scan-shutter').onclick = capture;
  $('scan-flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
  $('scan-pick').onclick = () => $('scan-file').click();
  $('scan-file').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    photo = await compressImage(f, 1024);
    showPhoto(); identify();
  };
}
export function onScanShow() { visible = true; startCamera(); }
export function onScanHide() { visible = false; stopCamera(); resetScan(); }

/** Verwirft Foto und Ergebnis, damit beim nächsten Öffnen wieder die Live-Kamera erscheint. */
function resetScan() {
  photo = null; lastResult = null;
  const img = $('scan-photo'); img.hidden = true; img.removeAttribute('src');
  $('scan-result').innerHTML = '';
}

// App im Hintergrund: Kamera freigeben; beim Zurückkehren ohne aufgenommenes Foto neu starten.
document.addEventListener('visibilitychange', () => {
  if (!visible) return;
  if (document.hidden) stopCamera();
  else if (!photo && !stream) startCamera();
});

function setPlaceholder(text, show = true) {
  $('scan-placeholder').hidden = !show;
  $('scan-placeholder-text').innerHTML = text;
}

async function startCamera() {
  stopCamera();
  $('scan-photo').hidden = true; photo = null; lastResult = null; $('scan-result').innerHTML = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    setPlaceholder('Keine Kamera-Vorschau in diesem Browser.<br>Nutze den Button rechts, um ein Foto aufzunehmen oder zu wählen.');
    $('scan-shutter').disabled = true; $('scan-flip').hidden = true; return;
  }
  setPlaceholder('Kamera wird gestartet…');
  const gen = camGen;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
    if (!visible || gen !== camGen || photo) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    const v = $('scan-video'); v.srcObject = stream; v.hidden = false;
    await v.play().catch(() => {});
    $('scan-overlay').hidden = false; setPlaceholder('', false);
    $('scan-shutter').disabled = false;
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    $('scan-flip').hidden = devices.filter(d => d.kind === 'videoinput').length < 2;
  } catch (e) {
    if (!visible || gen !== camGen || photo) return;
    const denied = e.name === 'NotAllowedError' || e.name === 'SecurityError';
    setPlaceholder(denied ? 'Kamerazugriff abgelehnt.<br>Erlaube die Kamera in den Browser-Einstellungen oder wähle ein Foto aus der Galerie.' : 'Keine Kamera gefunden.<br>Wähle ein Foto aus der Galerie.');
    $('scan-shutter').disabled = true;
  }
}
function stopCamera() {
  camGen++;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  const v = $('scan-video'); v.srcObject = null; v.hidden = true; $('scan-overlay').hidden = true;
}
function capture() {
  const v = $('scan-video');
  if (!stream || !v.videoWidth) { $('scan-file').click(); return; }
  const c = document.createElement('canvas');
  const max = 1024, s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  photo = c.toDataURL('image/jpeg', 0.85);
  stopCamera(); showPhoto(); identify();
}
function showPhoto() {
  stopCamera();
  const img = $('scan-photo'); img.src = photo; img.hidden = false;
  setPlaceholder('', false);
  $('scan-shutter').disabled = true;
}

function confClass(c) { return c >= .75 ? 'high' : c >= .45 ? 'mid' : 'low'; }

async function identify() {
  const out = $('scan-result');
  out.innerHTML = `<div class="spinner-row"><div class="spinner"></div>Pflanze wird erkannt…</div>`;
  if (api.status !== 'ok') await api.health();
  if (api.status !== 'ok') { analytics.track('scan', { result: 'no_server', status: api.status }); renderNoServer(); return; }
  try {
    const res = await api.analyze({ mode: 'identify', image: photo });
    lastResult = res;
    const top = res.candidates?.[0];
    analytics.track('scan', top && res.is_plant !== false
      ? { result: 'ok', plant: top.dbKey || '', sci: top.sci || '', confidence: top.confidence || 0, matched: !!top.dbKey }
      : { result: 'no_plant' });
    renderCandidates(res);
  } catch (e) {
    analytics.track('scan', { result: 'error', status: e.status || 0 });
    out.innerHTML = `<div class="ai-box error">Erkennung fehlgeschlagen: ${esc(e.message)}</div>${manualBlock()}`;
    bindManual();
  }
}

function manualBlock() {
  return `<div class="card" style="margin-top:12px">
    <div class="form-label">Pflanze manuell zuordnen</div>
    <div class="autocomplete"><input id="scan-manual" class="input" placeholder="Name eingeben, z. B. Monstera" autocomplete="off"><div class="ac-list" id="scan-manual-ac" hidden></div></div>
    <div class="row" style="margin-top:10px"><button class="btn-primary grow" id="scan-manual-add">Ins Pflanzenbuch</button><button class="btn-ghost" id="scan-retry">📷 Neues Foto</button></div>
  </div>`;
}
function bindManual() {
  const inp = $('scan-manual'); if (!inp) return;
  attachAutocomplete(inp, $('scan-manual-ac'));
  $('scan-manual-add').onclick = () => { const key = resolvePlantName(inp.value); if (!key) { toast('Art nicht gefunden – aus der Liste wählen', 'error'); return; } openAddModal({ type: key, photo, source: 'scan_manual' }); };
  $('scan-retry').onclick = () => startCamera();
}
function renderNoServer() {
  $('scan-result').innerHTML = `<div class="ai-box">${api.status === 'none'
    ? 'Der Erkennungs-Server läuft, aber es ist noch kein KI-Schlüssel hinterlegt (<strong>ANTHROPIC_API_KEY</strong>). Siehe README, Abschnitt „Pflanzenerkennung aktivieren“.'
    : api.status === 'token'
    ? 'Der Erkennungs-Server verlangt einen Zugangscode. Trage ihn unter „Mehr → Server-Adresse & Zugangscode“ ein.'
    : 'Kein Erkennungs-Server erreichbar. Du kannst die Pflanze trotzdem manuell zuordnen – das Foto wird übernommen. Server einrichten: „Mehr → KI-Erkennung“.'}</div>${manualBlock()}`;
  bindManual();
}

function renderCandidates(res) {
  const owned = new Set(getPlants().map(p => p.type));
  const cands = (res.candidates || []).slice(0, 3).map(c => ({ ...c, key: c.dbKey && PLANT_DB[c.dbKey] ? c.dbKey : (resolvePlantName(c.sci) || resolvePlantName(c.name_de) || null) }));
  const wish = new Set((lastWish() || []).map(w => w.type));
  let html = '';
  if (res.is_plant === false || !cands.length) {
    html += `<div class="ai-box">Auf dem Foto wurde keine Pflanze eindeutig erkannt. ${esc(res.note || 'Versuche es mit mehr Licht und gut sichtbaren Blättern.')}</div>`;
  } else {
    html += `<div class="section-title" style="margin-top:4px">Erkannt</div>`;
    html += cands.map((c, i) => {
      const db = c.key ? PLANT_DB[c.key] : null;
      const img = c.key ? plantImg(c.key) : null;
      return `<div class="candidate"><div class="emoji">${img ? `<img src="${img}" alt="" loading="lazy">` : (db?.e || '🌱')}</div>
        <div class="grow"><div class="name">${esc(c.key || c.name_de || c.sci)}${owned.has(c.key) ? ' <span class="chip good">bereits im Pflanzenbuch</span>' : ''}${wish.has(c.key) ? ' <span class="chip wish">auf der Wunschliste</span>' : ''}</div>
        <div class="sci">${esc(c.sci || '')}${c.key && c.name_de && c.name_de !== c.key ? ` · ${esc(c.name_de)}` : ''}</div>
        ${!db ? '<div class="hint">Nicht in der Pflegedatenbank – Pflegedaten müssen manuell gesetzt werden.</div>' : `<div class="hint">💧 alle ${seasonalWater(c.key)} Tage · ${db.lt}</div>`}</div>
        <span class="conf ${confClass(c.confidence)}">${Math.round((c.confidence || 0) * 100)} %</span></div>
        ${i === 0 ? `<div class="candidate-actions">
          <button class="btn-primary" data-scan-add="${esc(c.key || '')}">🪴 Ins Pflanzenbuch</button>
          <button class="btn-primary btn-wish" data-scan-wish="${esc(c.key || '')}" data-name="${esc(c.name_de || c.sci || '')}">💜 Zur Wunschliste</button>
        </div>` : `<div class="candidate-actions"><button class="btn-ghost btn-sm" data-scan-add="${esc(c.key || '')}">Diese übernehmen</button><button class="btn-ghost btn-sm" data-scan-wish="${esc(c.key || '')}" data-name="${esc(c.name_de || c.sci || '')}">Auf die Wunschliste</button></div>`}`;
    }).join('');
    if (res.health) html += `<div class="section-title">Zustand auf dem Foto</div><div class="ai-box">${miniMarkdown(res.health)}</div>`;
  }
  html += `<div class="row" style="margin-top:14px"><button class="btn-ghost grow" id="scan-retry">📷 Neues Foto</button><button class="btn-ghost grow" id="scan-manual-toggle">Andere Art wählen</button></div><div id="scan-manual-wrap" hidden>${manualBlock()}</div>`;
  $('scan-result').innerHTML = html;
  $('scan-retry').onclick = () => startCamera();
  $('scan-manual-toggle').onclick = () => { $('scan-manual-wrap').hidden = false; bindManual(); $('scan-manual').focus(); };
  document.querySelectorAll('[data-scan-add]').forEach(b => b.onclick = () => openAddModal({ type: b.dataset.scanAdd || '', photo, source: 'scan' }));
  document.querySelectorAll('[data-scan-wish]').forEach(b => b.onclick = async () => {
    await addWish({ type: b.dataset.scanWish || null, name: b.dataset.scanWish || b.dataset.name, photo, source: 'scan' });
    toast('💜 Zur Wunschliste hinzugefügt', 'success');
  });
}
let lastWishRef = null;
export function setWishRef(fn) { lastWishRef = fn; }
function lastWish() { try { return lastWishRef?.() || []; } catch { return []; } }
