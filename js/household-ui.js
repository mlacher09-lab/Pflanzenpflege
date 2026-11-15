// Dialog „Gemeinsamer Garten“ (Haushalt/WG): erstellen, beitreten, verwalten.
import { account } from './account.js';
import { confirmDialog, toast, esc } from './util.js';

let dlg = null;
let busy = false;

function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'household-dialog';
  dlg.setAttribute('aria-labelledby', 'household-title');
  dlg.innerHTML = `
    <div class="modal-header"><div><span class="modal-title" id="household-title">Gemeinsamer Garten</span><div class="muted">Pflanzen und Wunschliste mit Mitbewohnern teilen</div></div><button type="button" class="close-btn" aria-label="Schließen">✕</button></div>
    <div class="modal-body" id="household-body"></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.close-btn').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  account.onChange(() => { if (dlg.open && !busy) render(); });
  return dlg;
}

async function run(fn, okMsg) {
  if (busy) return;
  busy = true;
  setBusy(true);
  try { await fn(); if (okMsg) toast(okMsg, 'success'); }
  catch (e) { toast(e.message || 'Das hat nicht geklappt.', 'error'); }
  finally { busy = false; render(); }
}
function setBusy(on) { dlg.querySelectorAll('button:not(.close-btn), input').forEach(el => { el.disabled = on; }); }

function render() {
  const body = dlg.querySelector('#household-body');
  if (!account.user) {
    body.innerHTML = `<p class="muted" style="margin-bottom:14px">Um einen Garten zu teilen, brauchst du ein Konto. Melde dich an oder registriere dich – deine Pflanzen werden dabei übernommen.</p>
      <button type="button" class="btn-primary btn-block" id="hh-login">Anmelden / Registrieren</button>`;
    body.querySelector('#hh-login').onclick = () => { dlg.close(); document.getElementById('account-btn')?.click(); };
    return;
  }
  const h = account.household;
  if (!h) {
    body.innerHTML = `
      <p class="muted" style="margin-bottom:14px">Teile einen Garten mit deinem Haushalt: Alle Mitglieder sehen dieselben Pflanzen und Wünsche und wer zuletzt gegossen oder gedüngt hat.</p>
      <div class="ai-box" style="margin-bottom:14px">
        <strong>Neuen gemeinsamen Garten anlegen</strong>
        <p class="muted" style="margin:4px 0 10px">Deine bisherigen Pflanzen wandern in den gemeinsamen Garten.</p>
        <form id="hh-create"><div class="form-group"><label for="hh-name">Name</label><input id="hh-name" maxlength="60" placeholder="z. B. WG Gartenstraße" autocomplete="off"></div>
        <button type="submit" class="btn-primary btn-block">Garten anlegen</button></form>
      </div>
      <div class="ai-box">
        <strong>Mit Einladungscode beitreten</strong>
        <form id="hh-join" style="margin-top:8px"><div class="form-group"><label for="hh-code">Einladungscode</label><input id="hh-code" maxlength="12" placeholder="ABCD2345" autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase;letter-spacing:.15em"></div>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="hh-bring" checked> Meine Pflanzen mitbringen</label>
        <button type="submit" class="btn-primary btn-block">Beitreten</button></form>
      </div>`;
    body.querySelector('#hh-create').onsubmit = e => { e.preventDefault(); run(() => account.createHousehold(body.querySelector('#hh-name').value), 'Gemeinsamer Garten angelegt'); };
    body.querySelector('#hh-join').onsubmit = e => {
      e.preventDefault();
      const code = body.querySelector('#hh-code').value;
      if (!code.trim()) return toast('Bitte gib den Einladungscode ein.', 'error');
      run(() => account.joinHousehold(code, { bringData: body.querySelector('#hh-bring').checked }), 'Du bist dem Garten beigetreten');
    };
    return;
  }
  const me = h.members.find(m => m.me);
  const owner = me?.role === 'owner';
  body.innerHTML = `
    <form id="hh-rename" class="form-group" style="display:flex;gap:8px;align-items:flex-end">
      <div style="flex:1"><label for="hh-rn">Name</label><input id="hh-rn" maxlength="60" value="${esc(h.name)}"></div>
      <button type="submit" class="btn-ghost btn-sm">Speichern</button>
    </form>
    <div class="muted" style="margin:14px 0 6px">Mitglieder (${h.members.length})</div>
    <div class="list-card">
      ${h.members.map(m => `<div class="list-item" style="cursor:default"><span class="li-icon">${m.role === 'owner' ? '👑' : '🧑'}</span>
        <span class="li-text">${esc(m.email)}${m.me ? ' (du)' : ''}<div class="li-sub">${m.role === 'owner' ? 'Besitzer' : 'Mitglied'}</div></span>
        ${owner && !m.me ? `<button type="button" class="btn-ghost btn-sm" data-remove="${esc(m.email)}">Entfernen</button>` : ''}</div>`).join('')}
    </div>
    <div class="ai-box" style="margin-top:14px">
      <strong>Einladungscode</strong>
      <div style="font-size:1.6rem;letter-spacing:.2em;font-weight:700;margin:8px 0" id="hh-code-show">${esc(h.inviteCode || '')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-ghost btn-sm" id="hh-copy">Kopieren</button>
        ${navigator.share ? '<button type="button" class="btn-ghost btn-sm" id="hh-share">Teilen</button>' : ''}
        ${owner ? '<button type="button" class="btn-ghost btn-sm" id="hh-regen">Neuer Code</button>' : ''}
      </div>
    </div>
    <button type="button" class="btn-ghost btn-block" id="hh-leave" style="margin-top:14px;color:var(--overdue)">Haushalt verlassen</button>`;

  body.querySelector('#hh-rename').onsubmit = e => { e.preventDefault(); run(() => account.renameHousehold(body.querySelector('#hh-rn').value), 'Name gespeichert'); };
  const inviteText = () => `Komm in meinen gemeinsamen Garten! Einladungscode: ${h.inviteCode}\nApp: ${location.origin}`;
  body.querySelector('#hh-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(h.inviteCode); toast('Code kopiert', 'success'); }
    catch { toast('Kopieren nicht möglich – bitte den Code abschreiben.', 'error'); }
  };
  const share = body.querySelector('#hh-share');
  if (share) share.onclick = () => navigator.share({ title: 'Gemeinsamer Garten', text: inviteText(), url: location.origin }).catch(() => {});
  const regen = body.querySelector('#hh-regen');
  if (regen) regen.onclick = async () => {
    if (await confirmDialog('Neuen Code erzeugen? Der alte Code funktioniert danach nicht mehr.', { okText: 'Neuer Code' })) run(() => account.regenerateInvite(), 'Neuer Code erzeugt');
  };
  body.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    const email = b.dataset.remove;
    if (await confirmDialog(`${email} aus dem Haushalt entfernen?`, { okText: 'Entfernen', danger: true })) run(() => account.removeMember(email), 'Mitglied entfernt');
  });
  body.querySelector('#hh-leave').onclick = async () => {
    const keep = await confirmDialog('Kopie meiner Pflanzen behalten?\n\nOK: Die Pflanzen bleiben auf deinen Geräten und werden in deinen persönlichen Garten kopiert.\nAbbrechen: Du verlässt den Haushalt mit leerem Garten.', { okText: 'Kopie behalten' });
    if (!keep && !(await confirmDialog('Ohne Kopie wird der Garten auf diesem Gerät geleert. Haushalt trotzdem verlassen?', { okText: 'Verlassen', danger: true }))) return;
    run(() => account.leaveHousehold({ keepCopy: keep }), 'Haushalt verlassen');
  };
}

export function openHousehold() {
  ensureDialog();
  render();
  if (!dlg.open) dlg.showModal();
  if (account.user) account.loadHousehold().then(() => { if (dlg.open && !busy) render(); }).catch(() => {});
}
