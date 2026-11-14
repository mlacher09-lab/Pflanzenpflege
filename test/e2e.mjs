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

console.log('11. Desktop-Layout');
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shots, '09-desktop.png') });

check(errors.length === 0, errors.length ? `Konsolenfehler: ${errors.join(' | ')}` : 'Keine Konsolen-/Seitenfehler');
await browser.close();
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
