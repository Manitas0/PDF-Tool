# Datenschutzerklärung – PDF-Tool

**Stand: Oktober 2026** · [English version below](#privacy-policy--pdf-tool)

Diese Datenschutzerklärung gilt für **PDF-Tool** in allen Varianten: die Windows-Desktop-App (auch in der
Version aus dem Microsoft Store), die Web-Version im Browser und die heruntergeladenen Dateien des
Repositorys <https://github.com/Manitas0/PDF-Tool>.

## Kurz gesagt

- PDF-Tool verarbeitet deine PDF-Dateien **ausschließlich lokal auf deinem Gerät**. Nichts wird hochgeladen.
- PDF-Tool erhebt, speichert und übermittelt **keine personenbezogenen Daten**. Es gibt keinen Server, kein
  Benutzerkonto, keine Cookies, kein Tracking, keine Analyse- oder Telemetriedaten, keine Absturzberichte und
  keine Werbung.
- Die **Desktop-App baut keine Netzwerkverbindungen auf** und funktioniert ohne Internetverbindung.
- Wer die App über den **Microsoft Store** bezieht oder die **Web-Version über GitHub Pages** aufruft, bei dem
  verarbeiten Microsoft bzw. GitHub als Anbieter dieser Plattformen eigene Daten (siehe Abschnitte 5 und 6).

## 1. Herausgeber und Kontakt

PDF-Tool (im Microsoft Store: „PDF Tool Pro Premium Plus“) wird von **Maniapps** als kostenloses, privates
Projekt veröffentlicht. Der Herausgeber erhebt und verarbeitet über die App **keine personenbezogenen Daten**
(siehe Abschnitte 2 bis 4) und erhält auch keine Daten über dich.

Fragen zum Datenschutz oder zur App kannst du über die Issues des GitHub-Repositorys stellen:
<https://github.com/Manitas0/PDF-Tool/issues> (siehe Abschnitt 7).

## 2. Wie PDF-Tool mit deinen Dateien umgeht

- Die PDF-Dateien, die du auswählst oder in das Fenster ziehst, werden nur im Arbeitsspeicher deines Geräts
  verarbeitet – mit den eingebauten Open-Source-Bibliotheken pdf-lib, pdf.js und JSZip.
- Die Ergebnisse speicherst du selbst: in der Desktop-App über den Windows-Dialog „Speichern unter“, in der
  Web-Version als Download deines Browsers.
- PDF-Tool legt **keine Kopien deiner Dokumente** an, führt keinen Verlauf über bearbeitete Dateien und
  übermittelt weder Dateien noch Dateinamen, Inhalte oder Nutzungsdaten an den Herausgeber oder an Dritte.
  Der Herausgeber hat keinen Zugriff auf deine Dateien.

## 3. Windows-Desktop-App (auch aus dem Microsoft Store)

- **Keine Netzwerkverbindungen:** Die App sperrt technisch jeden Zugriff ins Netz. Sie lädt nur ihre eigenen,
  mitgelieferten Programmdateien; alle anderen Anfragen – auch WebRTC-Verbindungen – werden blockiert. Die
  eingebaute Rechtschreibprüfung, die Wörterbücher aus dem Internet laden würde, ist abgeschaltet.
- **Keine Updates, Telemetrie oder Absturzberichte durch die App selbst.** Die App sucht nicht nach Updates;
  Updates der Store-Version liefert der Microsoft Store (siehe Abschnitt 5).
- **Keine Berechtigungen:** Anfragen nach Kamera, Mikrofon, Standort, Benachrichtigungen, Zwischenablage-API
  und Ähnlichem lehnt die App grundsätzlich ab.
- **Lokale Programmdaten:** Wie jede Electron-App legt PDF-Tool einen Ordner mit technischen Zwischenspeicher-
  und Einstellungsdateien an (bei der heruntergeladenen Version `%APPDATA%\PDF-Tool`; bei der Version aus dem
  Microsoft Store verwaltet Windows diesen Ordner im App-Paket und entfernt ihn in der Regel bei der
  Deinstallation). Er enthält keine Dokumente. Den zuletzt verwendeten Speicherort merkt sich die App nur,
  solange sie läuft.

## 4. Web-Version

- Die Web-Version verarbeitet deine Dateien genauso ausschließlich lokal in deinem Browser.
- Sie lädt **keine externen Inhalte** (kein CDN, keine Webschriften, keine Analyse- oder Werbedienste). Alle
  Bibliotheken werden mit der Seite ausgeliefert. Eine Content-Security-Policy verhindert zusätzlich, dass die
  Seite Netzwerkverbindungen aufbaut.
- Sie setzt **keine Cookies** und speichert nichts im Browser (kein Local Storage, keine IndexedDB).
- Öffnest du die heruntergeladene Datei `index.html` direkt von deiner Festplatte, findet überhaupt keine
  Datenübertragung statt.

## 5. Microsoft Store

Wenn du PDF-Tool über den Microsoft Store installierst, verarbeitet Microsoft dabei Daten in eigener
Verantwortung, zum Beispiel für Download, Lizenz und automatische Updates. Dafür gilt die
[Datenschutzerklärung von Microsoft](https://privacy.microsoft.com/de-de/privacystatement).

Microsoft stellt dem Herausgeber im Partner Center zusammengefasste Statistiken zur Verfügung, etwa die Zahl der
Installationen und – abhängig von deinen Windows-Einstellungen für Diagnosedaten – Informationen über Abstürze.
Diese Daten erhebt Windows bzw. der Microsoft Store, nicht PDF-Tool. Bewertungen und Rezensionen, die du im Store
schreibst, sind öffentlich und für den Herausgeber sichtbar.

## 6. Bereitstellung der Web-Version über GitHub Pages

Wird die Web-Version über GitHub Pages bereitgestellt (z. B. unter `https://manitas0.github.io/PDF-Tool/`),
lädt dein Browser die Dateien der Seite von Servern der GitHub, Inc. (USA). Dabei verarbeitet GitHub technisch
notwendige Daten wie deine IP-Adresse und protokolliert Zugriffe zur Gewährleistung der Sicherheit. Dabei
können Daten in die USA übermittelt werden. GitHub, Inc. ist nach dem EU-US Data Privacy Framework zertifiziert;
die Übermittlung stützt sich auf den Angemessenheitsbeschluss der EU-Kommission vom 10. Juli 2023 (Art. 45
DSGVO). Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer sicheren, zuverlässigen
Bereitstellung der Seite). Der Herausgeber erhält von GitHub keine personenbezogenen Zugriffsdaten der
Web-Version. Einzelheiten:
[GitHub General Privacy Statement](https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement)
und [About GitHub Pages – Abschnitt „Data collection“](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#data-collection).

Dasselbe gilt, wenn du das Repository oder diese Datenschutzerklärung auf github.com aufrufst.

## 7. Kontakt über GitHub

Für Kontakt mit dem Herausgeber gibt es die Issues des GitHub-Repositorys. Dafür brauchst du ein GitHub-Konto;
GitHub verarbeitet die Daten dieses Kontos nach seiner eigenen Datenschutzerklärung (siehe Abschnitt 6).
**Issues sind öffentlich sichtbar** – schreibe dort keine persönlichen Daten und hänge keine vertraulichen
Dateien an. Der Herausgeber nutzt deine Angaben nur, um deine Anfrage zu beantworten.

## 8. Deine Rechte

Da PDF-Tool selbst keine personenbezogenen Daten verarbeitet, liegen beim Herausgeber in der Regel keine Daten
über dich vor. Unabhängig davon hast du nach der DSGVO das Recht auf Auskunft, Berichtigung, Löschung,
Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht, dich bei einer
Datenschutz-Aufsichtsbehörde zu beschweren. Für die Datenverarbeitung durch Microsoft oder GitHub wende dich
bitte direkt an diese Unternehmen.

## 9. Änderungen

Diese Datenschutzerklärung wird angepasst, wenn sich PDF-Tool oder die Rechtslage ändert. Es gilt die jeweils
aktuelle Fassung unter dieser Adresse; frühere Fassungen sind in der Versionsgeschichte des Repositorys
einsehbar.

---

# Privacy Policy – PDF-Tool

**Last updated: October 2026** · English translation; in case of doubt, the German version above prevails.

This privacy policy applies to **PDF-Tool** in all its forms: the Windows desktop app (including the version
from the Microsoft Store), the web version in the browser and the downloaded files of the repository
<https://github.com/Manitas0/PDF-Tool>.

## In short

- PDF-Tool processes your PDF files **only locally on your device**. Nothing is uploaded.
- PDF-Tool does **not collect, store or transmit any personal data**. There is no server, no user account, no
  cookies, no tracking, no analytics or telemetry, no crash reports and no advertising.
- The **desktop app makes no network connections** and works without an internet connection.
- If you get the app from the **Microsoft Store** or open the **web version on GitHub Pages**, Microsoft or
  GitHub, as the providers of those platforms, process data of their own (see sections 5 and 6).

## 1. Publisher and contact

PDF-Tool (in the Microsoft Store: “PDF Tool Pro Premium Plus”) is published by **Maniapps** as a free,
private project. The publisher does **not collect or process any personal data** through the app (see sections
2 to 4) and does not receive any data about you.

Questions about privacy or the app can be asked via the issues of the GitHub repository:
<https://github.com/Manitas0/PDF-Tool/issues> (see section 7).

## 2. How PDF-Tool handles your files

- The PDF files you select or drop into the window are processed only in your device's memory – with the
  bundled open-source libraries pdf-lib, pdf.js and JSZip.
- You save the results yourself: in the desktop app with the Windows "Save as" dialog, in the web version as a
  download of your browser.
- PDF-Tool makes **no copies of your documents**, keeps no history of processed files and transmits neither
  files nor file names, contents or usage data to the publisher or to third parties. The publisher has no access
  to your files.

## 3. Windows desktop app (including the Microsoft Store version)

- **No network connections:** the app technically blocks all network access. It only loads its own bundled
  program files; every other request – including WebRTC connections – is blocked. The built-in spell checker,
  which would download dictionaries from the internet, is switched off.
- **No updates, telemetry or crash reports by the app itself.** The app does not check for updates; updates of
  the Store version are delivered by the Microsoft Store (see section 5).
- **No permissions:** requests for the camera, microphone, location, notifications, the clipboard API and the
  like are always denied.
- **Local program data:** like every Electron app, PDF-Tool creates a folder with technical cache and settings
  files (`%APPDATA%\PDF-Tool` for the downloaded version; for the Microsoft Store version Windows keeps this folder
  inside the app package and usually removes it when the app is uninstalled). It contains no documents. The app
  remembers the last folder you saved to only while it is running.

## 4. Web version

- The web version processes your files just as exclusively locally in your browser.
- It loads **no external content** (no CDN, no web fonts, no analytics or advertising services). All libraries
  are delivered with the page. In addition, a Content Security Policy prevents the page from making network
  connections.
- It sets **no cookies** and stores nothing in the browser (no local storage, no IndexedDB).
- If you open the downloaded file `index.html` directly from your disk, no data is transferred at all.

## 5. Microsoft Store

If you install PDF-Tool from the Microsoft Store, Microsoft processes data under its own responsibility, for
example for the download, the license and automatic updates. The
[Microsoft Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement) applies.

In Partner Center, Microsoft provides the publisher with aggregated statistics, such as the number of
installations and – depending on your Windows diagnostic data settings – information about crashes. This data is
collected by Windows or the Microsoft Store, not by PDF-Tool. Ratings and reviews you write in the Store are
public and visible to the publisher.

## 6. Hosting of the web version on GitHub Pages

If the web version is provided via GitHub Pages (e.g. at `https://manitas0.github.io/PDF-Tool/`), your browser
loads the page's files from servers of GitHub, Inc. (USA). GitHub processes technically necessary data such as
your IP address and logs access for security purposes. Data may be transferred to the USA in the process.
GitHub, Inc. is certified under the EU-US Data Privacy Framework; the transfer is based on the European
Commission's adequacy decision of 10 July 2023 (Art. 45 GDPR). The legal basis is Art. 6(1)(f) GDPR (legitimate
interest in providing the page securely and reliably). The publisher receives no personal access data of the web
version from GitHub. Details:
[GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
and [data collection on GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#data-collection).

The same applies when you view the repository or this privacy policy on github.com.

## 7. Contact via GitHub

To contact the publisher, use the issues of the GitHub repository. This requires a GitHub account; GitHub
processes the data of that account under its own privacy statement (see section 6). **Issues are publicly
visible** – do not post personal data there or attach confidential files. The publisher uses what you write only
to answer your request.

## 8. Your rights

As PDF-Tool itself does not process personal data, the publisher usually holds no data about you. Regardless of
this, under the GDPR you have the right of access, rectification, erasure, restriction of processing, data
portability and objection, as well as the right to lodge a complaint with a data protection supervisory
authority. For data processing by Microsoft or GitHub, please contact those companies directly.

## 9. Changes

This privacy policy is updated when PDF-Tool or the legal situation changes. The current version at this address
applies; earlier versions can be found in the repository's version history.
