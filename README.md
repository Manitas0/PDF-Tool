# PDF-Tool

**PDFs zusammenführen und teilen – direkt im Browser. Deine Dateien verlassen nie deinen Rechner.**

PDF-Tool ist eine kleine Web-App, die PDF-Dateien vollständig lokal in deinem Browser verarbeitet.
Es gibt keinen Server, keinen Upload und keinen Build-Schritt: Die Seite funktioniert über GitHub Pages,
über einen lokalen Webserver oder einfach per Doppelklick auf `index.html` – auch offline.

## Inhalt

- [Funktionen](#funktionen)
- [Datenschutz](#datenschutz)
- [Benutzung](#benutzung)
- [Seitenangaben – Syntax](#seitenangaben--syntax)
- [Einschränkungen](#einschränkungen)
- [Entwicklung](#entwicklung)
- [Lizenzen von Drittanbietern](#lizenzen-von-drittanbietern)

## Funktionen

**Zusammenführen**

- Beliebig viele PDFs per Drag & Drop oder Dateiauswahl hinzufügen – dieselbe Datei auch mehrfach
- Reihenfolge per Ziehen oder mit den Pfeil-Schaltflächen ändern
- Nach Dateiname sortieren (natürliche Sortierung: „Teil 2“ vor „Teil 10“)
- Pro Datei nur bestimmte Seiten übernehmen, z. B. `1-3, 7` (leer = alle Seiten)
- Vorschaubild der ersten Seite, Seitenzahl je Datei und Gesamtübersicht
- Frei wählbarer Dateiname für das Ergebnis

**Teilen**

| Modus | Ergebnis |
|---|---|
| Jede Seite einzeln | eine PDF pro Seite |
| Alle N Seiten | gleich große Teile mit je N Seiten (der letzte Teil ggf. kürzer) |
| Nach Seitenbereichen | eine PDF pro Bereich, z. B. `1-3, 4-6, 7-` |
| Seiten auswählen | **eine** PDF mit den gewählten Seiten – per Klick in der Seitenvorschau oder per Eingabe |

- Seitenvorschau aller Seiten mit Anzeige, in welcher Ausgabedatei eine Seite landet
- Live-Vorschau, welche Dateien entstehen, mit verständlichen Fehlermeldungen
- Download als ZIP-Archiv oder als einzelne Dateien

**Allgemein**

- Deutsche Oberfläche, vollständig per Tastatur bedienbar
- Heller und dunkler Modus (folgt der Systemeinstellung), funktioniert auch auf dem Smartphone
- Läuft offline und ohne Installation

## Datenschutz

Alles bleibt lokal:

- Die PDFs werden ausschließlich in deinem Browser mit JavaScript verarbeitet ([pdf-lib](https://pdf-lib.js.org/),
  [pdf.js](https://mozilla.github.io/pdf.js/) und [JSZip](https://stuk.github.io/jszip/)).
- Es wird nichts hochgeladen, es gibt keine Cookies, kein Tracking und keine externen Ressourcen
  (kein CDN, keine Webfonts). Alle Bibliotheken liegen im Ordner `vendor/`.
- Eine Content-Security-Policy unterbindet zusätzlich Netzwerkverbindungen aus der Seite heraus.
- pdf.js läuft mit `isEvalSupported: false` (Schutz vor CVE-2024-4367).

## Benutzung

### Online über GitHub Pages

1. Auf GitHub im Repository **Settings → Pages** öffnen.
2. Unter **Build and deployment** als *Source* **Deploy from a branch** wählen.
3. Den Branch (z. B. `main`) und den Ordner **`/ (root)`** auswählen und speichern.
4. Nach kurzer Zeit ist das Tool unter `https://<benutzername>.github.io/PDF-Tool/` erreichbar.

### Lokal ohne Installation

Repository herunterladen (*Code → Download ZIP* oder `git clone`) und **`index.html` doppelklicken**.
Die App läuft direkt aus dem Dateisystem (`file://`) – ganz ohne Server und Internetverbindung.

### Lokal mit Webserver

Mit [Node.js](https://nodejs.org/) (ab Version 18, empfohlen 22) startet ein kleiner Server ohne weitere Abhängigkeiten:

```sh
npm run serve              # http://127.0.0.1:8080/
PORT=3000 npm run serve    # anderer Port
```

### Kurzanleitung

**Zusammenführen:** PDFs in das Feld ziehen oder auswählen → Reihenfolge anpassen → bei Bedarf pro Datei
Seiten angeben → Dateinamen festlegen → **„PDFs zusammenführen“**. Der Download startet automatisch;
zusätzlich erscheint ein Download-Link.

**Teilen:** Tab **„Teilen“** öffnen → eine PDF laden → Modus wählen und ggf. Seiten angeben →
**„PDF teilen“**. Bei mehreren Ergebnisdateien wird – wenn „Als ZIP-Archiv herunterladen“ aktiv ist –
ein ZIP-Archiv heruntergeladen; außerdem erscheint für jede Datei ein eigener Link.

Dateinamen der Ergebnisse (Beispiel für `bericht.pdf`):

| Ergebnis | Dateiname |
|---|---|
| Teil mit den Seiten 1–3 | `bericht_S1-3.pdf` |
| Auswahl der Seiten 2, 5, 6 und 9 | `bericht_Auszug_S2_5-6_9.pdf` |
| ZIP-Archiv | `bericht_geteilt.zip` |

## Seitenangaben – Syntax

Seitenzahlen beginnen bei 1. Mehrere Angaben werden durch Komma oder Semikolon getrennt,
Leerzeichen spielen keine Rolle.

| Eingabe | Bedeutung | Beispiel bei 10 Seiten |
|---|---|---|
| `5` | einzelne Seite | Seite 5 |
| `1-3` | Bereich | Seiten 1, 2, 3 |
| `5-3` | absteigender Bereich – umgekehrte Reihenfolge | Seiten 5, 4, 3 |
| `7-` | ab einer Seite bis zum Ende | Seiten 7, 8, 9, 10 |
| `-3` | vom Anfang bis zu einer Seite | Seiten 1, 2, 3 |
| `1-3, 7` | mehrere Angaben (`,` oder `;`) | Seiten 1, 2, 3 und 7 |

Statt des Bindestrichs `-` sind auch `–` (Halbgeviertstrich) und `—` (Geviertstrich) erlaubt.
Seiten, die es im Dokument nicht gibt, führen zu einer Fehlermeldung, z. B.
„Seite 12 gibt es nicht – das Dokument hat nur 10 Seiten.“

Wie die Angaben verwendet werden, hängt von der Stelle ab:

| Wo | Wirkung von `1-3, 7-` |
|---|---|
| Zusammenführen, Feld „Seiten“ einer Datei | Seiten 1–3 und 7 bis Ende werden in dieser Reihenfolge übernommen (leer = alle Seiten; Seiten dürfen mehrfach vorkommen) |
| Teilen → Nach Seitenbereichen | jede Angabe wird eine eigene Datei: `S1-3` und `S7-10` |
| Teilen → Seiten auswählen | alle Seiten landen in **einer** PDF |

## Einschränkungen

- **Verschlüsselte bzw. passwortgeschützte PDFs werden nicht unterstützt.** Entferne den Schutz vorher
  mit einem anderen Programm.
- **Lesezeichen (Outlines), Formularfelder (AcroForm) und interne Links** gehen beim Zusammenführen und
  Teilen ggf. verloren. Der sichtbare Seiteninhalt bleibt erhalten.
- **Sehr große Dateien brauchen viel Arbeitsspeicher**, weil alles im Browser passiert. Auf schwächeren
  Geräten (z. B. älteren Smartphones) kann das an Grenzen stoßen.
- Die Vorschaubilder sind optional: Kann pdf.js eine Seite nicht darstellen, funktioniert das
  Zusammenführen und Teilen trotzdem.
- Benötigt einen aktuellen Browser (Chrome, Edge, Firefox oder Safari).

## Entwicklung

Voraussetzungen: Node.js 22 und npm. Es gibt keinen Build-Schritt – die Dateien im Repository werden so
ausgeliefert, wie sie sind.

```sh
npm install --omit=optional   # Abhängigkeiten (ohne das optionale native „canvas“-Paket von pdfjs-dist)
npm run vendor                # Browser-Builds von pdf-lib, pdf.js und JSZip nach vendor/ kopieren
npm test                      # Unit-Tests der Kernlogik (node --test)
npx playwright install chromium   # einmalig: Browser für die End-to-End-Tests
npm run test:e2e              # End-to-End-Tests mit Playwright (über http:// und file://)
npm run serve                 # lokaler Server auf http://127.0.0.1:8080/
```

### Projektstruktur

| Pfad | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `css/styles.css` | Gestaltung (responsiv, hell/dunkel) |
| `js/pdf-core.js` | Kernlogik ohne DOM: Seitenangaben, Dateinamen, Zusammenführen und Teilen mit pdf-lib (UMD, auch in Node nutzbar) |
| `js/preview.js` | Vorschaubilder mit pdf.js |
| `js/app.js` | Bedienlogik der Oberfläche |
| `vendor/` | eingecheckte Browser-Builds der Bibliotheken und deren Lizenzen (erzeugt mit `npm run vendor`) |
| `scripts/serve.mjs` | statischer Entwicklungsserver ohne Abhängigkeiten |
| `scripts/vendor.mjs` | kopiert die Bibliotheken aus `node_modules/` nach `vendor/` |
| `.nojekyll` | sorgt dafür, dass GitHub Pages alle Dateien unverändert ausliefert (ohne Jekyll-Verarbeitung) |
| `tests/unit/` | Unit-Tests für `js/pdf-core.js` |
| `tests/e2e/` | Playwright-Tests der kompletten Oberfläche und des Servers |

### Hinweise

- Damit die App auch über `file://` funktioniert, werden nur klassische `<script>`-Tags verwendet
  (keine ES-Module, kein `fetch()` lokaler Dateien, keine Inline-Skripte).
- Bibliotheken aktualisieren: Version in `package.json` anheben, `npm install --omit=optional`,
  `npm run vendor` ausführen und die geänderten Dateien in `vendor/` mit einchecken.
- Die CI (GitHub Actions) prüft bei jedem Push und Pull Request, ob `vendor/` zu `package-lock.json` passt,
  und führt Unit- und End-to-End-Tests aus. Schlägt ein Test fehl, steht der Playwright-Report als
  Artefakt zum Download bereit.

## Lizenzen von Drittanbietern

| Bibliothek | Version | Lizenz | Lizenztext |
|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | [`vendor/licenses/pdf-lib-LICENSE.md`](vendor/licenses/pdf-lib-LICENSE.md) |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | [`vendor/licenses/pdfjs-LICENSE`](vendor/licenses/pdfjs-LICENSE) |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT oder GPLv3 (nach Wahl) | [`vendor/licenses/jszip-LICENSE.md`](vendor/licenses/jszip-LICENSE.md) |
