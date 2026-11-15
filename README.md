# 🌿 Pflanzenpflege

Mein Garten mit Gieß- und Düngeplan, **Pflanzenscan per Kamera**, **Standort-Finder** und **Wunschliste** –
als installierbare Web-App (PWA) für Handy, Tablet und Desktop. Ohne Build-Schritt, ohne Framework.

| Bereich | Was es kann |
|---|---|
| **Mein Garten** | Karten mit Fälligkeit für Gießen/Düngen, Statusringe, Sortierung, Gruppierung nach Raum, Detailansicht mit Pflegetipps, Saisontipps, Notizen und eigenen Intervallen |
| **Scan** | Live-Kamera oder Galerie-Foto → Erkennung der Art (Top-3 mit Wahrscheinlichkeit), Zustand auf dem Foto, Übernahme in Mein Garten oder auf die Wunschliste; ohne Server: manuelle Zuordnung |
| **Finder** | Licht, Luftfeuchte, Temperatur, Größe, Pflegeaufwand, haustiersicher, blühend, luftreinigend → bewertete Trefferliste (0–100 Punkte) mit Begründung |
| **Wünsche** | Priorität, Wunsch-Standort, Notiz, Foto; „Gekauft“ überführt den Wunsch in Mein Garten |
| **Mehr** | Konto & gemeinsamer Garten, Sicherung & Gerätewechsel, Erinnerungen (in der App und optional Push), Regen-Hinweise, Urlaubsmodus, Kalender-Export, KI-Server-Einstellungen, Nutzungsstatistik & Cookies, Design |
| **Pflege-Extras** | Düngepause nach dem Umtopfen, Umtopf-Erinnerung (alle `ry` Jahre, März–Juni), Ableger-Hinweis in der Saison, Rasen mit Mäh-Erinnerung, Vorher/Nachher-Vergleich (erstes und neuestes Foto), Mehrfachauswahl |
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
api/auth.js, api/sync.js  Nutzerkonten (E-Mail/Passwort) und Synchronisation
lib/auth.js             Passwort-Hashing, Sitzungen
js/account.js           Client: Anmeldung, Abgleich im Hintergrund
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
| `ANTHROPIC_MODEL_IDENTIFY` | nein | Modell für die Pflanzenerkennung, Standard `claude-haiku-5-5` |
| `ANTHROPIC_MODEL_DIAGNOSE` | nein | Modell für den Gesundheitscheck, Standard `claude-sonnet-5-5` |
| `ANTHROPIC_MODEL` | nein | Gemeinsame Überschreibung für beide, falls die zwei Variablen oben nicht gesetzt sind (z. B. `claude-opus-5-5`) |
| `APP_TOKEN` | empfohlen bei öffentlicher URL | Zugangscode; in der App unter *Mehr → Server-Adresse & Zugangscode* eintragen |
| `ALLOWED_ORIGIN` | nur bei getrenntem Hosting | erlaubte Ursprünge der App, kommagetrennt |

Der Gesundheitscheck (Sonnet) nutzt den serverseitigen Modell-Fallback (`fallbacks: "default"`), damit ein abgelehnter Einzelfall nicht die ganze Analyse scheitern lässt; für Haiku gibt es diesen Fallback nicht. Pro Scan werden grob 3 000–5 000 Token verbraucht. Kosten (Schätzung): eine Erkennung mit Haiku etwa 0,1 Cent, ein Gesundheitscheck mit Sonnet etwa 1–2 Cent (zum Vergleich: Opus für beides etwa 3 Cent pro Aufruf).

## Nutzungsstatistik aktivieren (Stufe 2)

Ohne `DATABASE_URL` sendet die App nichts und die Funktion antwortet mit 503. Mit Datenbank:

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | Postgres-Verbindung, z. B. Neon über den Vercel-Marketplace (kostenloser Plan reicht lange) |
| `ADMIN_TOKEN` | Zugangscode für `stats.html` und `/api/stats` |

Die Tabelle `events` wird beim ersten Ereignis automatisch angelegt. Gespeichert werden Ereignistyp, wenige Eigenschaften (Pflanzenart, Finder-Kriterien, Scan-Ergebnis), eine zufällige Geräte-Kennung, App-Version und Plattform. Keine IP-Adressen, Fotos, Namen oder Notizen. Die Statistik ist standardmäßig aus und wird beim ersten Start per Einwilligungsdialog abgefragt; unter *Mehr → Nutzungsstatistik & Cookies* lässt sie sich widerrufen und die Kennung erneuern. Cookies setzt die App nicht.

Ereignisse: `app_open`, `plant_added`, `plant_deleted`, `care`, `scan`, `diagnose`, `finder_search`, `wish_added`, `wish_bought`, `backup`.

Alte Daten werden automatisch gelöscht: Ein täglicher Vercel-Cron (`vercel.json`) ruft `/api/cleanup` auf und entfernt Ereignisse, die älter als 24 Monate sind, sowie abgelaufene Anmelde-Sitzungen. Dafür in Vercel unter *Settings → Environment Variables* die Variable `CRON_SECRET` setzen (beliebiger langer Zufallswert); Vercel sendet sie beim Cron-Aufruf automatisch mit. Ohne `CRON_SECRET` löscht die Funktion nichts. Manuell geht es weiterhin per SQL:

```sql
DELETE FROM events WHERE ts < now() - interval '24 months';
```

## Nutzerkonten & Synchronisation

Unter *Mehr → Konto* kann man sich mit E-Mail und Passwort registrieren bzw. anmelden. Ohne Anmeldung läuft die App als **Gast** wie bisher (alles nur auf dem Gerät).

