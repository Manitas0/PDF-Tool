# PDF-Tool

**PDFs zusammenführen und teilen – direkt im Browser. Deine Dateien verlassen nie deinen Rechner.**

PDF-Tool ist eine kleine Web-App, die PDF-Dateien vollständig lokal in deinem Browser verarbeitet.
Es gibt keinen Server, keinen Upload und keinen Build-Schritt: Die Seite funktioniert über GitHub Pages,
über einen lokalen Webserver oder einfach per Doppelklick auf `index.html` – auch offline.

## Inhalt

- [Funktionen](#funktionen)
- [Datenschutz](#datenschutz)
- [Benutzung](#benutzung)
- [Windows-Desktop-App](#windows-desktop-app)
- [Microsoft Store](#microsoft-store)
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
- Eine Ergebnis-PDF enthält nur die gewählten Seiten: Andere Seiten und ihre Formularwerte werden nicht
  unsichtbar mitkopiert, nicht benötigte Bilder und Schriften weitgehend entfernt, und ausgeblendete Ebenen
  bleiben ausgeblendet.
- Eine Content-Security-Policy unterbindet zusätzlich Netzwerkverbindungen aus der Seite heraus.
- pdf.js läuft mit `isEvalSupported: false` (Schutz vor CVE-2024-4367).
- Die vollständige Datenschutzerklärung – auch für die Desktop-App und den Microsoft Store – steht in
  [`PRIVACY.md`](PRIVACY.md).

## Benutzung

### Online über GitHub Pages

1. Auf GitHub im Repository **Settings → Pages** öffnen.
2. Unter **Build and deployment** als *Source* **Deploy from a branch** wählen.
3. Den Branch (z. B. `main`) und den Ordner **`/ (root)`** auswählen und speichern.
4. Nach kurzer Zeit ist das Tool unter `https://<benutzername>.github.io/PDF-Tool/` erreichbar.

### Lokal ohne Installation

1. Repository herunterladen: *Code → Download ZIP* oder `git clone`.
2. Beim ZIP-Download **das Archiv zuerst vollständig entpacken** (Windows: Rechtsklick auf die ZIP-Datei →
   „Alle extrahieren …“). Öffnet man `index.html` direkt im ZIP-Archiv, fehlen die Ordner `css/`, `js/`
   und `vendor/` – die Seite erscheint dann ohne Gestaltung und funktioniert nicht.
3. Im entpackten Ordner **`index.html` doppelklicken**.

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

## Windows-Desktop-App

PDF-Tool gibt es zusätzlich als Desktop-App für Windows 10 und 11 (64 Bit), jeweils für PCs mit Intel- oder
AMD-Prozessor (x64) und für Geräte mit ARM-Prozessor (arm64). Sie enthält dieselbe Oberfläche
wie die Web-App, verpackt mit [Electron](https://www.electronjs.org/): eigenes Fenster mit Taskleisten-Symbol,
Start ohne Browser, und die Ergebnisse speicherst du über den gewohnten Windows-Dialog „Speichern unter“.
Auch die Desktop-App arbeitet vollständig lokal: Sie baut keine Netzwerkverbindungen auf, sucht nicht nach
Updates und sendet keine Daten.

### Herunterladen

- **Empfohlen – fertige Versionen:** im Repository unter [**Releases**](https://github.com/Manitas0/PDF-Tool/releases/latest).
  Ein Release entsteht durch einen Git-Tag `v…` (z. B. `v1.0.0`) oder von Hand unter *Actions* → *Desktop* →
  *Run workflow* mit „Release … erstellen“ (Version aus `desktop/package.json`).
- **Testversionen für Entwickler:** [Läufe des Workflows „Desktop“](https://github.com/Manitas0/PDF-Tool/actions/workflows/desktop.yml?query=event%3Apush+is%3Asuccess)
  (der Link zeigt nur erfolgreiche Läufe nach einem Push in dieses Repository, keine Pull Requests) → den
  neuesten Lauf öffnen → unter *Artifacts* **„PDF-Tool-Windows“** herunterladen (dafür muss man bei GitHub
  angemeldet sein) und das ZIP-Archiv entpacken. Artefakte werden nach 30 Tagen gelöscht; Artefakte namens
  „PDF-Tool-Windows-PR-…“ stammen aus Pull Requests und sind ungeprüft.

Jede Variante gibt es zweimal, passend zum Prozessor – du brauchst nur **eine** der vier Dateien:

| Variante | PCs mit Intel- oder AMD-Prozessor (die meisten) | Geräte mit ARM-Prozessor, z. B. Snapdragon |
|---|---|---|
| **Installationsprogramm:** installiert wahlweise nur für dich (ohne Administratorrechte) oder für alle Benutzer, Installationsordner wählbar, Verknüpfungen auf dem Desktop und im Startmenü | `PDF-Tool-Setup-<Version>-x64.exe` | `PDF-Tool-Setup-<Version>-arm64.exe` |
| **Portable Version:** ohne Installation direkt starten, z. B. vom USB-Stick. Sie entpackt sich bei jedem Start erst: nach dem Doppelklick einige Sekunden warten, bis das Fenster erscheint, und **nicht mehrfach klicken**. Schneller startet die installierte Version. | `PDF-Tool-<Version>-portable-x64.exe` | `PDF-Tool-<Version>-portable-arm64.exe` |

### x64 oder arm64?

Welcher Prozessor in deinem PC steckt, zeigt Windows unter *Einstellungen → System → Info* bei **„Systemtyp“**:

- „64-Bit-Betriebssystem, **x64-basierter Prozessor**“ → die Dateien mit **`x64`** im Namen (die meisten PCs
  und Notebooks mit Intel- oder AMD-Prozessor).
- „64-Bit-Betriebssystem, **ARM-basierter Prozessor**“ → die Dateien mit **`arm64`** im Namen (Geräte mit
  ARM-Prozessor, z. B. Snapdragon). Unter Windows 10 auf ARM läuft nur diese Variante. Windows 11 auf ARM kann
  zwar auch die x64-Variante emuliert ausführen, die arm64-Variante läuft aber ohne Emulation.

Die arm64-Dateien laufen nicht auf PCs mit Intel- oder AMD-Prozessor. **32-Bit-Windows** (Systemtyp
„32-Bit-Betriebssystem, …“) wird nicht unterstützt.

Hinweis: Die arm64-Variante wird automatisch mitgebaut, und der Build prüft, dass sie ein Programm
für ARM-Prozessoren enthält. Auf echter ARM-Hardware getestet ist sie aber nicht – die automatischen Tests
starten nur die x64-Variante.

### Warnungen beim Herunterladen und Starten

Die App ist nicht digital signiert – ein Code-Signing-Zertifikat kostet jedes Jahr Geld. Windows und die
Browser warnen deshalb vor ihr wie vor jedem selten heruntergeladenen Programm ohne bekannten Herausgeber:

1. **Beim Herunterladen** meldet Edge „… wird nicht häufig heruntergeladen“ und behält die Datei zunächst
   nicht. Klicke in der Download-Liste bei der Datei auf **„…“** → **„Beibehalten“** → **„Mehr anzeigen“** →
   **„Trotzdem beibehalten“**. Chrome zeigt eine ähnliche Warnung; dort **„Beibehalten“** wählen.
2. **Beim Ausführen der heruntergeladenen `.exe`** meldet Windows SmartScreen „Der Computer wurde durch
   Windows geschützt“. Klicke auf **„Weitere Informationen“** und dann auf **„Trotzdem ausführen“**.

Ist unter Windows 11 die **„Intelligente App-Steuerung“** eingeschaltet (*Windows-Sicherheit → App- &
Browsersteuerung*), blockiert Windows unsignierte Programme vollständig, ohne Möglichkeit, sie trotzdem
auszuführen. Verwende in diesem Fall die Web-Version. Lade die Dateien nur unter **Releases** bzw. aus den
oben verlinkten Läufen dieses Repositorys herunter.

### Deinstallieren

- **Installierte Version:** *Einstellungen → Apps → Installierte Apps → PDF-Tool → Deinstallieren*
  (oder *Systemsteuerung → Programme und Features*).
- **Portable Version:** einfach die `.exe`-Datei löschen.

Zurück bleibt höchstens der Ordner `%APPDATA%\PDF-Tool` mit Zwischenspeicher-Dateien von Electron (keine
Dokumente); er kann gefahrlos gelöscht werden.

### Selbst bauen und entwickeln

Der Unterordner `desktop/` ist ein eigenständiges Node-Projekt. Die Web-App bleibt die einzige Quelle:
`npm run prepare-app` kopiert `index.html`, `css/`, `js/` und `vendor/` nach `desktop/app/` (wird bei `start`,
`test` und den Build-Befehlen automatisch ausgeführt). Die Installationsdateien entstehen auf einem
Windows-Rechner mit Node.js 22:

```sh
cd desktop
npm install
npm run dist:win    # ergibt in desktop/dist/ die vier .exe-Dateien (Installer und portabel, je x64 und arm64)
```

Für die Entwicklung (auch unter Linux und macOS):

```sh
cd desktop
npm install
npm start           # startet die App in Electron
npm test            # End-to-End-Tests der App; braucht vorher `npm install --omit=optional` im Hauptordner
npm run dist:dir    # schneller Paketierungstest für das aktuelle Betriebssystem (desktop/dist/)
```

`npm start` verwendet ein eigenes Profil (`%APPDATA%\PDF-Tool-Dev`, unter Linux `~/.config/PDF-Tool-Dev`),
die Tests je App-Start einen frischen temporären Ordner. So kommen sich Entwicklung, Tests und eine
installierte PDF-Tool-Version nicht in die Quere.

**Neue Version veröffentlichen:** zuerst in `desktop/package.json` die Version setzen (z. B.
`"version": "1.1.0"`) und committen, dann den passenden Tag pushen (`v1.1.0`). Die Version landet in den
Dateinamen und im Dialog „Über PDF-Tool“; passen Tag und Version nicht zusammen, bricht der Workflow ab.

Technisch lädt die App die Seite nicht über `file://`, sondern über das eigene Schema `app://pdf-tool/`
(aus `app.asar`). Die Seite läuft in einer Sandbox ohne Node.js-Zugriff; Berechtigungsanfragen,
Netzwerkzugriffe (auch über WebRTC) und das Wegnavigieren von der App sind gesperrt, Webadressen für ein
neues Fenster gehen an den Standardbrowser. Der Workflow „Desktop“ (`.github/workflows/desktop.yml`) testet
die App bei jeder Änderung an `desktop/`, an der Web-App, an den gemeinsam genutzten Test-Hilfsfunktionen
(`tests/e2e/helpers.mjs`) oder an den Abhängigkeiten im Hauptordner auf Windows (x64) und baut die vier
`.exe`-Dateien. Die arm64-Variante kann dort nicht gestartet werden; der Workflow prüft nur, dass alle vier Dateien
entstanden sind und `PDF-Tool.exe` im arm64-Build ein ARM64-Programm ist.

## Microsoft Store

Die Windows-Desktop-App ist für die Veröffentlichung im Microsoft Store vorbereitet (noch nicht veröffentlicht).
Dort gibt es sie als MSIX-Paket, das Microsoft beim Veröffentlichen selbst signiert: ohne SmartScreen-Warnung,
mit Installation per Klick und automatischen Updates über den Store.

- **Schritt-für-Schritt-Anleitung** vom Partner-Center-Konto bis zur Einreichung: [`store/ANLEITUNG.md`](store/ANLEITUNG.md)
- **Texte für den Store-Eintrag:** [`store/listing-de.md`](store/listing-de.md) und [`store/listing-en.md`](store/listing-en.md)
- **Screenshots** (1920 × 1080): [`store/screenshots/`](store/screenshots/), erzeugt aus der echten App mit
  [`store/make-screenshots.mjs`](store/make-screenshots.mjs)
- **Datenschutzerklärung:** [`PRIVACY.md`](PRIVACY.md)

Die Pakete (je eine `.appx`-Datei für x64 und arm64) baut der Workflow „Desktop“ als Artefakt
„PDF-Tool-Microsoft-Store“. Die Identität der App im Store kommt aus den Repository-Variablen
`MSSTORE_IDENTITY_NAME`, `MSSTORE_PUBLISHER`, `MSSTORE_PUBLISHER_DISPLAY_NAME` und `MSSTORE_DISPLAY_NAME`
(*Settings → Secrets and variables → Actions → Variables*); fehlen sie, entsteht nur ein Testpaket, das der Store
ablehnt. Unter Windows geht es auch lokal mit `npm run dist:store` im Ordner `desktop/` (Identität dann über
gleichnamige Umgebungsvariablen).

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
- **Lesezeichen (Outlines) und Formularfunktionen (AcroForm)** werden nicht übernommen: Ausgefüllte
  Formularfelder bleiben sichtbar, lassen sich in der Ergebnis-PDF aber nicht mehr bearbeiten. Bei
  Formularen, deren Werte erst das Anzeigeprogramm zeichnet (z. B. aus LibreOffice), schreibt PDF-Tool
  die Werte von Text- und Auswahlfeldern in der Standardschrift Helvetica auf die Seite; Werte mit
  Zeichen außerhalb des westeuropäischen Zeichensatzes (z. B. Griechisch, Kyrillisch, „ł“ oder „č“)
  können dort fehlen.
- **Interne Links** bleiben erhalten, wenn sie direkt auf eine Seite zeigen, die ebenfalls in der
  Ergebnis-PDF liegt. Links auf nicht übernommene Seiten werden entfernt; Links über benannte Sprungziele
  (wie sie z. B. LaTeX erzeugt) funktionieren nicht mehr. Der sichtbare Seiteninhalt bleibt erhalten.
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
| `desktop/` | Windows-Desktop-App (Electron): `main.js`, Build-Konfiguration in `package.json`, Tests in `desktop/tests/` – siehe [Windows-Desktop-App](#windows-desktop-app) |
| `store/` | Microsoft Store: Anleitung, Texte für den Store-Eintrag, Screenshots und das Skript, das sie erzeugt – siehe [Microsoft Store](#microsoft-store) |
| `PRIVACY.md` | Datenschutzerklärung (Deutsch und Englisch) |

### Hinweise

- Damit die App auch über `file://` funktioniert, werden nur klassische `<script>`-Tags verwendet
  (keine ES-Module, kein `fetch()` lokaler Dateien, keine Inline-Skripte).
- Bibliotheken aktualisieren: Version in `package.json` anheben, `npm install --omit=optional`,
  `npm run vendor` ausführen und die geänderten und neuen Dateien in `vendor/` mit einchecken.
- Die CI (GitHub Actions) prüft bei jedem Push und Pull Request, ob `vendor/` zu `package-lock.json` passt
  (auch auf Dateien, die `npm run vendor` erzeugt, die aber nicht eingecheckt sind), und führt Unit- und
  End-to-End-Tests aus. Schlägt ein Test fehl, steht der Playwright-Report als Artefakt zum Download bereit.

## Lizenzen von Drittanbietern

| Bibliothek | Version | Lizenz | Lizenztext |
|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | [`vendor/licenses/pdf-lib-LICENSE.md`](vendor/licenses/pdf-lib-LICENSE.md) |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | [`vendor/licenses/pdfjs-LICENSE`](vendor/licenses/pdfjs-LICENSE) |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT oder GPLv3 (nach Wahl) | [`vendor/licenses/jszip-LICENSE.md`](vendor/licenses/jszip-LICENSE.md) |
