// Lädt einmalig frei lizenzierte Vorschaubilder (Wikipedia/Wikimedia Commons) für alle Pflanzen der Datenbank
// nach img/plants/ und schreibt js/plant-images.js mit Bildnachweisen. Wiederaufnehmbar; respektiert Pausen.
//   node scripts/fetch-images.mjs            alle fehlenden Bilder holen
//   node scripts/fetch-images.mjs Monstera   nur eine Pflanze (neu) holen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PLANT_DB } from '../js/plants-db.js';
const run = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'img', 'plants');
const cacheFile = path.join(root, 'scripts', 'plant-images.json');
const UA = 'PflanzenpflegeImageFetcher/1.0 (https://github.com/mlacher09-lab/pflanzenpflege; one-off fetch of plant thumbnails)';
const WIDTH = 480;
const OK_LICENSE = /^(cc0|cc by|cc by-sa|cc-by|public domain|pd|gfdl|no restrictions|attribution)/i;

fs.mkdirSync(outDir, { recursive: true });
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const only = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Abruf über curl, damit der HTTPS-Proxy der Umgebung (HTTPS_PROXY) genutzt wird; Node-fetch ignoriert ihn.
async function get(url, asJson = true, toFile = null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const args = ['-sS', '-A', UA, '-H', `Accept: ${asJson ? 'application/json' : '*/*'}`, '-w', '\n%{http_code} %{content_type}', url];
    if (toFile) args.splice(args.length - 1, 0, '-o', toFile);
    let out;
    try { out = (await run('curl', args, { maxBuffer: 50 * 1024 * 1024 })).stdout; } catch (e) { await sleep(5000); continue; }
    const nl = out.lastIndexOf('\n');
    const [status, type] = out.slice(nl + 1).trim().split(' ');
    const body = out.slice(0, nl);
    if (status === '429' || status >= '500') { await sleep(15000 * (attempt + 1)); continue; }
    if (status !== '200') return null;
    if (toFile) return { type: type || '' };
    return asJson ? JSON.parse(body) : body;
  }
  return null;
}
const slug = s => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function candidates(name, p) {
  const sci = p.sci.replace(/['’][^'’]*['’]/g, '').replace(/\b(sp\.|ssp\.|hybriden|var\.|x)\b.*$/i, '').split(/[\/,]/)[0].trim();
  const two = sci.split(/\s+/).slice(0, 2).join(' ');
  const genus = sci.split(/\s+/)[0];
  const list = [two, name, ...p.aliases, genus].filter(Boolean);
  return [...new Set(list)];
}

async function pageImage(wiki, title) {
  const d = await get(`https://${wiki}.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail|name&pithumbsize=${WIDTH}&redirects=1&format=json&titles=${encodeURIComponent(title)}`);
  const page = d && Object.values(d.query?.pages || {})[0];
  if (!page || !page.thumbnail || !page.pageimage) return null;
  return { thumb: page.thumbnail.source.split('?')[0], file: page.pageimage, page: page.title, wiki };
}
async function license(file) {
  const d = await get(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + file)}&prop=imageinfo&iiprop=extmetadata|url&format=json`);
  const page = d && Object.values(d.query?.pages || {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata || {};
  return { by: strip(m.Artist?.value) || 'unbekannt', lic: strip(m.LicenseShortName?.value) || '', licUrl: m.LicenseUrl?.value || '', url: ii.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}` };
}

const names = Object.keys(PLANT_DB).filter(n => !only || n === only);
let done = 0, skipped = 0;
for (const name of names) {
  if (cache[name] && !only && fs.existsSync(path.join(outDir, cache[name].f))) { skipped++; continue; }
  const p = PLANT_DB[name];
  let hit = null, lic = null;
  outer: for (const wiki of ['de', 'en']) {
    for (const title of candidates(name, p)) {
      const img = await pageImage(wiki, title); await sleep(600);
      if (!img) continue;
      const l = await license(img.file); await sleep(600);
      if (!l || !OK_LICENSE.test(l.lic)) { console.log(`  ✗ ${name}: ${img.file} (${l?.lic || 'keine Lizenzinfo'}) – übersprungen`); continue; }
      hit = img; lic = l; break outer;
    }
  }
  if (!hit) { console.log(`  – ${name}: kein Bild gefunden`); cache[name] = null; fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1)); continue; }
  const tmp = path.join(outDir, `.${slug(name)}.part`);
  const res = await get(hit.thumb, false, tmp); await sleep(400);
  const type = res?.type || '';
  if (!res || !type.startsWith('image/')) { console.log(`  ✗ ${name}: Download fehlgeschlagen (${type})`); try { fs.unlinkSync(tmp); } catch {} continue; }
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const f = `${slug(name)}.${ext}`;
  fs.renameSync(tmp, path.join(outDir, f));
  cache[name] = { f, by: lic.by.slice(0, 80), lic: lic.lic, licUrl: lic.licUrl, url: lic.url, src: `${hit.wiki}:${hit.page}` };
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  done++;
  console.log(`  ✓ ${name} ← ${hit.file} (${lic.lic}, ${lic.by.slice(0, 40)})`);
}

// Modul für die App schreiben
const entries = Object.entries(cache).filter(([, v]) => v && fs.existsSync(path.join(outDir, v.f)));
const js = `// Automatisch erzeugt von scripts/fetch-images.mjs – Vorschaubilder aus Wikimedia Commons mit Bildnachweis.\n// f = Datei in img/plants/, by = Urheber, lic = Lizenz, url = Quelle\nexport const PLANT_IMAGES = ${JSON.stringify(Object.fromEntries(entries.map(([k, v]) => [k, { f: v.f, by: v.by, lic: v.lic, url: v.url }])), null, 1)};\n`;
fs.writeFileSync(path.join(root, 'js', 'plant-images.js'), js);
console.log(`\n${done} neu geladen, ${skipped} vorhanden, ${entries.length} Bilder gesamt, ${names.length - entries.length} ohne Bild`);
