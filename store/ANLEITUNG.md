# Anleitung: PDF-Tool im Microsoft Store veröffentlichen

Diese Anleitung führt dich Schritt für Schritt vom ersten Klick bis zur fertigen Einreichung im Microsoft Store.
Du brauchst dafür keine Programmierkenntnisse, nur einen Browser.

**Warum der Store?** Microsoft signiert das Paket beim Veröffentlichen selbst. Dadurch entfallen die
SmartScreen-Warnungen der unsignierten `.exe`-Dateien, die Installation geht mit einem Klick, und Updates kommen
automatisch über den Store. Ein eigenes Code-Signing-Zertifikat ist nicht nötig.

**Was schon vorbereitet ist:**

| Was | Wo |
|---|---|
| Datenschutzerklärung (Deutsch und Englisch) | [`PRIVACY.md`](../PRIVACY.md) im Hauptordner |
| Texte für den Store-Eintrag | [`listing-de.md`](listing-de.md) und [`listing-en.md`](listing-en.md) |
| Screenshots (1920 × 1080) | Ordner [`screenshots/`](screenshots/) |
| Bau des Store-Pakets | GitHub-Workflow „Desktop“ (Artefakt „PDF-Tool-Microsoft-Store“) |

**Zeitbedarf:** etwa ein bis zwei Stunden Arbeit, dazu Wartezeiten für die Kontoprüfung (Stunden bis einige
Tage) und die Zertifizierung der App (meist bis zu drei Werktage).

> **Hinweis zu den Bezeichnungen:** Microsoft ändert die Oberfläche von Partner Center regelmäßig, und je nach
> Spracheinstellung erscheint sie auf Deutsch oder Englisch. Die deutschen Bezeichnungen in dieser Anleitung
> können deshalb vom tatsächlichen Wortlaut abweichen; die englischen stehen jeweils in Klammern dahinter.
> Heißt ein Knopf bei dir etwas anders, such nach einem ähnlich benannten.

## Übersicht

