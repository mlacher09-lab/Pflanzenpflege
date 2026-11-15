// Test der reinen Wetter-Funktionen ohne Netz: node test/weather.test.mjs
import assert from 'node:assert/strict';
import { isOutdoor, rainSummary, pickBanner, weatherStatusText } from '../js/weather.js';
import { PLANT_DB } from '../js/plants-db.js';

let n = 0;
const test = (name, fn) => { try { fn(); n++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.stack); process.exitCode = 1; } };
const T = '2026-06-10';
const daily = (rain, mins) => ({ time: ['2026-06-08', '2026-06-09', T, '2026-06-11'], precipitation_sum: rain, temperature_2m_min: mins });
const due = () => true;
const outdoorType = Object.keys(PLANT_DB).find(k => PLANT_DB[k].indoor === false);
const indoorType = Object.keys(PLANT_DB).find(k => PLANT_DB[k].indoor !== false);
const tender = Object.keys(PLANT_DB).find(k => PLANT_DB[k].tmin > -5 && PLANT_DB[k].indoor !== false);
const hardy = Object.keys(PLANT_DB).find(k => PLANT_DB[k].tmin <= -5);
const P = (id, o = {}) => ({ id, type: indoorType, room: 'Balkon', ...o });

test('isOutdoor: Raum und Art', () => {
  assert.ok(isOutdoor({ type: indoorType, room: 'Balkon' }));
  assert.ok(isOutdoor({ type: indoorType, room: 'Hinterer Garten' }));
  assert.ok(isOutdoor({ type: indoorType, room: 'Draußen' }));
  assert.ok(!isOutdoor({ type: indoorType, room: 'Wohnzimmer' }));
  assert.ok(!isOutdoor({ type: indoorType }));
  if (outdoorType) assert.ok(isOutdoor({ type: outdoorType, room: 'Flur' }));
});
test('rainSummary summiert gestern+heute und nimmt morgen separat', () => {
  const s = rainSummary(daily([9, 3, 2.5, 6], [8, 7, 5, 3]), T);
  assert.equal(s.pastMm, 5.5); assert.equal(s.forecastMm, 6); assert.equal(s.minTemp, 3);
});
test('rainSummary: null-Werte und leere Daten', () => {
  const s = rainSummary(daily([null, null, null, null], [null, null, null, null]), T);
  assert.equal(s.pastMm, 0); assert.equal(s.minTemp, null);
  assert.equal(rainSummary(undefined, T).pastMm, 0);
});
test('Regen seit gestern -> rain-Banner mit Aktion', () => {
  const b = pickBanner({ summary: rainSummary(daily([0, 5, 3, 0], [9, 9, 9, 9]), T), plants: [P('a'), P('b', { room: 'Bad' })], todayISO: T, dueFn: due });
  assert.equal(b.kind, 'rain'); assert.deepEqual(b.ids, ['a']); assert.equal(b.action, 'markWatered');
  assert.match(b.text, /Seit gestern 8 mm Regen/);
});
test('Regen vor letztem Gießen zählt nicht', () => {
  const s = rainSummary(daily([0, 6, 0, 0], [9, 9, 9, 9]), T);
  assert.equal(pickBanner({ summary: s, plants: [P('a', { lastWatered: T })], todayISO: T, dueFn: due }), null);
});
test('Vorhersage morgen >= 5 mm -> forecast', () => {
  const b = pickBanner({ summary: rainSummary(daily([0, 0, 0, 6], [9, 9, 9, 9]), T), plants: [P('a')], todayISO: T, dueFn: due });
  assert.equal(b.kind, 'forecast'); assert.match(b.text, /Morgen sind 6 mm/);
});
test('nichts fällig -> kein Regen-Banner; unter Schwelle -> null', () => {
  assert.equal(pickBanner({ summary: rainSummary(daily([0, 9, 9, 9], [9, 9, 9, 9]), T), plants: [P('a')], todayISO: T, dueFn: () => false }), null);
  assert.equal(pickBanner({ summary: rainSummary(daily([0, 1, 1, 1], [9, 9, 9, 9]), T), plants: [P('a')], todayISO: T, dueFn: due }), null);
});
test('Frost hat Vorrang, Namen max. 3, Minuszeichen', () => {
  const plants = ['A', 'B', 'C', 'D'].map((x, i) => P('p' + i, { type: tender, nickname: x }));
  const b = pickBanner({ summary: rainSummary(daily([0, 9, 9, 9], [0, 0, 5, -2]), T), plants, todayISO: T, dueFn: () => false });
  assert.equal(b.kind, 'frost'); assert.match(b.text, /Frost bis −2 °C erwartet – A, B, C u\. a\. reinholen/);
});
test('winterharte Pflanzen lösen keinen Frost aus', () => {
  if (!hardy) return;
  const b = pickBanner({ summary: rainSummary(daily([0, 0, 0, 0], [0, 0, -8, -8]), T), plants: [P('h', { type: hardy })], todayISO: T, dueFn: () => false });
  assert.equal(b, null);
});
test('keine Außenpflanzen -> null; weatherStatusText Standard', () => {
  assert.equal(pickBanner({ summary: rainSummary(daily([0, 9, 9, 9], [-5, -5, -5, -5]), T), plants: [P('x', { room: 'Küche' })], todayISO: T, dueFn: due }), null);
  assert.equal(weatherStatusText(), 'Aus');
});
console.log(`${n} Tests bestanden`);
