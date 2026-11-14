// End-to-End-Test ohne Test-Runner: node test/e2e.mjs   (Server muss unter BASE laufen, Standard http://localhost:5173)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:5173';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
const errors = [];
let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } };

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera'], deviceScaleFactor: 2, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

console.log('1. Start & leerer Zustand');
await page.goto(BASE, { waitUntil: 'networkidle' });
check(await page.locator('#empty').isVisible(), 'Leerer Zustand sichtbar');
await page.screenshot({ path: path.join(shots, '01-leer.png') });

console.log('2. Pflanze über Formular hinzufügen');
await page.click('#add-btn');
await page.fill('#f-type', 'monst');
await page.waitForSelector('#f-type-ac .ac-item');
await page.click('#f-type-ac .ac-item');
check((await page.inputValue('#f-type')) === 'Monstera', 'Autocomplete wählt Monstera');
await page.fill('#f-nick', 'Monika');
await page.fill('#f-room', 'Wohnzimmer');
await page.fill('#f-watered', '2026-10-30'); // lange her → überfällig
await page.click('#save-btn');
await page.waitForSelector('.plant-card');
check((await page.locator('.plant-card').count()) === 1, 'Karte erscheint');
check((await page.textContent('.card-name')).includes('Monika'), 'Spitzname auf Karte');
check(await page.locator('.card-urgency-bar.overdue').isVisible(), 'Überfällig markiert');
check((await page.textContent('#nav-badge')) === '1', 'Badge zeigt 1');

console.log('3. Zweite Pflanze + Gießen markieren');
await page.click('#add-btn'); await page.fill('#f-type', 'Bogenhanf'); await page.fill('#f-room', 'Bad'); await page.click('#save-btn');
await page.waitForFunction(() => document.querySelectorAll('.plant-card').length === 2);
await page.click('.plant-card:first-child [data-water]');
await page.waitForFunction(() => document.querySelectorAll('.card-urgency-bar.overdue').length === 0, null, { timeout: 5000 }).catch(() => {});
check(await page.locator('.card-urgency-bar.overdue').count() === 0, 'Nach Gießen nichts mehr überfällig');
await page.screenshot({ path: path.join(shots, '02-pflanzenbuch.png'), fullPage: true });

console.log('4. Detailansicht');
await page.click('.plant-card:first-child');
await page.waitForSelector('#detail-dialog[open]');
check((await page.textContent('#detail-body')).includes('Pflegetipps'), 'Pflegetipps vorhanden');
check((await page.textContent('#detail-body')).includes('Saisontipps'), 'Saisontipps vorhanden');
check((await page.textContent('#detail-body')).includes('Gesundheitscheck'), 'Gesundheitscheck-Bereich vorhanden');
await page.screenshot({ path: path.join(shots, '03-detail.png') });
await page.click('#detail-dialog [data-close]');

console.log('5. Nach Raum gruppieren');
await page.click('.tab[data-tab="rooms"]');
check((await page.textContent('#plant-grid')).includes('Wohnzimmer') && (await page.textContent('#plant-grid')).includes('Bad'), 'Raumgruppen angezeigt');
await page.click('.tab[data-tab="all"]');

console.log('6. Standort-Finder');
await page.click('.nav-btn[data-nav="finder"]');
await page.waitForSelector('.result');
const n0 = await page.locator('.result').count();
check(n0 > 10, `Ergebnisse vorhanden (${n0})`);
check((await page.locator('.result .emoji img').count()) > 0, 'Pflanzenbilder im Finder');
await page.selectOption('#fd-room', 'Bad');
await page.waitForTimeout(100);
check((await page.isChecked('input[name="fd-hum"][value="3"]')), 'Raum-Vorgabe setzt feuchte Luft');
await page.click('label:has(#fd-pet)');
await page.waitForTimeout(100);
const names = await page.locator('.result .name').allTextContents();
check(names.length > 0 && !names.some(n => n.startsWith('Monstera')), 'Haustierfilter entfernt giftige Arten');
await page.click('label:has(input[name="fd-light"][value="shade"]) span');
await page.waitForTimeout(100);
const top = (await page.locator('.result .name').first().textContent()).trim();
const topScore = Number(await page.locator('.result .score .num').first().textContent());
check(topScore >= 80, `Bester Treffer für schattiges, feuchtes Bad: ${top} (${topScore} Punkte)`);
await page.screenshot({ path: path.join(shots, '04-finder.png'), fullPage: false });
await page.click('.result [data-fwish]');
await page.waitForFunction(() => document.querySelector('#finder-results').textContent.includes('gewünscht'), null, { timeout: 5000 }).catch(() => {});
check((await page.textContent('#finder-results')).includes('gewünscht'), 'Finder markiert Wunsch');

