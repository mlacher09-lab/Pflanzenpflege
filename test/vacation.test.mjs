import assert from 'node:assert/strict';
import { planVacation, buildGuide } from '../js/vacation.js';
import { buildICS, foldLine, icsEscape } from '../js/ical.js';

const mk = (id, type, o = {}) => ({ id, type, nickname: type, room: 'Wohnzimmer', ...o });
// Sommer (Juli), eigene Intervalle für deterministische Tests
const plants = [
  mk('a', 'Monstera', { waterInterval: 7, lastWatered: '2026-07-01' }),   // fällig 07-08 -> vor Abreise (Start 07-10), dann 07-17, 07-24
  mk('b', 'Ficus', { waterInterval: 30, lastWatered: '2026-07-09' }),     // fällig 08-08 -> hält durch
  mk('c', 'Kaktus', { waterInterval: 10, lastWatered: '2026-07-12' }),    // fällig 07-22 -> nicht vorher, Hilfe am 07-22 (Ende 07-24)
];
const plan = planVacation(plants, '2026-07-10', '2026-07-24');
assert.deepEqual(plan.before.map(p => p.id), ['a']);
assert.deepEqual(plan.hold.map(p => p.id), ['b']);
assert.deepEqual(plan.help.map(h => [h.plant.id, h.water]), [['a', ['2026-07-17']], ['c', ['2026-07-22']]]);
assert.equal(plan.days, 14);
const guide = buildGuide(plan);
assert.match(guide, /Fr, 17\.07\./); assert.match(guide, /Kaktus/);

// ICS
const ics = buildICS([mk('a', 'Monstera', { waterInterval: 7, lastWatered: '2026-07-01', nickname: 'Mon, "Ste;ra"' }),
  mk('b', 'Ficus', { waterInterval: 7, lastWatered: '2026-07-01' })], { weeks: 2, kinds: ['water'], startISO: '2026-07-10', now: new Date('2026-07-10T08:00:00Z') });
assert.ok(ics.endsWith('\r\n')); assert.ok(!/[^\r]\n/.test(ics));
assert.match(ics, /PRODID:-\/\/Pflanzenpflege\/\/DE/);
assert.match(ics, /DTSTAMP:20260710T080000Z/);
const events = ics.split('BEGIN:VEVENT').length - 1;
assert.equal(events, 2);  // 07-10 und 07-17 – je ein Termin für beide Pflanzen
assert.match(ics, /UID:20260710-water@pflanzenpflege/);
assert.match(ics, /DTSTART;VALUE=DATE:20260710\r\nDTEND;VALUE=DATE:20260711/);
for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, l);
const unfolded = ics.replace(/\r\n /g, '');
assert.ok(unfolded.includes('SUMMARY:💧 Gießen: Mon\\, "Ste\\;ra"\\, Ficus'));
assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
const long = foldLine('SUMMARY:' + '💧äö'.repeat(40));
for (const l of long.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75);
assert.equal(long.replace(/\r\n /g, ''), 'SUMMARY:' + '💧äö'.repeat(40));
// stabile UID
assert.equal(buildICS(plants, { startISO: '2026-07-10' }).match(/UID:.*/g).join(), buildICS(plants, { startISO: '2026-07-10' }).match(/UID:.*/g).join());
console.log('vacation tests ok');