- **Speicher:** dieselbe Postgres-Datenbank wie die Statistik (`DATABASE_URL`). Tabellen `users`, `sessions`, `items` werden automatisch angelegt.
- **Passwörter:** scrypt mit zufälligem Salt; Sitzungs-Token (180 Tage) werden nur als SHA-256-Hash gespeichert. Gleiche Fehlermeldung für unbekannte E-Mail und falsches Passwort, Sperre nach vielen Fehlversuchen.
- **Offline-first:** IndexedDB bleibt die Arbeitskopie. Jede Änderung bekommt `updatedAt` und landet im Ausgang (`js/store.js`); `js/account.js` gleicht ca. 3 s nach einer Änderung, beim Öffnen und bei wiederhergestellter Verbindung ab (`/api/sync`, Pakete ≤ 3 MB wegen des Vercel-Limits). Konflikte: neuere Änderung gewinnt pro Pflanze/Wunsch. Der Abruf nutzt eine Server-Sequenz, damit abweichende Geräteuhren nichts verlieren.
- **Beim Anmelden** werden vorhandene Gast-Daten ins Konto übernommen. Beim Abmelden bleiben die Daten wahlweise als Gast auf dem Gerät.
- Nicht synchronisiert: Zugangscode, Server-Adresse, Statistik-Einwilligung/-Kennung, Erinnerungsstatus (gerätespezifisch).
- Ohne `DATABASE_URL` zeigt die App nur den Gast-Modus.

Test: `npm run test:accounts` (nutzt pg-mem, keine echte Datenbank nötig).

Grenzen: keine „Passwort vergessen“-Funktion (bräuchte E-Mail-Versand, z. B. über Resend); Fotos liegen als Data-URL in der Datenbank – für sehr große Gärten wäre ein Objektspeicher (Vercel Blob) sparsamer.

## Gemeinsamer Garten (Haushalt / WG)

*Mehr → Gemeinsamer Garten* (Konto nötig): Garten anlegen oder mit Einladungscode beitreten (max. 10 Mitglieder). Alle Mitglieder synchronisieren denselben Datenraum (`items.user_id` = Haushalts-ID, siehe `lib/space.js`) und sehen, wer zuletzt gegossen/gedüngt hat. Beim Verlassen kann eine Kopie in den persönlichen Garten übernommen werden; beim Abmelden wird der gemeinsame Garten vom Gerät entfernt (er bleibt im Haushalt). Test: `npm run test:household`.

## Push-Erinnerungen (optional)

Echte Benachrichtigungen auch bei geschlossener App, nur für die gewählten Kategorien (Gießen, Düngen, Umtopfen, Ableger, Rasen mähen) und nur für angemeldete Nutzer (der Server braucht die Pflanzendaten). Ein täglicher Vercel-Cron (`/api/push-cron`, 06:43 UTC) verschickt eine gebündelte Nachricht.

| Variable | Bedeutung |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Schlüsselpaar, einmalig erzeugen: `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | Kontakt für die Push-Dienste, z. B. `mailto:du@example.de` |
| `CRON_SECRET` | wie bei der Bereinigung – ohne ihn verschickt der Cron nichts |

Es werden nur Endpunkte der bekannten Push-Dienste (Google, Mozilla, Apple, Microsoft) angenommen. iOS: ab 16.4 und nur, wenn die App zum Home-Bildschirm hinzugefügt wurde. Test: `npm run test:push`.

## Regen-Hinweise, Urlaubsmodus, Kalender

- **Regen-Hinweise** (`js/weather.js`, opt-in): nur für Balkon-/Gartenpflanzen (`indoor:false` oder Raum wie „Balkon“). Beim Öffnen der App Hinweis bei Regen seit gestern, angesagtem Regen oder Frost. Daten von Open-Meteo (ohne Schlüssel), Koordinaten auf ca. 1 km gerundet, Ort nur auf dem Gerät gespeichert. Test: `node test/weather.test.mjs`.
- **Urlaubsmodus** (`js/vacation.js`): was vor der Abreise gegossen werden muss, wer durchhält, wer Hilfe braucht (mit Terminen); Pflegeanleitung für Helfer teilen/drucken; Anleitungen zur Selbstbewässerung (DIY).
- **Kalender-Export** (`js/ical.js`): Gieß-, Dünge- und Mähtermine der nächsten Wochen als `.ics`. Test: `node test/vacation.test.mjs`.

## Veröffentlichen

Schritt-für-Schritt-Anleitung bis zur Veröffentlichung (Hosting, Domain, Installation auf Geräten, App-Stores, Datenschutz): **[VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md)**.

## Daten & Datenschutz

- Alle Daten (Pflanzen, Fotos, Wünsche) liegen in der IndexedDB des Browsers auf dem Gerät.
- Gerätewechsel: *Mehr → Sicherung & Gerätewechsel → Sicherung exportieren* und auf dem neuen Gerät importieren (oder per Teilen-Funktion direkt senden).
- Nur für Scan und Gesundheitscheck wird ein Foto an deinen Server und von dort an die Claude-API gesendet.

## Grenzen / mögliche nächste Schritte

- **Später umsetzen (Erinnerung):** Licht messen mit Handykamera bzw. Lichtsensor als Hilfe für den Standort-Finder.
- Zurückgestellt: QR-Etiketten, KI-Rückfragen, Schädlings-Lexikon, Ableger-Tausch.

- **Erinnerungen** erscheinen beim Öffnen der App (und als App-Badge); Push im Hintergrund nur für angemeldete Nutzer nach Auswahl.
- Neue Pflanze mit Bild: Eintrag in `js/plants-more.js`, dann `node scripts/fetch-images.mjs "Name"` und `node scripts/make-credits.mjs`.
- Die Pflanzendatenbank lässt sich in `js/plants-more.js` erweitern; neue Einträge sind sofort in Finder, Scan-Zuordnung und Autocomplete verfügbar.