console.log('7. Wunschliste');
await page.click('.nav-btn[data-nav="wishlist"]');
await page.waitForSelector('.wish-item');
check((await page.locator('.wish-item').count()) === 1, 'Ein Wunsch aus dem Finder');
check((await page.textContent('.wish-item')).includes('Bad'), 'Wunsch-Standort übernommen');
await page.click('[data-action="add-wish"]');
await page.fill('#w-name', 'Pilea'); await page.fill('#w-note', 'Bei Oma gesehen'); await page.selectOption('#w-prio', '3');
await page.click('#wish-save-btn');
await page.waitForFunction(() => document.querySelectorAll('.wish-item').length === 2);
check((await page.locator('.wish-item .name').first().textContent()).includes('Ufopflanze'), 'Alias „Pilea“ → Ufopflanze, höchste Priorität zuerst');
await page.screenshot({ path: path.join(shots, '05-wunschliste.png'), fullPage: true });
await page.click('.wish-item:first-child [data-wbuy]');
await page.waitForSelector('#form-dialog[open]');
check((await page.inputValue('#f-type')) === 'Ufopflanze', '„Gekauft“ öffnet Formular mit Art');
await page.click('#save-btn');
await page.waitForFunction(() => document.querySelectorAll('.plant-card').length === 3);
await page.click('.nav-btn[data-nav="wishlist"]');
await page.waitForTimeout(200);
check((await page.locator('.wish-item').count()) === 1, 'Gekaufter Wunsch wurde von der Liste entfernt');

console.log('8. Scan ohne KI-Schlüssel (manueller Fallback)');
await page.click('.nav-btn[data-nav="scan"]');
await page.waitForTimeout(800);
const videoVisible = await page.locator('#scan-video').isVisible();
check(videoVisible, 'Kamera-Vorschau läuft (Fake-Kamera)');
await page.screenshot({ path: path.join(shots, '06-scan-kamera.png') });
await page.click('#scan-shutter');
await page.waitForSelector('#scan-manual');
check(await page.locator('#scan-photo').isVisible(), 'Foto wurde aufgenommen');
check((await page.textContent('#scan-result')).includes('ANTHROPIC_API_KEY'), 'Hinweis auf fehlenden Schlüssel');

console.log('8b. Kamera wird beim Verlassen/Zurückkehren zurückgesetzt');
await page.click('.nav-btn[data-nav="plants"]');
await page.waitForTimeout(300);
await page.click('.nav-btn[data-nav="scan"]');
await page.waitForTimeout(300);
check(await page.locator('#scan-photo').isHidden(), 'Scan-Foto nach Tabwechsel ausgeblendet');
check(((await page.innerHTML('#scan-result')).trim()) === '', 'Scan-Ergebnis nach Tabwechsel leer');
await page.waitForFunction(() => { const v = document.getElementById('scan-video'); return v && !v.hidden && v.offsetParent !== null; }, null, { timeout: 5000 }).catch(() => {});
check(await page.locator('#scan-video').isVisible(), 'Live-Kamera nach Tabwechsel wieder sichtbar');
await page.screenshot({ path: path.join(shots, '06b-scan-zurueckgesetzt.png') });
// Weiter im bisherigen Ablauf: erneut Foto aufnehmen
await page.click('#scan-shutter');
await page.waitForSelector('#scan-manual');
check(await page.locator('#scan-photo').isVisible(), 'Erneutes Foto nach Reset aufgenommen');
await page.fill('#scan-manual', 'Aloe');
await page.click('#scan-manual-ac .ac-item');
await page.click('#scan-manual-add');
await page.waitForSelector('#form-dialog[open]');
check((await page.inputValue('#f-type')) === 'Aloe Vera', 'Manuelle Zuordnung füllt Formular');
check(!(await page.locator('#photo-preview-wrap').isHidden()), 'Scan-Foto wurde ins Formular übernommen');
await page.screenshot({ path: path.join(shots, '07-scan-fallback.png') });
await page.click('#form-dialog [data-close]');

