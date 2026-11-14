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

console.log('11. Desktop-Layout');
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shots, '09-desktop.png') });

check(errors.length === 0, errors.length ? `Konsolenfehler: ${errors.join(' | ')}` : 'Keine Konsolen-/Seitenfehler');
await browser.close();
console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
