# 🌿 Pflanzenpflege

Mein Garten mit Gieß- und Düngeplan, **Pflanzenscan per Kamera**, **Standort-Finder** und **Wunschliste** –
als installierbare Web-App (PWA) für Handy, Tablet und Desktop. Ohne Build-Schritt, ohne Framework.

| Bereich | Was es kann |
|---|---|
| **Mein Garten** | Karten mit Fälligkeit für Gießen/Düngen, Statusringe, Sortierung, Gruppierung nach Raum, Detailansicht mit Pflegetipps, Saisontipps, Notizen und eigenen Intervallen |
| **Scan** | Live-Kamera oder Galerie-Foto → Erkennung der Art (Top-3 mit Wahrscheinlichkeit), Zustand auf dem Foto, Übernahme in Mein Garten oder auf die Wunschliste; ohne Server: manuelle Zuordnung |
| **Finder** | Licht, Luftfeuchte, Temperatur, Größe, Pflegeaufwand, haustiersicher, blühend, luftreinigend → bewertete Trefferliste (0–100 Punkte) mit Begründung |
| **Wünsche** | Priorität, Wunsch-Standort, Notiz, Foto; „Gekauft“ überführt den Wunsch in Mein Garten |
| **Mehr** | Untermenü „Sicherung & Gerätewechsel“ (exportieren/teilen/importieren), Erinnerungen, KI-Server-Einstellungen, Untermenü „Nutzungsstatistik & Cookies“, Design |
| **Bilder** | 1 Foto pro Pflanzenart aus Wikimedia Commons (frei lizenziert, lokal gespeichert) in Finder, Wunschliste, Scan und Mein Garten; eigene Fotos haben Vorrang; Bildnachweise unter `bildnachweise.html` |
| **Statistik** | Anonyme Ereignisse (welche Funktionen, welche Pflanzen) in Postgres; Auswertung unter `stats.html` mit Admin-Code |

Datenbank: 120 Pflanzen (gängige Zimmerpflanzen, aktuelle Trendpflanzen, beliebte Balkonpflanzen) mit strukturierten Werten (Lichtstufen, Luftfeuchte, Temperaturbereich, Giftigkeit für Haustiere, Größe, Kategorie für Saisontipps, Aliase für die Scan-Zuordnung, Trend- und Balkon-Kennzeichen) in `js/plants-db.js` und `js/plants-more.js`.

## Schnellstart (lokal)

```bash
npm install
npm run dev            # http://localhost:5173
```

Mit Pflanzenerkennung:

```bash
cp .env.example .env   # ANTHROPIC_API_KEY eintragen
set -a; source .env; set +a; npm run dev
```

Tests (Chromium über Playwright, kein Test-Runner nötig):

```bash
npm run dev &          # Server läuft
npm test               # Screenshots landen in test/screenshots/
```

## Aufbau

```
index.html              App-Shell (alle Ansichten + Dialoge)
css/app.css             Design-Tokens (hell/dunkel), Layout, Komponenten
js/app.js               Navigation, Mein Garten, Formular, Detail, Einstellungen, Service-Worker-Updates
js/scan.js              Kamera, Fotoaufnahme, Erkennung, manueller Fallback
js/finder.js            Standort-Finder (Bewertungsfunktion scorePlant)
js/wishlist.js          Wunschliste
js/plants-db.js         Pflanzendatenbank (Basis) + Saisontipps + Namensauflösung
js/plants-more.js       Pflanzendatenbank (Erweiterung: Trend- und Balkonpflanzen)
impressum.html, datenschutz.html   Rechtsseiten (Platzhalter ausfüllen)
fonts/, css/fonts.css   lokal eingebundene Schriften (keine Google-Anfragen)
js/store.js             IndexedDB (Pflanzen, Wünsche, Einstellungen), Export/Import, Migration v1
js/api.js               Client für /api/analyze
api/analyze.js          Serverless-Funktion (Vercel): Erkennung & Gesundheitscheck mit Claude
api/event.js            Serverless-Funktion: nimmt anonyme Nutzungsereignisse entgegen (Postgres)
api/stats.js            Serverless-Funktion: Auswertung, geschützt durch ADMIN_TOKEN
lib/db.js               Postgres-Verbindung (DATABASE_URL) und Tabellenanlage
js/analytics.js         Client: Ereignisse sammeln, bündeln, senden; Opt-out
stats.html              Auswertungsseite (Admin)
sw.js, manifest.webmanifest, icons/   PWA
dev-server.js           lokaler Server inkl. /api
scripts/make-icons.mjs  PNG-Icons aus SVG erzeugen
scripts/fetch-images.mjs  Pflanzenfotos von Wikipedia/Commons laden (einmalig, mit Lizenzprüfung) → img/plants/, js/plant-images.js
scripts/make-credits.mjs  bildnachweise.html aus scripts/plant-images.json erzeugen
test/e2e.mjs            End-to-End-Test
```

