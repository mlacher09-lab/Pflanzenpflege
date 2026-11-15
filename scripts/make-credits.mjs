// Erzeugt bildnachweise.html aus scripts/plant-images.json (nach scripts/fetch-images.mjs ausführen).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'plant-images.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rows = Object.entries(data).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b, 'de'))
  .map(([name, v]) => `<tr><td><img src="img/plants/${v.f}" alt="" loading="lazy" width="56" height="56" style="border-radius:8px;object-fit:cover"></td><td><strong>${esc(name)}</strong></td><td>${esc(v.by)}</td><td>${v.licUrl ? `<a href="${esc(v.licUrl)}" rel="license noopener" target="_blank">${esc(v.lic)}</a>` : esc(v.lic)}</td><td><a href="${esc(v.url)}" rel="noopener" target="_blank">Commons</a></td></tr>`).join('\n');
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Bildnachweise – Pflanzenpflege</title>
<meta name="robots" content="noindex">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/app.css">
<link rel="stylesheet" href="css/legal.css">
<style>.legal { max-width: 900px; } .legal td { font-size: 13px; } .legal td:first-child { width: 64px; }</style>
</head>
<body>
<main class="legal">
  <a class="back" href="./?view=more">‹ Zurück zur App</a>
  <h1>Bildnachweise</h1>
  <p class="stand">Die Pflanzenfotos in Finder, Wunschliste und Mein Garten stammen aus <a href="https://commons.wikimedia.org" rel="noopener" target="_blank">Wikimedia Commons</a> und stehen unter den jeweils angegebenen freien Lizenzen. Sie wurden auf 480 Pixel Breite verkleinert und werden mit der App ausgeliefert. Eigene Fotos der Nutzerinnen und Nutzer ersetzen sie in der Anzeige.</p>
  <table>
    <tr><th></th><th>Pflanze</th><th>Urheber</th><th>Lizenz</th><th>Quelle</th></tr>
${rows}
  </table>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'bildnachweise.html'), html);
console.log(`bildnachweise.html mit ${rows.split('\n').length} Einträgen geschrieben`);
