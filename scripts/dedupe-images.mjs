// Entfernt Bildzuordnungen, bei denen mehrere Arten dasselbe Foto bekommen haben (Gattungs-Rückfall):
// das Bild bleibt nur beim kürzesten Namen (der Grundart), die anderen zeigen wieder das Emoji statt eines falschen Fotos.
//   node scripts/dedupe-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheFile = path.join(root, 'scripts', 'plant-images.json');
const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
const byUrl = {};
for (const [name, v] of Object.entries(cache)) if (v) (byUrl[v.url] ||= []).push(name);
let removed = 0;
for (const names of Object.values(byUrl)) {
  if (names.length < 2) continue;
  const keep = [...names].sort((a, b) => a.length - b.length || a.localeCompare(b, 'de'))[0];
  for (const n of names) if (n !== keep) { console.log(`  – ${n}: gleiches Bild wie ${keep} → entfernt`); const f = path.join(root, 'img', 'plants', cache[n].f); cache[n] = null; removed++; if (fs.existsSync(f)) fs.unlinkSync(f); }
}
fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
const entries = Object.entries(cache).filter(([, v]) => v && fs.existsSync(path.join(root, 'img', 'plants', v.f)));
fs.writeFileSync(path.join(root, 'js', 'plant-images.js'), `// Automatisch erzeugt von scripts/fetch-images.mjs – Vorschaubilder aus Wikimedia Commons mit Bildnachweis.\n// f = Datei in img/plants/, by = Urheber, lic = Lizenz, url = Quelle\nexport const PLANT_IMAGES = ${JSON.stringify(Object.fromEntries(entries.map(([k, v]) => [k, { f: v.f, by: v.by, lic: v.lic, url: v.url }])), null, 1)};\n`);
console.log(`${removed} Doppelzuordnungen entfernt, ${entries.length} Bilder bleiben`);