console.log('9. Export / Mehr / Theme');
await page.click('.nav-btn[data-nav="more"]');
await page.waitForFunction(() => document.querySelector('#api-pill').textContent !== '…', null, { timeout: 8000 });
check((await page.textContent('#api-pill')).includes('Kein Schlüssel'), `API-Status: kein Schlüssel (ist: ${await page.textContent('#api-pill')} / ${await page.textContent('#api-sub')})`);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
check(json.plants.length === 3 && json.wishlist.length === 1, 'Export enthält 3 Pflanzen und 1 Wunsch');
await page.selectOption('#theme-select', 'dark');
check((await page.getAttribute('html', 'data-theme')) === 'dark', 'Dunkles Design gesetzt');
await page.screenshot({ path: path.join(shots, '08-mehr-dark.png'), fullPage: true });
await page.selectOption('#theme-select', 'auto');

console.log('10. Persistenz nach Neuladen & Service Worker');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.plant-card');
check((await page.locator('.plant-card').count()) === 3, 'Daten nach Neuladen vorhanden');
const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
check(sw, 'Service Worker registriert');
const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).ok);
check(manifest, 'Manifest erreichbar');

console.log('12. Tabs/Sortierung ohne Überlappung (Mobil)');
await page.click('.nav-btn[data-nav="plants"]');
await page.waitForSelector('.plant-card');
await page.waitForTimeout(300);
const tb = await page.evaluate(() => {
  const t = document.querySelector('#plants-tabs .tabs'), s = document.getElementById('sort-select');
  const a = t.getBoundingClientRect(), b = s.getBoundingClientRect(), h = document.getElementById('hdr').getBoundingClientRect();
  const lastTab = [...t.querySelectorAll('.tab')].pop().getBoundingClientRect();
  return { hb: h.bottom, st: b.top, sv: b.width > 0, sw: t.scrollWidth, cw: t.clientWidth, fade: t.classList.contains('fade-r'), tabsRight: a.right, vw: innerWidth, lastRight: lastTab.right };
});
check(tb.sv && tb.st >= tb.hb, `Sortierung liegt unterhalb der Kopfzeile (Kopf unten ${tb.hb.toFixed(1)}, Sortierung oben ${tb.st.toFixed(1)}) – keine Überlappung mit den Tabs`);
check(tb.tabsRight <= tb.vw, `Tab-Leiste passt in die Breite (${tb.tabsRight.toFixed(1)} ≤ ${tb.vw})`);
check(tb.sw > tb.cw ? tb.fade : true, `Tabs: fade-r ${tb.sw > tb.cw ? 'gesetzt, da scrollbar' : 'nicht nötig'} (scrollWidth ${tb.sw}, clientWidth ${tb.cw}, fade-r=${tb.fade})`);
await page.screenshot({ path: path.join(shots, '10-tabs-ringe.png') });

