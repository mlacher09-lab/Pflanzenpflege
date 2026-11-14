// Verkleinert die Bilder in img/plants/ auf max. 400 px Kantenlänge und komprimiert sie als JPEG (über Chromium/Playwright).
// Nach scripts/fetch-images.mjs ausführen:  node scripts/optimize-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'img', 'plants');
const MAX = 400, QUALITY = 0.78;

const browser = await chromium.launch();
const page = await browser.newPage();
let before = 0, after = 0, n = 0;
for (const f of fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f))) {
  const file = path.join(dir, f);
  const size = fs.statSync(file).size;
  if (size < 45_000) { after += size; before += size; continue; } // schon klein genug
  const dataUrl = `data:image/${f.endsWith('.png') ? 'png' : f.endsWith('.webp') ? 'webp' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;
  const out = await page.evaluate(async ({ dataUrl, MAX, QUALITY }) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    let { width: w, height: h } = img;
    const s = Math.min(1, MAX / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', QUALITY);
  }, { dataUrl, MAX, QUALITY });
  const buf = Buffer.from(out.split(',')[1], 'base64');
  if (buf.length < size) {
    const target = file.replace(/\.(png|webp)$/i, '.jpg');
    fs.writeFileSync(target, buf);
    if (target !== file) fs.unlinkSync(file);
    before += size; after += buf.length; n++;
  } else { before += size; after += size; }
}
await browser.close();
// Dateinamen in der Cache-Datei angleichen (png/webp → jpg)
const cacheFile = path.join(root, 'scripts', 'plant-images.json');
if (fs.existsSync(cacheFile)) {
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  for (const v of Object.values(cache)) if (v && !fs.existsSync(path.join(dir, v.f))) { const jpg = v.f.replace(/\.(png|webp)$/i, '.jpg'); if (fs.existsSync(path.join(dir, jpg))) v.f = jpg; }
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
}
console.log(`${n} Bilder verkleinert: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
