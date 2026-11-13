// Erzeugt preview/pflanzenpflege-preview.html: Vorschau-Datei für claude.ai-Artifacts (ohne eigenes HTML-Gerüst, CSS inline).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const fonts = '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">';
const out = `<title>Pflanzenpflege</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>\n${css}\nbody{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}main{padding-left:0;padding-right:0}#hdr{margin:0 -16px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}\n</style>\n<div class="card" style="margin:12px 0 0;font-size:13px">🔎 <strong>Vorschau</strong> – hier läuft die App zur Ansicht. Kamera-Livebild, Offline-Modus und KI-Erkennung sind erst in der veröffentlichten Version aktiv (Foto-Upload und manuelle Zuordnung funktionieren).</div>\n${body}`;
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview/pflanzenpflege-preview.html'), out);
console.log('preview geschrieben', out.length, 'Zeichen');