console.log('13. Saisonale Intervalle');
const season = await page.evaluate(async () => {
  const { PLANT_DB } = await import('/js/plants-db.js');
  const m = await import('/js/util.js');
  return { w: PLANT_DB['Monstera'].w, cat: PLANT_DB['Monstera'].cat, season: (await import('/js/plants-db.js')).season(), sw: m.seasonalWater('Monstera') };
});
const FACTOR = { drought: 1.3, moisture: 1.2, flowering: 1.25, foliage: 1.25 }; // Herbst
const expW = Math.max(1, Math.round(season.w * FACTOR[season.cat || 'foliage']));
check(season.season === 'autumn', `Jahreszeit im Test: ${season.season} (erwartet autumn)`);
check(season.sw === expW, `seasonalWater(Monstera) = ${season.sw} (erwartet round(${season.w}*${FACTOR[season.cat]}) = ${expW}, cat ${season.cat})`);
await page.click('.plant-card:has-text("Monika")');
await page.waitForSelector('#detail-dialog[open]');
const care = (await page.locator('#detail-dialog .care-card:has-text("Gießrhythmus") .care-card-val').first().textContent()).replace(/\s+/g, ' ').trim();
check(care.includes(`Alle ${expW} Tage`) && care.includes('(Herbst)'), `Detail zeigt Gießrhythmus: „${care}“`);
await page.screenshot({ path: path.join(shots, '11-detail-saison.png') });
await page.click('#detail-dialog [data-close]');
const u = await page.evaluate(async () => {
  const m = await import('/js/util.js');
  return {
    aloeW: m.seasonalWater('Aloe Vera', 'winter'), aloeS: m.seasonalWater('Aloe Vera', 'summer'),
    aloeF: m.seasonalFert('Aloe Vera', 'winter'),
    venus: ['spring', 'summer', 'autumn', 'winter'].map(s => m.seasonalFert('Venusfliegenfalle', s)),
    custom: m.waterInterval({ type: 'Aloe Vera', waterInterval: 5 }),
    customF: m.fertInterval({ type: 'Aloe Vera', fertInterval: 9 }),
  };
});
check(u.aloeW === 28, `Aloe Vera Winter gießen = ${u.aloeW} (erwartet 28)`);
check(u.aloeS === 12, `Aloe Vera Sommer gießen = ${u.aloeS} (erwartet 12)`);
check(u.aloeF === 0, `Aloe Vera Winter düngen = ${u.aloeF} (erwartet 0)`);
check(u.venus.every(x => x === 0), `Venusfliegenfalle düngen in allen Jahreszeiten 0 (${u.venus.join(',')})`);
check(u.custom === 5 && u.customF === 9, `Eigene Intervalle bleiben unverändert (${u.custom}/${u.customF})`);

console.log('14. Statuskreise öffnen Pflege-Übersicht');
for (const [type, room] of [['Aloe Vera', 'Flur'], ['Bogenhanf', 'Flur'], ['Efeutute', 'Flur']]) {
  await page.click('#add-btn'); await page.fill('#f-type', type); await page.fill('#f-room', room);
  await page.fill('#f-watered', '2026-09-01'); await page.fill('#f-fertilized', '2026-09-01');
  await page.click('#save-btn');
  await page.waitForFunction(() => !document.getElementById('form-dialog').open);
}
await page.waitForTimeout(200);
const ringTag = await page.evaluate(() => document.querySelector('#summary .ring-card[data-care="water"]')?.tagName);
check(ringTag === 'BUTTON', `Gießen-Kreis ist ein <button> (${ringTag})`);
const ringOk = async kind => Number((await page.locator(`#summary .ring-card[data-care="${kind}"] .ring-label`).first().evaluate(e => e.firstChild.textContent)).trim());
const wOk0 = await ringOk('water');
await page.click('#summary .ring-card[data-care="water"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => document.getElementById('care-dialog').open), 'Pflege-Dialog (Gießen) geöffnet');
check((await page.textContent('#care-title')).includes('Gießen'), `Dialogtitel: ${await page.textContent('#care-title')}`);
const items0 = await page.locator('#care-dialog .care-item').count();
check(items0 >= 3, `Überfällige Pflanzen gelistet (${items0})`);
check((await page.locator('#care-dialog .care-item-btn[data-water]').count()) === items0, 'Jede Zeile hat Gießen-Button (data-water)');
check((await page.textContent('#care-body')).includes('Aloe Vera'), 'Aloe Vera in der Fällig-Liste');
await page.screenshot({ path: path.join(shots, '12-care-dialog.png') });
const firstName = (await page.locator('#care-dialog .care-item .care-item-name').first().textContent()).trim();
await page.locator('#care-dialog .care-item-btn').first().click();
await page.waitForFunction(n => document.querySelectorAll('#care-dialog .care-item').length === n, items0 - 1, { timeout: 3000 }).catch(() => {});
check((await page.locator('#care-dialog .care-item').count()) === items0 - 1, `Gegossene Pflanze „${firstName}“ verschwindet aus der Liste`);
check(!(await page.locator('#care-dialog .care-item .care-item-name').allTextContents()).some(t => t.trim() === firstName), 'Name nicht mehr in der Liste');
check((await ringOk('water')) === wOk0 + 1, `Gießen-Kreis aktualisiert (${wOk0} → ${await ringOk('water')})`);
check(await page.locator('#care-footer').isVisible(), '#care-footer sichtbar bei ≥2 fälligen');
await page.click('#care-all-btn');
await page.waitForSelector('#confirm-dialog[open]');
await page.screenshot({ path: path.join(shots, '13-care-alle-bestaetigen.png') });
await page.click('#confirm-dialog .confirm-ok');
await page.waitForSelector('#care-dialog .care-empty', { timeout: 3000 }).catch(() => {});
check(await page.locator('#care-dialog .care-empty').isVisible(), 'Nach „Alle gegossen“ erscheint Leer-Zustand');
check(await page.locator('#care-footer').isHidden(), '#care-footer wieder versteckt');
const wTot = await page.locator('#summary .ring-card[data-care="water"] .ring-label span').first().textContent();
check((await ringOk('water')) === Number(wTot.replace('/', '')), `Gießen-Kreis voll (${await ringOk('water')}${wTot})`);
await page.click('#care-dialog .modal-footer [data-close], #care-dialog .close-btn').catch(() => {});
await page.evaluate(() => document.getElementById('care-dialog').open && document.getElementById('care-dialog').close());
check(await page.evaluate(() => !document.getElementById('care-dialog').open), 'Pflege-Dialog geschlossen');

await page.click('#summary .ring-card[data-care="fert"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => document.getElementById('care-dialog').open), 'Pflege-Dialog (Düngen) geöffnet');
check((await page.textContent('#care-title')).includes('Düngen'), `Dialogtitel: ${await page.textContent('#care-title')}`);
const fItems = await page.locator('#care-dialog .care-item').count();
check(fItems >= 3 && (await page.locator('#care-dialog .care-item-btn[data-fert]').count()) === fItems, `Düngen-Liste mit data-fert-Buttons (${fItems})`);
await page.screenshot({ path: path.join(shots, '14-care-duengen.png') });
await page.locator('#care-dialog .care-item-btn').first().click();
await page.waitForFunction(n => document.querySelectorAll('#care-dialog .care-item').length === n, fItems - 1, { timeout: 3000 }).catch(() => {});
check((await page.locator('#care-dialog .care-item').count()) === fItems - 1, 'Düngen: Eintrag verschwindet nach Klick');
await page.click('#care-all-btn');
await page.waitForSelector('#confirm-dialog[open]');
await page.click('#confirm-dialog .confirm-ok');
await page.waitForSelector('#care-dialog .care-empty', { timeout: 3000 }).catch(() => {});
check(await page.locator('#care-dialog .care-empty').isVisible(), 'Düngen: „Alle gedüngt“ → Leer-Zustand');
await page.evaluate(() => document.getElementById('care-dialog').close());
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shots, '15-tabs-ringe-nachher.png') });