## Pflanzenerkennung aktivieren

Die Erkennung läuft über `api/analyze.js`. Die Funktion hält den Schlüssel, die App schickt nur das (auf 1024 px verkleinerte) Foto.

Umgebungsvariablen (siehe `.env.example`):

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Schlüssel von platform.claude.com |
| `ANTHROPIC_MODEL` | nein | Standard `claude-opus-5-5` |
| `APP_TOKEN` | empfohlen bei öffentlicher URL | Zugangscode; in der App unter *Mehr → Server-Adresse & Zugangscode* eintragen |
| `ALLOWED_ORIGIN` | nur bei getrenntem Hosting | erlaubte Ursprünge der App, kommagetrennt |

Die Funktion nutzt den serverseitigen Modell-Fallback (`fallbacks: "default"`), damit ein abgelehnter Einzelfall nicht die ganze Analyse scheitern lässt. Pro Scan werden etwa 1 500–2 500 Token verbraucht, also wenige Cent.

## Nutzungsstatistik aktivieren (Stufe 2)

Ohne `DATABASE_URL` sendet die App nichts und die Funktion antwortet mit 503. Mit Datenbank:

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | Postgres-Verbindung, z. B. Neon über den Vercel-Marketplace (kostenloser Plan reicht lange) |
| `ADMIN_TOKEN` | Zugangscode für `stats.html` und `/api/stats` |

Die Tabelle `events` wird beim ersten Ereignis automatisch angelegt. Gespeichert werden Ereignistyp, wenige Eigenschaften (Pflanzenart, Finder-Kriterien, Scan-Ergebnis), eine zufällige Geräte-Kennung, App-Version und Plattform. Keine IP-Adressen, Fotos, Namen oder Notizen. Die Statistik ist standardmäßig aus und wird beim ersten Start per Einwilligungsdialog abgefragt; unter *Mehr → Nutzungsstatistik & Cookies* lässt sie sich widerrufen und die Kennung erneuern. Cookies setzt die App nicht.

Ereignisse: `app_open`, `plant_added`, `plant_deleted`, `care`, `scan`, `diagnose`, `finder_search`, `wish_added`, `wish_bought`, `backup`.

Alte Daten werden automatisch gelöscht: Ein täglicher Vercel-Cron (`vercel.json`) ruft `/api/cleanup` auf und entfernt Ereignisse, die älter als 24 Monate sind. Dafür in Vercel unter *Settings → Environment Variables* die Variable `CRON_SECRET` setzen (beliebiger langer Zufallswert); Vercel sendet sie beim Cron-Aufruf automatisch mit. Ohne `CRON_SECRET` löscht die Funktion nichts. Manuell geht es weiterhin per SQL:

```sql
DELETE FROM events WHERE ts < now() - interval '24 months';
```

## Veröffentlichen

Schritt-für-Schritt-Anleitung bis zur Veröffentlichung (Hosting, Domain, Installation auf Geräten, App-Stores, Datenschutz): **[VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md)**.

## Daten & Datenschutz

- Alle Daten (Pflanzen, Fotos, Wünsche) liegen in der IndexedDB des Browsers auf dem Gerät.
- Gerätewechsel: *Mehr → Sicherung & Gerätewechsel → Sicherung exportieren* und auf dem neuen Gerät importieren (oder per Teilen-Funktion direkt senden).
- Nur für Scan und Gesundheitscheck wird ein Foto an deinen Server und von dort an die Claude-API gesendet.

## Grenzen / mögliche nächste Schritte

- **Kein automatischer Abgleich zwischen Geräten.** Dafür wäre ein Konto-Backend nötig (z. B. Supabase); Export/Import deckt den Gerätewechsel ab.
- **Erinnerungen** erscheinen beim Öffnen der App (und als App-Badge). Echte Push-Benachrichtigungen im Hintergrund brauchen einen Push-Server.
- Neue Pflanze mit Bild: Eintrag in `js/plants-more.js`, dann `node scripts/fetch-images.mjs "Name"` und `node scripts/make-credits.mjs`.
- Die Pflanzendatenbank lässt sich in `js/plants-more.js` erweitern; neue Einträge sind sofort in Finder, Scan-Zuordnung und Autocomplete verfügbar.
