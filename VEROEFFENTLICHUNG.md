# Schritte bis zur Veröffentlichung

Ziel: Die App läuft unter einer eigenen HTTPS-Adresse, lässt sich auf iPhone, Android und Desktop installieren und die Pflanzenerkennung funktioniert. Optional danach: App-Stores.

## 1. Code auf GitHub

1. Auf github.com ein neues, leeres Repository anlegen (z. B. `pflanzenpflege`, privat oder öffentlich).
2. Lokal im Projektordner:

```bash
git remote add origin https://github.com/DEIN-NAME/pflanzenpflege.git
git push -u origin main
```

## 2. Hosting inklusive Pflanzenerkennung: Vercel (empfohlen, kostenlos)

Vercel liefert die statischen Dateien aus und führt `api/analyze.js` als Serverless-Funktion aus. Kein Build nötig.

1. Auf vercel.com mit GitHub anmelden → **Add New → Project** → das Repository importieren.
2. Framework Preset: **Other**. Build Command und Output Directory leer lassen.
3. **Environment Variables** eintragen:
   - `ANTHROPIC_API_KEY` = dein Schlüssel von platform.claude.com (dort unter *API Keys* erstellen; Guthaben hinterlegen).
   - `APP_TOKEN` = ein frei gewählter langer Zugangscode (schützt deinen Schlüssel vor Fremdnutzung).
4. **Deploy**. Nach etwa einer Minute ist die App unter `https://pflanzenpflege-….vercel.app` erreichbar.
5. In der App auf dem Handy: *Mehr → Server-Adresse & Zugangscode* → nur den Zugangscode eintragen (Adresse leer lassen) → *Speichern & testen*. Unter *KI-Erkennung* muss „Bereit“ stehen.

Jeder weitere `git push` auf `main` veröffentlicht automatisch eine neue Version. Nutzer sehen beim nächsten Öffnen „Eine neue Version ist verfügbar“ (dafür bei jeder Änderung die Zeile `VERSION` in `sw.js` hochzählen).

### Alternative ohne Erkennung: GitHub Pages (nur statisch)

Repository → *Settings → Pages → Source: GitHub Actions*. Der Workflow `.github/workflows/pages.yml` veröffentlicht die App unter `https://DEIN-NAME.github.io/pflanzenpflege/`. Der Scan bietet dann nur die manuelle Zuordnung. Erkennung nachrüsten: die Vercel-Variante zusätzlich deployen, dort `ALLOWED_ORIGIN=https://DEIN-NAME.github.io` setzen und in der App unter *Mehr → Server-Adresse* die Vercel-URL eintragen.

## 3. Eigene Domain (optional)

Vercel → Project → *Settings → Domains* → Domain eintragen und die angezeigten DNS-Einträge beim Domain-Anbieter setzen. HTTPS-Zertifikat kommt automatisch. Die Kamera funktioniert nur über HTTPS (und `localhost`).

## 4. Auf Geräten installieren

- **iPhone/iPad (Safari):** Seite öffnen → Teilen-Symbol → *Zum Home-Bildschirm*. Danach startet die App im Vollbild, Kamera und Benachrichtigungen funktionieren wie in einer normalen App (Benachrichtigungen ab iOS 16.4, nur aus der installierten App heraus).
- **Android (Chrome):** Beim Öffnen erscheint das Banner *Als App installieren*; sonst Menü ⋮ → *App installieren*.
- **Desktop (Chrome/Edge):** Installations-Symbol in der Adressleiste.

## 5. Vor der Veröffentlichung an andere

- **Datenschutzerklärung und Impressum:** Beide Seiten liegen als `datenschutz.html` und `impressum.html` im Repository und sind unter *Mehr → Über* verlinkt. Vor der Veröffentlichung die Platzhalter in eckigen Klammern (Name, Anschrift, E-Mail, Datum) ersetzen und die gelben Hinweiskästen entfernen. Die Texte beschreiben die tatsächlichen Datenflüsse der App (Hosting bei Vercel, Fotos an Anthropic nur bei Scan, sonst alles lokal); sie sind eine Vorlage und keine Rechtsberatung.
- **Zugangscode** (`APP_TOKEN`) setzen, sonst kann jeder mit der URL deinen Schlüssel nutzen. Zusätzlich im Claude-Dashboard ein monatliches Ausgabenlimit setzen.
- **Testlauf auf echten Geräten:** Kamera (Rück-/Frontkamera), Galerie-Upload, Installation, Offline-Start (Flugmodus), Export/Import zwischen zwei Geräten.

## 6. App-Stores (optional)

Die PWA kann als Store-App verpackt werden; der Code bleibt derselbe.

| Weg | Aufwand | Kosten |
|---|---|---|
| **PWABuilder** (pwabuilder.com): URL eingeben → Pakete für Google Play (TWA) und iOS (Xcode-Projekt) erzeugen | gering | Google Play Developer: einmalig 25 USD · Apple Developer Program: 99 USD/Jahr |
| **Capacitor** (capacitorjs.com): `npm i @capacitor/core @capacitor/cli`, `npx cap init`, `npx cap add android/ios`, Web-Ordner = Projektordner | mittel; nötig, wenn native Funktionen (Push, Widgets) dazukommen sollen | wie oben |

Für beide Stores brauchst du: Icons (vorhanden, `icons/`), Screenshots (siehe `test/screenshots/`), Kurzbeschreibung, Datenschutzerklärungs-URL, bei Apple ein Mac mit Xcode zum Hochladen.

## 6a. Nutzungsstatistik einrichten (optional)

1. Vercel → dein Projekt → Reiter **Storage** → **Create Database** → **Neon** (Postgres) → kostenlosen Plan wählen → Region Frankfurt → **Create** und mit dem Projekt verbinden. Vercel trägt `DATABASE_URL` automatisch in die Environment Variables ein.
2. Unter **Environment Variables** zusätzlich `ADMIN_TOKEN` anlegen: ein langer, zufälliger Code nur für dich.
3. Unter **Deployments** ein **Redeploy** auslösen.
4. Auswertung: `https://deine-app.vercel.app/stats.html` öffnen und den Admin-Code eingeben. Zeitraum wählbar (7 Tage bis 1 Jahr).
5. In `datenschutz.html` im Abschnitt 5a den Datenbankanbieter und die Aufbewahrungsdauer eintragen.

Alternative ohne Vercel-Marketplace: ein kostenloses Projekt bei supabase.com oder neon.tech anlegen, dort die Verbindungs-URL kopieren und als `DATABASE_URL` eintragen.

## 7. Betrieb

- **Kosten:** Vercel Hobby-Plan kostenlos. Claude-API nach Verbrauch (Opus 5.5: 4 USD pro Million Eingabe-Token); ein Scan kostet grob 1–2 Cent.
- **Updates:** `sw.js` → `VERSION` erhöhen, committen, pushen. Fertig.
- **Fehlersuche:** Vercel → Project → *Logs* zeigt Fehler der Funktion (z. B. ungültiger Schlüssel).