console.log('15. Finder „Mehr anzeigen“');
await page.click('.nav-btn[data-nav="finder"]');
await page.waitForSelector('#finder-results .result');
// Filter lockern, damit viele Treffer da sind
await page.evaluate(() => { const p = document.getElementById('fd-pet'); if (p.checked) p.click(); });
await page.click('label:has(input[name="fd-light"][value="bright"]) span').catch(() => {});
await page.waitForTimeout(150);
const cnt = async () => page.locator('#finder-results .result').count();
const parseTotal = async () => { const t = await page.textContent('#finder-count'); const g = Number((t.match(/(\d+) gut/) || [])[1] || 0); const r = Number((t.match(/(\d+) mit Einschr/) || [])[1] || 0); return g + r; };
let total = await parseTotal();
check(total > 20, `Mehr als 20 Treffer insgesamt (${total})`);
check((await cnt()) === 20, `Zunächst 20 Ergebnisse (${await cnt()})`);
check((await page.locator('#finder-more').count()) === 1, '#finder-more vorhanden');
await page.screenshot({ path: path.join(shots, '16-finder-mehr.png'), fullPage: true });
await page.click('#finder-more');
await page.waitForTimeout(150);
const c2 = await cnt();
check(c2 === Math.min(40, total), `Nach Klick ${c2} Ergebnisse (erwartet ${Math.min(40, total)})`);
let guard = 0;
while (await page.locator('#finder-more').count() && guard++ < 50) { await page.click('#finder-more'); await page.waitForTimeout(80); }
check((await page.locator('#finder-more').count()) === 0, '#finder-more verschwindet am Ende');
check((await cnt()) === total, `Alle Treffer angezeigt (${await cnt()} = ${total})`);
await page.click('label:has(input[name="fd-light"][value="shade"]) span');
await page.waitForTimeout(150);
const total2 = await parseTotal();
check((await cnt()) === Math.min(20, total2), `Filterwechsel setzt auf ${Math.min(20, total2)} zurück (${await cnt()})`);