- [Schritt 0: Vorbereitungen im Repository](#schritt-0-vorbereitungen-im-repository)
- [Schritt 1: Entwicklerkonto anlegen](#schritt-1-entwicklerkonto-anlegen)
- [Schritt 2: App-Namen reservieren](#schritt-2-app-namen-reservieren)
- [Schritt 3: Identitätswerte heraussuchen](#schritt-3-identitätswerte-heraussuchen)
- [Schritt 4: Werte im Projekt eintragen](#schritt-4-werte-im-projekt-eintragen)
- [Schritt 5: Store-Paket bauen lassen und herunterladen](#schritt-5-store-paket-bauen-lassen-und-herunterladen)
- [Schritt 6: Einreichung ausfüllen](#schritt-6-einreichung-ausfüllen)
- [Schritt 7: Zertifizierung und Veröffentlichung](#schritt-7-zertifizierung-und-veröffentlichung)
- [Schritt 8: Updates veröffentlichen](#schritt-8-updates-veröffentlichen)
- [Häufige Probleme](#häufige-probleme)

## Schritt 0: Vorbereitungen im Repository

1. **Datenschutzerklärung:** [`PRIVACY.md`](../PRIVACY.md) ist fertig und enthält **keine persönlichen
   Angaben** – als Herausgeber steht dort nur „Maniapps“, als Kontakt die Issues-Seite des GitHub-Repositorys.
   Die App erhebt keine personenbezogenen Daten; deshalb muss dort niemand mit Name und Anschrift stehen.
2. **Die Datei liegt bereits im Standard-Branch des Repositorys**, damit der Link funktioniert. Änderst du sie
   später, geht das auch direkt im Browser: Datei öffnen → Stift-Symbol → bearbeiten → „Commit changes“.
3. **Link prüfen.** Die Adresse der Datenschutzerklärung für Partner Center lautet:

   ```text
   https://github.com/Manitas0/PDF-Tool/blob/ccr-ed9e82a7-09b8fo/PRIVACY.md
   ```

   Öffne sie in einem privaten Browserfenster (ohne GitHub-Anmeldung): Die Datenschutzerklärung muss
   erscheinen.

   Der Teil `ccr-ed9e82a7-09b8fo` ist der Name des aktuellen Standard-Branchs. **Benennst du den Branch um**
   (z. B. in `main`), ändert sich die Adresse. GitHub leitet alte Datei-Links nach einer Umbenennung zwar
   meist weiter, trotzdem solltest du die Adresse dann bei der nächsten Einreichung unter „Eigenschaften“
   anpassen. Unabhängig vom Branch-Namen zeigt diese Adresse immer auf den aktuellen Standard-Branch – probiere
   sie im Browser aus und nimm sie, wenn sie funktioniert:

   ```text
   https://github.com/Manitas0/PDF-Tool/blob/HEAD/PRIVACY.md
   ```

4. **Support-Kontakt:** Als Kontaktmöglichkeit dient `https://github.com/Manitas0/PDF-Tool/issues` – ohne
   E-Mail-Adresse. Nutzer brauchen dafür ein (kostenloses) GitHub-Konto.
5. Die Store-Texte in `listing-de.md` und `listing-en.md` sind fertig – auch dort sind keine persönlichen Angaben
   nötig.

## Schritt 1: Entwicklerkonto anlegen

1. Du brauchst ein **Microsoft-Konto** (z. B. eine Outlook.com-Adresse oder das Konto, mit dem du dich bei
   Windows anmeldest). Das Konto, mit dem du dich registrierst, ist später der Zugang zu Partner Center.
2. Informationen und Anmeldung:
   [Entwicklerkonto eröffnen (Microsoft Learn)](https://learn.microsoft.com/de-de/windows/apps/publish/partner-center/open-a-developer-account).
   Partner Center selbst erreichst du unter <https://partner.microsoft.com/dashboard>.
3. **Kontotyp wählen** – das lässt sich später nicht ohne Weiteres ändern:

   | | Einzelperson (Individual) | Unternehmen (Company) |
   |---|---|---|
   | Für wen | Privatpersonen, Hobby-Entwickler | Firmen, eingetragene Organisationen |
   | Kosten | laut Microsoft seit 2025 kostenlos | einmalige Gebühr (bisher rund 99 US-Dollar) |
   | Prüfung | Identitätsnachweis, z. B. mit einem Ausweisdokument | Prüfung des Unternehmens; dauert länger und braucht Firmenunterlagen |
   | Im Store angezeigt | dein Herausgeber-Anzeigename | Firmenname |

   **Bitte prüfe bei der Anmeldung die aktuellen Bedingungen und Gebühren** – Microsoft ändert sie gelegentlich.
   Für PDF-Tool als kostenlose App einer Privatperson genügt ein Konto als Einzelperson.
4. **Herausgeber-Anzeigename** (Publisher display name) wählen: Unter diesem Namen erscheinst du im Store als
   Entwickler, z. B. dein Name oder ein Künstlername. Er wird später zum Wert
   `Package/Properties/PublisherDisplayName`.
5. Die Kontoprüfung abwarten. Den Stand siehst du in Partner Center unter *Kontoeinstellungen* (Account
   settings).
6. Möglicherweise fragt Partner Center für die EU (Digital Services Act), ob du als **Unternehmer** („Trader“)
   handelst. Wer das bejaht, dessen Anschrift, Telefonnummer und E-Mail-Adresse zeigt der Store öffentlich an.
   Wer eine kostenlose App privat anbietet, ist in der Regel kein Unternehmer – im Zweifel lass dich beraten.

## Schritt 2: App-Namen reservieren

1. In Partner Center **Apps und Spiele** (Apps and games) öffnen → **Neues Produkt** (New product) →
   **MSIX- oder PWA-App** (MSIX or PWA app) wählen.
   *Nicht* „EXE- oder MSI-App“ – das wäre die Variante mit eigenem Code-Signing-Zertifikat.
2. Einen Namen eingeben und **Verfügbarkeit prüfen** (Check availability) klicken. Der Name muss im ganzen
   Microsoft Store einmalig sein. Vorschläge stehen in [`listing-de.md`](listing-de.md#produktname); „PDF-Tool“
   allein ist vermutlich schon vergeben.
3. Ist der Name frei: **Produktnamen reservieren** (Reserve product name).
4. Notiere den Namen **zeichengenau** (Groß-/Kleinschreibung, Leerzeichen, Bindestrich „-“ oder Gedankenstrich
   „–“). Er muss später exakt so im Paket stehen.

Die Reservierung gilt in der Regel drei Monate; reichst du die App in dieser Zeit ein, bleibt der Name dauerhaft
reserviert.

## Schritt 3: Identitätswerte heraussuchen

1. In Partner Center die neue App öffnen.
2. Links im Menü **Produktverwaltung** (Product management) → **Produktidentität** (Product identity).
3. Dort stehen die Werte, die Microsoft deiner App zugeteilt hat. Du brauchst drei davon, dazu den reservierten
   Namen aus Schritt 2:

   | In Partner Center | Wert für diese App | Feld in `desktop/package.json` (`build.appx`) |
   |---|---|---|
   | `Package/Identity/Name` | `Maniapps.PDFToolProPremiumPlus` | `identityName` |
   | `Package/Identity/Publisher` | `CN=22C9069C-D721-419C-A15F-04FF8F852D3D` | `publisher` |
   | `Package/Properties/PublisherDisplayName` | `Maniapps` | `publisherDisplayName` |
   | der reservierte App-Name (Schritt 2) | `PDF Tool Pro Premium Plus` | `displayName` |

4. Bei einer anderen App: Werte **vollständig und exakt** kopieren – am besten mit dem Kopier-Symbol daneben.
   `publisher` beginnt immer mit `CN=`. Keine Leerzeichen am Anfang oder Ende.

Diese Werte sind nicht geheim: Sie stehen in jedem veröffentlichten Paket.

## Schritt 4: Werte im Projekt eintragen

**Für „PDF Tool Pro Premium Plus“ ist das schon erledigt** – die Werte aus Schritt 3 stehen in
[`desktop/package.json`](../desktop/package.json) im Abschnitt `"appx"`. Ändern musst du sie nur, wenn sich die
Produktidentität oder der reservierte Name ändert:

1. Auf GitHub die Datei `desktop/package.json` öffnen und rechts oben auf das Stift-Symbol (*Edit this file*)
   klicken.
2. Im Abschnitt `"appx"` die Werte von `identityName`, `publisher`, `publisherDisplayName` und `displayName`
   ersetzen (die Anführungszeichen stehen lassen).
3. **Commit changes** klicken. Danach baut GitHub die Store-Pakete automatisch neu (Schritt 5).

Ist ein Wert offensichtlich falsch kopiert (z. B. `publisher` ohne `CN=`), bricht der Bau mit einer roten
Fehlermeldung ab, statt ein Paket zu erzeugen, das Partner Center ablehnt.

## Schritt 5: Store-Paket bauen lassen und herunterladen

1. Im Repository oben auf **Actions** klicken.
2. Links den Workflow **Desktop** auswählen.
3. Rechts **Run workflow** klicken. Als Branch den Standard-Branch lassen (`ccr-ed9e82a7-09b8fo`). Das Häkchen
   „Release … erstellen“ **nicht** setzen – es betrifft nur die `.exe`-Dateien unter *Releases*.
   Dann den grünen Knopf **Run workflow** klicken.
4. Nach einigen Sekunden erscheint der Lauf in der Liste. Er dauert etwa 15 bis 30 Minuten. Fertig ist er, wenn
   davor ein grüner Haken (oder ein rotes Kreuz, siehe [Häufige Probleme](#häufige-probleme)) steht.
5. Den Lauf anklicken. Ein roter Fehler wie „build.appx.publisher muss mit „CN=“ beginnen“ bedeutet: Wert in
   Schritt 4 falsch kopiert. In der Zusammenfassung des Laufs steht eine Tabelle mit der Identität beider Pakete –
   sie muss zu Schritt 3 passen.
6. Ganz unten unter **Artifacts** auf **PDF-Tool-Microsoft-Store** klicken (dafür musst du bei GitHub angemeldet
   sein). Es lädt eine ZIP-Datei herunter.
7. Die ZIP-Datei entpacken. Darin liegen zwei Pakete – beide werden hochgeladen:
   - `PDF-Tool-Store-<Version>-x64.appx` – für PCs mit Intel- oder AMD-Prozessor
   - `PDF-Tool-Store-<Version>-arm64.appx` – für Geräte mit ARM-Prozessor

Die `.appx`-Dateien lassen sich **nicht per Doppelklick installieren**, weil sie noch nicht signiert sind. Das
ist richtig so: Microsoft signiert sie nach der Prüfung. Artefakte löscht GitHub nach einiger Zeit wieder;
dann den Workflow einfach erneut starten.

## Schritt 6: Einreichung ausfüllen

In Partner Center die App öffnen und **Übermittlung starten** (Start your submission) klicken. Die Einreichung
besteht aus mehreren Abschnitten. Jeden öffnen, ausfüllen, **Speichern** klicken – erst wenn alle Abschnitte
als vollständig markiert sind, lässt sie sich absenden. Du kannst zwischendurch aufhören; der Entwurf bleibt
erhalten.

### 6.1 Preise und Verfügbarkeit (Pricing and availability)

- **Märkte** (Markets): alle Märkte lassen (Standard) oder gezielt auswählen.
- **Sichtbarkeit / Zielgruppe** (Visibility, Audience): **Öffentliche Zielgruppe** (Public audience) und
  „im Store auffindbar“. *Tipp:* Wer die Store-Version erst selbst ausprobieren möchte, wählt beim ersten Mal
  **Private Zielgruppe** (Private audience) mit der eigenen E-Mail-Adresse und schaltet die App mit einer
  späteren Einreichung öffentlich.
- **Zeitplan** (Schedule): so bald wie möglich.
- **Preis** (Base price): **Kostenlos** (Free). Keine kostenlose Testversion, keine Verkaufsaktionen.

### 6.2 Eigenschaften (Properties)

- **Kategorie** (Category): **Produktivität** (Productivity). Eine Unterkategorie gibt es dort nicht.
- **URL der Datenschutzrichtlinie** (Privacy policy URL): die Adresse aus Schritt 0.
- **Website**: `https://github.com/Manitas0/PDF-Tool`
- **Support-Kontaktinformationen** (Support contact info): `https://github.com/Manitas0/PDF-Tool/issues`
- Falls gefragt wird, ob die App personenbezogene Daten **erfasst, darauf zugreift oder überträgt**: **Nein**.
- **Produktdeklarationen** (Product declarations): Standardwerte lassen; nur ankreuzen, was wirklich zutrifft.
- **Systemanforderungen** (System requirements): kann leer bleiben.

### 6.3 Altersfreigaben (Age ratings)

Den **IARC-Fragebogen** ausfüllen. Die passenden Antworten für PDF-Tool stehen in
[`listing-de.md`](listing-de.md#altersfreigabe) (überall „Nein“: keine Gewalt, keine Kommunikation zwischen
Nutzern, keine Weitergabe von Daten, keine Käufe, kein Webbrowser). Eventuell fragt er nach einer
E-Mail-Adresse für das Freigabezertifikat. Ergebnis ist voraussichtlich die niedrigste Stufe (z. B. „3+“,
USK „ab 0 Jahren“) – festgelegt wird sie vom Fragebogen.

### 6.4 Pakete (Packages)

1. Beide `.appx`-Dateien aus Schritt 5 in das Upload-Feld ziehen (oder „Durchsuchen“).
2. Warten, bis Partner Center beide geprüft hat. Bei Fehlern siehe [Häufige Probleme](#häufige-probleme).
3. Bei den **Gerätefamilien** (Device families) nur **Windows 10/11 Desktop** angekreuzt lassen (nicht Xbox,
   Holographic, Team).
4. Speichern.

### 6.5 Store-Einträge (Store listings)

Partner Center legt einen Eintrag für **Deutsch** an, weil das Paket Deutsch als Sprache angibt (er erscheint,
sobald die Pakete hochgeladen sind).

1. Beim Eintrag **Deutsch (Deutschland)** auf **Bearbeiten** klicken.
2. Die Felder aus [`listing-de.md`](listing-de.md) übernehmen:
   - **Produktname**: den reservierten Namen aus der Liste wählen
   - **Beschreibung**, **Neuigkeiten in dieser Version** (What's new), **Produktfunktionen** (Product features –
     jede Zeile in ein eigenes Feld)
   - **Screenshots**: unter *Desktop* die sechs PNG-Dateien aus [`screenshots/`](screenshots/) in der Reihenfolge
     `01` bis `06` hochladen; Bildunterschriften sind optional
   - **Store-Logos** (Store logos): optional – ohne sie verwendet der Store das Logo aus dem Paket
   - unter *Zusätzliche Felder* (Supplemental fields): **Kurzbeschreibung** (Short description), **Kurzer Titel**,
     **Suchbegriffe** (Search terms – je ein Begriff pro Feld), **Copyright- und Markeninformationen**,
     **Entwickelt von** – dort steht bereits „Maniapps“
   - **Zusätzliche Lizenzbedingungen**: leer lassen
3. Speichern.
4. *Optional* einen englischen Eintrag ergänzen: **Weitere Sprachen verwalten** (Manage additional languages) →
   **Englisch (USA)** hinzufügen → Felder aus [`listing-en.md`](listing-en.md) übernehmen, dieselben Screenshots.

### 6.6 Übermittlungsoptionen (Submission options)

- **Veröffentlichung** (Publishing hold options): „So bald wie möglich veröffentlichen“ – oder „Nicht
  veröffentlichen, bis ich es auswähle“, wenn du den Zeitpunkt selbst bestimmen willst.
- **Anmerkungen für die Zertifizierung** (Notes for certification) – auf Englisch, weil die Prüfer international
  arbeiten:

  ```text
  PDF-Tool merges and splits PDF files completely offline. No account or login is required. The user interface is in German.
  To test: start the app and drag one or more PDF files into the window (or click "Dateien auswählen"), then click "PDFs zusammenführen" – the result is saved with the Windows "Save as" dialog. The tab "Teilen" splits a PDF into several files or extracts selected pages.
  The app makes no network connections and does not need an internet connection.
  ```

- **Eingeschränkte Funktionen** (Restricted capabilities): Das Paket verwendet die Funktion `runFullTrust`, die
  jede als MSIX verpackte Desktop-App braucht. Fragt Partner Center nach einer Begründung, diesen Text einfügen
  (Englisch; darunter dasselbe auf Deutsch, falls gewünscht):

  ```text
  PDF-Tool is a desktop app (Electron, Win32) packaged as MSIX. Like every packaged Win32 desktop app it needs the runFullTrust capability to run as a desktop process; the packaging tool declares it automatically. The app declares no other capabilities, makes no network connections and only reads and writes files the user explicitly chooses (file picker, drag and drop, "Save as" dialog).
  ```

  ```text
  Desktop-App (Electron, Win32), als MSIX verpackt. Wie jede verpackte Win32-Desktop-App braucht PDF-Tool die Funktion runFullTrust, um als Desktop-Prozess zu laufen; das Paketierungswerkzeug trägt sie automatisch ein. Die App deklariert keine weiteren Funktionen, baut keine Netzwerkverbindungen auf und liest und schreibt nur Dateien, die der Benutzer ausdrücklich auswählt (Dateiauswahl, Drag & Drop, Dialog „Speichern unter“).
  ```

### 6.7 Absenden

Wenn alle Abschnitte vollständig sind: **An den Store übermitteln** (Submit to the Store).

## Schritt 7: Zertifizierung und Veröffentlichung

- Den Fortschritt zeigt Partner Center auf der Seite der Einreichung (Vorverarbeitung → Zertifizierung →
  Veröffentlichung). Microsoft gibt für die Zertifizierung **bis zu drei Werktage** an, oft geht es schneller.
  Danach kann es noch einige Stunden dauern, bis die App im Store zu finden ist. Über Statusänderungen
  informiert Microsoft per E-Mail.
- **Abgelehnt?** Partner Center zeigt einen Bericht mit den Gründen. Fehler beheben (z. B. Text anpassen oder ein
  neues Paket bauen) und eine neue Einreichung absenden.
- **Nach der Veröffentlichung** findest du den Store-Link unter *Produktverwaltung → Produktidentität*
  (Store-ID bzw. „URL“). Den Link kannst du z. B. in die README übernehmen.

## Schritt 8: Updates veröffentlichen

1. In [`desktop/package.json`](../desktop/package.json) die Versionsnummer erhöhen, z. B.
   `"version": "1.0.1"` → `"version": "1.0.2"`. Im Store wird daraus `1.0.2.0`. Jede neue Einreichung braucht
   eine **höhere** Version als die bereits veröffentlichte.
2. Die Änderung auf GitHub speichern (committen). Auf GitHub geht das direkt im Browser: Datei öffnen →
   Stift-Symbol → Zahl ändern → „Commit changes“.
3. Den Workflow „Desktop“ laufen lassen (startet nach der Änderung meist von selbst, sonst wie in Schritt 5 per
   **Run workflow**) und das Artefakt **PDF-Tool-Microsoft-Store** herunterladen.
4. In Partner Center bei der App **Update** bzw. **Neue Übermittlung erstellen** (Update / Start update) klicken.
   Partner Center übernimmt dabei alle Angaben der letzten Einreichung.
5. Unter **Pakete** die beiden neuen `.appx`-Dateien hochladen und die alten Pakete entfernen (Papierkorb-Symbol).
6. Unter **Store-Einträge** die **Neuigkeiten in dieser Version** anpassen (in jeder Sprache). Hat sich die
   Oberfläche sichtbar geändert, neue Screenshots hochladen (siehe unten).
7. **An den Store übermitteln.** Nach der Zertifizierung bekommen alle Nutzer das Update automatisch.

Die `.exe`-Versionen unter *Releases* auf GitHub sind davon unabhängig; sie entstehen wie bisher über einen
Git-Tag `v…` (siehe README, Abschnitt „Windows-Desktop-App“).

## Häufige Probleme

| Meldung oder Problem | Ursache und Lösung |
|---|---|
| Partner Center meldet, Paketname oder Herausgeber (Publisher) **passen nicht** zur App | `identityName` oder `publisher` in `desktop/package.json` weichen von der Produktidentität ab. Werte in Schritt 3 neu kopieren, in Schritt 4 korrigieren, neue Pakete hochladen. |
| Der **Anzeigename** passt nicht zu einem reservierten Namen | `displayName` in `desktop/package.json` muss zeichengenau dem reservierten Namen entsprechen (auch „-“ und „–“ unterscheiden sich). |
| **Version** schon vorhanden bzw. zu niedrig | Version in `desktop/package.json` erhöhen (Schritt 8), neu bauen. |
| Hinweis auf **eingeschränkte Funktion runFullTrust** | Normal für Desktop-Apps. Begründung aus Abschnitt 6.6 einfügen. |
| Artefakt **PDF-Tool-Microsoft-Store** fehlt oder ist abgelaufen | Lauf mit rotem Kreuz: Fehlermeldung im Lauf lesen. Abgelaufen: Workflow erneut starten. |
| Lauf mit **rotem Kreuz**, das Artefakt **PDF-Tool-Microsoft-Store** ist aber da | Das Artefakt entsteht erst, wenn beide Pakete gebaut sind und ihr Inhalt geprüft ist. Danach installiert GitHub das x64-Paket noch zur Probe und startet es. Ist nur dieser Schritt „Paket installieren und starten (x64)“ rot, kann es am GitHub-Rechner liegen oder an der App: Fehlermeldung lesen und bei Unklarheit nachfragen. Hochladen lassen sich die Pakete trotzdem; ob die App startet, prüft Microsoft bei der Zertifizierung ohnehin und lehnt sie sonst mit Begründung ab. |
| Ablehnung wegen der **Beschreibung** oder der **Screenshots** | Die Texte und Bilder müssen die App genau so zeigen, wie sie ist. Bei Änderungen an der App die Screenshots neu erzeugen. |

Die Regeln des Stores: [Microsoft Store-Richtlinien](https://learn.microsoft.com/de-de/windows/apps/publish/store-policies).

## Für Entwickler: Screenshots neu erzeugen

Die Bilder in `screenshots/` stammen aus der echten Desktop-App mit erfundenen Beispiel-PDFs. Das Skript
[`make-screenshots.mjs`](make-screenshots.mjs) erzeugt sie neu (Node.js 22):

```sh
npm ci --omit=optional                  # im Hauptordner
npm ci --prefix desktop
npm run prepare-app --prefix desktop
node store/make-screenshots.mjs         # unter Linux ohne Bildschirm: xvfb-run -a -s "-screen 0 2560x1600x24" node store/make-screenshots.mjs
```

Der Bildschirm muss größer als 1920 × 1080 sein, sonst bricht das Skript mit einer Meldung ab.