console.log('16. Suche im Pflanzenbuch');
await page.click('.nav-btn[data-nav="plants"]');
await page.waitForSelector('.plant-card');
await page.waitForTimeout(200);
const lay = await page.evaluate(() => {
  const bar = document.getElementById('list-bar'), f = bar.querySelector('.search-field').getBoundingClientRect(), s = bar.querySelector('.sort-wrap').getBoundingClientRect();
  return { inBar: !!bar.querySelector('#plant-search') && !!bar.querySelector('#sort-select'), f: [f.left, f.right, f.width], s: [s.left, s.right, s.width], vw: innerWidth, ft: f.top, st: s.top };
});
check(lay.inBar, '#plant-search und #sort-select in #list-bar');
check(lay.f[1] <= lay.s[0] + 0.5 || lay.f[0] >= lay.s[1] - 0.5, `Suchfeld und Sortierung überlappen nicht horizontal (Suche ${lay.f[0].toFixed(0)}–${lay.f[1].toFixed(0)}, Sort ${lay.s[0].toFixed(0)}–${lay.s[1].toFixed(0)})`);
check(lay.f[0] >= 0 && lay.f[1] <= lay.vw && lay.s[0] >= 0 && lay.s[1] <= lay.vw, `Beide im Viewport (${lay.vw}px)`);
await page.screenshot({ path: path.join(shots, '17-pflanzensuche.png') });
const allCards = await page.locator('.plant-card').count();
await page.fill('#plant-search', 'Monika');
await page.waitForTimeout(150);
check((await page.locator('.plant-card').count()) === 1 && (await page.textContent('.card-name')).includes('Monika'), 'Suche nach Spitzname „Monika“ → nur Monika');
await page.fill('#plant-search', 'monstera');
await page.waitForTimeout(150);
check((await page.locator('.plant-card').count()) === 1 && (await page.textContent('.card-name')).includes('Monika'), 'Suche nach Art „monstera“ findet Monika');
await page.screenshot({ path: path.join(shots, '18-pflanzensuche-treffer.png') });
await page.fill('#plant-search', 'xyzxyz');
await page.waitForTimeout(150);
check((await page.locator('.plant-card').count()) === 0 && (await page.locator('.no-hits').count()) === 1, '„xyzxyz“ → .no-hits ohne Karten');
check((await page.locator('.no-hits button').count()) === 1, '.no-hits enthält Button');
await page.screenshot({ path: path.join(shots, '19-pflanzensuche-leer.png') });
await page.click('.no-hits button');
await page.waitForTimeout(300);
check((await page.inputValue('#wish-search')) === 'xyzxyz', '#wish-search übernimmt „xyzxyz“');
check(await page.locator('#wish-search-custom').isVisible(), '#wish-search-custom sichtbar');
check(await page.locator('#wish-search').isVisible(), 'Wunschliste-Ansicht aktiv (Suchfeld sichtbar)');
await page.click('.nav-btn[data-nav="plants"]');
await page.waitForTimeout(200);
check((await page.inputValue('#plant-search')) === 'xyzxyz', 'Pflanzensuche behält Begriff beim Zurückwechseln');
await page.click('#plant-search-clear');
await page.waitForTimeout(150);
check((await page.locator('.plant-card').count()) === allCards && (await page.locator('.no-hits').count()) === 0, `#plant-search-clear setzt Liste zurück (${allCards} Karten)`);

console.log('17. Wunschlisten-Suche');
await page.click('.nav-btn[data-nav="wishlist"]');
await page.waitForTimeout(200);
await page.fill('#wish-search', '');
await page.waitForTimeout(100);
check(await page.locator('#wish-search').isVisible(), '#wish-search sichtbar');
const wsTop = await page.evaluate(() => { const s = document.getElementById('wish-search').getBoundingClientRect(), i = document.querySelector('.wish-item'); return { s: s.top, i: i ? i.getBoundingClientRect().top : null }; });
check(wsTop.i === null || wsTop.s < wsTop.i, 'Suchfeld steht oberhalb der Wunschliste');
await page.fill('#wish-search', 'glucks');
await page.waitForTimeout(150);
const hitNames = await page.locator('.search-hit .search-hit-name').allTextContents();
check(hitNames.some(t => t.includes('Glückskastanie')), `„glucks“ findet Glückskastanie (${hitNames.map(s => s.trim()).join(', ')})`);
const hit = page.locator('.search-hit:has(.search-hit-name:has-text("Glückskastanie"))');
const wBefore = await page.locator('.wish-item').count();
await hit.locator('[data-swish]').click();
await page.waitForFunction(n => document.querySelectorAll('.wish-item').length === n, wBefore + 1, { timeout: 3000 }).catch(() => {});
check((await page.locator('.wish-item').count()) === wBefore + 1 && (await page.locator('.wish-item .name:has-text("Glückskastanie")').count()) === 1, 'Glückskastanie steht auf der Wunschliste');
check((await hit.textContent()).includes('gewünscht') && (await hit.locator('[data-swish]').count()) === 0, 'Treffer zeigt Chip „gewünscht“, kein 💜-Button mehr');
await page.screenshot({ path: path.join(shots, '20-wunschsuche.png') });
await page.fill('#wish-search', 'mon');
await page.waitForTimeout(150);
const nm = await page.locator('.search-hit').count();
check(nm === 6 && (await page.locator('#wish-search-more').count()) === 1, `„mon“ zeigt höchstens 6 Treffer (${nm}) plus #wish-search-more`);
await page.click('#wish-search-more');
await page.waitForTimeout(150);
const nm2 = await page.locator('.search-hit').count();
check(nm2 > 6 && (await page.locator('#wish-search-more').count()) === 0, `„Alle Treffer zeigen“ → ${nm2} Treffer`);
await page.screenshot({ path: path.join(shots, '21-wunschsuche-alle.png') });
await page.click('#wish-search-clear');

console.log('18. Android: Kamera-Auslöser über der Navigation');
for (const [w, h] of [[412, 740], [360, 640]]) {
  const actx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: w, height: h }, screen: { width: w, height: h }, permissions: ['camera'], locale: 'de-DE' });
  const ap = await actx.newPage();
  ap.on('pageerror', e => errors.push(`[android ${w}] ${e.message}`));
  ap.on('console', m => { if (m.type() === 'error') errors.push(`[android ${w}] ${m.text()}`); });
  await ap.goto(`${BASE}/?view=scan`, { waitUntil: 'networkidle' });
  await ap.waitForSelector('#scan-video', { state: 'visible', timeout: 8000 }).catch(() => {});
  await ap.waitForTimeout(500);
  check(await ap.locator('#scan-video').isVisible(), `[${w}x${h}] Kamera-Vorschau sichtbar`);
  const g = await ap.evaluate(() => {
    const s = document.getElementById('scan-shutter'), n = document.getElementById('nav');
    const sb = s.getBoundingClientRect(), nb = n.getBoundingClientRect();
    const el = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2);
    return { sBottom: sb.bottom, sTop: sb.top, nTop: nb.top, vh: innerHeight, hit: !!el && (el === s || s.contains(el)), hitTag: el && (el.id || el.className || el.tagName), dis: s.disabled };
  });
  check(g.sTop >= 0 && g.sBottom <= g.nTop, `[${w}x${h}] Auslöser (unten ${g.sBottom.toFixed(1)}) liegt über der Navigation (oben ${g.nTop.toFixed(1)}, Viewport ${g.vh})`);
  check(g.hit, `[${w}x${h}] Auslöser ist anklickbar (elementFromPoint: ${g.hitTag})`);
  await ap.screenshot({ path: path.join(shots, `22-android-${w}x${h}-kamera.png`) });
  await ap.click('#scan-shutter', { timeout: 5000 }).catch(() => {});
  await ap.waitForSelector('#scan-photo', { state: 'visible', timeout: 5000 }).catch(() => {});
  check(await ap.locator('#scan-photo').isVisible(), `[${w}x${h}] Klick auf Auslöser zeigt #scan-photo`);
  await ap.screenshot({ path: path.join(shots, `23-android-${w}x${h}-foto.png`) });
  await actx.close();
}

console.log('11. Desktop-Layout');
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shots, '09-desktop.png') });

check(errors.length === 0, errors.length ? `Konsolenfehler: ${errors.join(' | ')}` : 'Keine Konsolen-/Seitenfehler');
await browser.close();
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
