// Generates the Microsoft Store screenshots (store/screenshots/*.png) from the real desktop app.
//
// Usage, from the repository root (needs `npm ci --omit=optional` here and `npm ci` in desktop/):
//   npm run prepare-app --prefix desktop
//   node store/make-screenshots.mjs                                          (Windows, macOS, Linux desktop)
//   xvfb-run -a -s "-screen 0 2560x1600x24" node store/make-screenshots.mjs  (Linux without a display)
//
// Every screenshot is 1920x1080 pixels (Partner Center needs at least 1366x768 for desktop apps): the
// window's content area gets 1920x1080 device pixels at a zoom factor of 1.25 – roughly what PDF-Tool looks
// like maximised on a Full-HD screen with Windows' 125 % scaling. The screen must be larger than that, or the
// window gets clamped and the script stops with a size error. The sample PDFs (German, fictitious people and
// companies) are generated with pdf-lib on every run; nothing is uploaded or saved outside a temporary folder.
// Not part of CI – run it by hand when the user interface changes.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DESKTOP_DIR = join(ROOT, 'desktop');
const OUT_DIR = join(ROOT, 'store', 'screenshots');
const ELECTRON_PATH = createRequire(join(DESKTOP_DIR, 'package.json'))('electron');
const WIDTH = 1920;
const HEIGHT = 1080;
const ZOOM = 1.25;

/* ------------------------------------------------------------------ sample PDFs */

const A4 = [595.28, 841.89];
const INK = rgb(0.12, 0.14, 0.2);
const MUTED = rgb(0.38, 0.41, 0.48);
const ACCENT = rgb(0.23, 0.36, 0.86);
const ACCENT_SOFT = rgb(0.9, 0.93, 1);
const LINE = rgb(0.85, 0.87, 0.91);

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Max Mustermann');
  doc.setLanguage('de-DE');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, regular, bold };
}

/** Draws `text` word-wrapped into `maxWidth`; returns the y below the paragraph. */
function paragraph(page, text, { x, y, maxWidth, font, size = 10.5, color = INK, leading = 1.45 }) {
  const words = text.split(/\s+/);
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color });
      y -= size * leading;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color });
    y -= size * leading;
  }
  return y - size * 0.6;
}

async function bewerbung() {
  const { doc, regular, bold } = await newDoc('Bewerbung – Max Mustermann');
  const page = doc.addPage(A4);
  const [w, h] = A4;
  page.drawRectangle({ x: 0, y: h - 14, width: w, height: 14, color: ACCENT });
  page.drawText('Max Mustermann', { x: 60, y: h - 80, size: 22, font: bold, color: INK });
  page.drawText('Musterstraße 12 · 10115 Berlin · 030 1234567 · max.mustermann@example.de', {
    x: 60, y: h - 100, size: 9, font: regular, color: MUTED,
  });
  page.drawLine({ start: { x: 60, y: h - 114 }, end: { x: w - 60, y: h - 114 }, thickness: 0.8, color: LINE });

  let y = h - 160;
  for (const line of ['Beispiel GmbH', 'Personalabteilung', 'Frau Erika Beispiel', 'Hauptstraße 1', '20095 Hamburg']) {
    page.drawText(line, { x: 60, y, size: 10.5, font: regular, color: INK });
    y -= 15;
  }
  page.drawText('Berlin, 14. Oktober 2026', { x: w - 60 - regular.widthOfTextAtSize('Berlin, 14. Oktober 2026', 10.5), y: y - 20, size: 10.5, font: regular, color: INK });
  y -= 60;
  page.drawText('Bewerbung als Projektmanager (m/w/d) – Kennziffer 2026-117', { x: 60, y, size: 12, font: bold, color: INK });
  y -= 34;
  const body = [
    'Sehr geehrte Frau Beispiel,',
    'mit großem Interesse habe ich Ihre Stellenanzeige gelesen. Seit sechs Jahren leite ich Projekte in der Softwareentwicklung und möchte meine Erfahrung gern in Ihr Team einbringen. Besonders reizt mich, dass Sie Prozesse konsequent digitalisieren und dabei Wert auf Datenschutz legen.',
    'In meiner aktuellen Position bei der Muster AG verantworte ich ein Team von acht Personen und ein Budget von 1,2 Mio. Euro. Ich habe die Einführung eines neuen Dokumentenmanagements geplant und termingerecht abgeschlossen; die Bearbeitungszeit von Anträgen sank dadurch um 40 Prozent.',
    'Zu meinen Stärken zählen eine strukturierte Arbeitsweise, Verhandlungsgeschick und die Fähigkeit, auch komplexe Sachverhalte verständlich zu erklären. Ein Zertifikat als Scrum Master sowie gute Englischkenntnisse runden mein Profil ab.',
    'Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr. Mein frühestmöglicher Eintrittstermin ist der 1. Januar 2027.',
    'Mit freundlichen Grüßen',
  ];
  for (const text of body) y = paragraph(page, text, { x: 60, y, maxWidth: w - 120, font: regular });
  page.drawText('Max Mustermann', { x: 60, y: y - 26, size: 16, font: regular, color: ACCENT });
  page.drawText('Anlagen: Lebenslauf, Arbeitszeugnis', { x: 60, y: 70, size: 9, font: regular, color: MUTED });
  return doc.save();
}

async function lebenslauf() {
  const { doc, regular, bold } = await newDoc('Lebenslauf – Max Mustermann');
  const [w, h] = A4;
  const sections = [
    [
      ['Berufserfahrung', [
        ['seit 03/2021', 'Projektmanager, Muster AG, Berlin', 'Leitung von Digitalisierungsprojekten, Team von acht Personen'],
        ['01/2018 – 02/2021', 'Projektkoordinator, Beispiel Software GmbH, Leipzig', 'Planung und Steuerung von Kundenprojekten'],
        ['08/2016 – 12/2017', 'Trainee Projektmanagement, Muster AG, Berlin', 'Stationen in Vertrieb, Entwicklung und Controlling'],
      ]],
      ['Ausbildung', [
        ['10/2012 – 07/2016', 'B. Sc. Wirtschaftsinformatik, Beispiel-Hochschule', 'Abschlussnote 1,7'],
        ['06/2012', 'Abitur, Goethe-Gymnasium Musterstadt', 'Leistungskurse Mathematik und Englisch'],
      ]],
    ],
    [
      ['Weiterbildung', [
        ['2024', 'Zertifizierter Scrum Master', 'Zweitägiges Seminar mit Prüfung'],
        ['2022', 'Projektmanagement nach PRINCE2', 'Foundation-Zertifikat'],
      ]],
      ['Kenntnisse', [
        ['Sprachen', 'Deutsch (Muttersprache), Englisch (verhandlungssicher)', 'Spanisch (Grundkenntnisse)'],
        ['IT', 'Office-Programme, Jira, Confluence, SQL', 'Grundkenntnisse in Python'],
      ]],
      ['Interessen', [['', 'Laufen, Fotografie, ehrenamtliche Nachhilfe', '']]],
    ],
  ];

  sections.forEach((pageSections, pageIndex) => {
    const page = doc.addPage(A4);
    page.drawRectangle({ x: 0, y: 0, width: 150, height: h, color: ACCENT_SOFT });
    let y = h - 80;
    if (pageIndex === 0) {
      // Photo placeholder and contact details in the sidebar.
      const photo = rgb(0.62, 0.68, 0.84);
      page.drawRectangle({ x: 30, y: h - 200, width: 90, height: 112, color: rgb(0.78, 0.82, 0.92) });
      page.drawCircle({ x: 75, y: h - 128, size: 20, color: photo });
      page.drawEllipse({ x: 75, y: h - 200, xScale: 34, yScale: 30, color: photo });
      page.drawRectangle({ x: 30, y: h - 232, width: 90, height: 32, color: ACCENT_SOFT });
      let sy = h - 250;
      page.drawText('KONTAKT', { x: 30, y: sy, size: 9, font: bold, color: ACCENT });
      for (const line of ['Musterstraße 12', '10115 Berlin', '030 1234567', 'max.mustermann', '@example.de']) {
        sy -= 15;
        page.drawText(line, { x: 30, y: sy, size: 8.5, font: regular, color: INK });
      }
      page.drawText('Lebenslauf', { x: 180, y, size: 26, font: bold, color: INK });
      page.drawText('Max Mustermann · geboren am 3. Mai 1993 in Musterstadt', { x: 180, y: y - 22, size: 10, font: regular, color: MUTED });
      y -= 70;
    } else {
      page.drawText('Lebenslauf (Fortsetzung)', { x: 180, y, size: 16, font: bold, color: INK });
      y -= 46;
    }
    for (const [title, entries] of pageSections) {
      page.drawText(title.toUpperCase(), { x: 180, y, size: 11, font: bold, color: ACCENT });
      page.drawLine({ start: { x: 180, y: y - 6 }, end: { x: w - 50, y: y - 6 }, thickness: 0.8, color: LINE });
      y -= 28;
      for (const [when, what, detail] of entries) {
        if (when) {
          page.drawText(when, { x: 180, y, size: 9, font: bold, color: MUTED });
          y -= 14;
        }
        page.drawText(what, { x: 180, y, size: 10.5, font: bold, color: INK });
        if (detail) page.drawText(detail, { x: 180, y: y - 15, size: 9.5, font: regular, color: MUTED });
        y -= 36;
      }
      y -= 14;
    }
    page.drawText(`Seite ${pageIndex + 1} von ${sections.length}`, { x: w - 110, y: 40, size: 8.5, font: regular, color: MUTED });
  });
  return doc.save();
}

async function zeugnis() {
  const { doc, regular, bold } = await newDoc('Arbeitszeugnis – Max Mustermann');
  const [w, h] = A4;
  const paragraphs = [
    [
      'Herr Max Mustermann, geboren am 3. Mai 1993, war vom 1. Januar 2018 bis zum 28. Februar 2021 als Projektkoordinator in unserem Unternehmen tätig.',
      'Die Beispiel Software GmbH entwickelt mit 120 Beschäftigten Softwarelösungen für Verwaltungen und mittelständische Unternehmen.',
      'Zu den Aufgaben von Herrn Mustermann gehörten insbesondere die Planung und Steuerung von Kundenprojekten, die Abstimmung mit Auftraggebern und Fachabteilungen, die Überwachung von Terminen und Budgets sowie das Berichtswesen gegenüber der Geschäftsleitung.',
      'Herr Mustermann verfügt über ein umfassendes und fundiertes Fachwissen, das er stets sicher und zielgerichtet einsetzte. Er arbeitete sich schnell in neue Aufgaben ein und überzeugte durch eine sehr strukturierte und sorgfältige Arbeitsweise.',
    ],
    [
      'Auch unter hoher Belastung behielt er stets den Überblick und erzielte Ergebnisse von sehr guter Qualität. Seine Projekte schloss er ausnahmslos termingerecht und im vereinbarten Kostenrahmen ab.',
      'Sein Verhalten gegenüber Vorgesetzten, Kolleginnen und Kollegen sowie Kunden war stets vorbildlich. Er trug wesentlich zu einer offenen und konstruktiven Zusammenarbeit bei.',
      'Herr Mustermann verlässt unser Unternehmen auf eigenen Wunsch, um sich beruflich weiterzuentwickeln. Wir bedauern seinen Weggang sehr, danken ihm für die stets sehr gute Zusammenarbeit und wünschen ihm für seinen weiteren Berufs- und Lebensweg alles Gute und weiterhin viel Erfolg.',
    ],
  ];
  paragraphs.forEach((texts, pageIndex) => {
    const page = doc.addPage(A4);
    page.drawRectangle({ x: 60, y: h - 92, width: 28, height: 28, color: ACCENT });
    page.drawText('Beispiel Software GmbH', { x: 98, y: h - 76, size: 13, font: bold, color: INK });
    page.drawText('Augustusplatz 9 · 04109 Leipzig', { x: 98, y: h - 90, size: 8.5, font: regular, color: MUTED });
    page.drawLine({ start: { x: 60, y: h - 108 }, end: { x: w - 60, y: h - 108 }, thickness: 0.8, color: LINE });
    let y = h - 170;
    if (pageIndex === 0) {
      const title = 'Arbeitszeugnis';
      page.drawText(title, { x: (w - bold.widthOfTextAtSize(title, 20)) / 2, y, size: 20, font: bold, color: INK });
      y -= 48;
    }
    for (const text of texts) y = paragraph(page, text, { x: 60, y, maxWidth: w - 120, font: regular, size: 11 });
    if (pageIndex === paragraphs.length - 1) {
      page.drawText('Leipzig, 28. Februar 2021', { x: 60, y: y - 30, size: 11, font: regular, color: INK });
      page.drawText('Dr. Erika Beispiel', { x: 60, y: y - 90, size: 15, font: regular, color: ACCENT });
      page.drawLine({ start: { x: 60, y: y - 98 }, end: { x: 240, y: y - 98 }, thickness: 0.6, color: MUTED });
      page.drawText('Geschäftsführerin', { x: 60, y: y - 112, size: 9.5, font: regular, color: MUTED });
    }
    page.drawText(`Seite ${pageIndex + 1} von ${paragraphs.length}`, { x: w - 110, y: 40, size: 8.5, font: regular, color: MUTED });
  });
  return doc.save();
}

async function handbuch() {
  const { doc, regular, bold } = await newDoc('Benutzerhandbuch');
  const [w, h] = A4;
  const chapters = [
    ['Inhalt', 'toc'],
    ['1  Einleitung', 'text'],
    ['2  Installation', 'steps'],
    ['3  Erste Schritte', 'figure'],
    ['4  Dokumente verwalten', 'table'],
    ['5  Suchen und Filtern', 'text'],
    ['6  Freigaben', 'figure'],
    ['7  Berichte', 'chart'],
    ['8  Tastenkürzel', 'table'],
    ['9  Häufige Fragen', 'text'],
    ['10  Kontakt', 'steps'],
  ];
  const filler =
    'Dieses Kapitel beschreibt die wichtigsten Funktionen Schritt für Schritt. Lesen Sie die Hinweise sorgfältig, bevor Sie Einstellungen ändern. Alle Beispiele beziehen sich auf die aktuelle Version.';

  // Cover page.
  const cover = doc.addPage(A4);
  cover.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0.16, 0.26, 0.68) });
  cover.drawRectangle({ x: 0, y: h * 0.38, width: w, height: 6, color: rgb(0.55, 0.65, 1) });
  cover.drawText('Benutzerhandbuch', { x: 60, y: h * 0.62, size: 40, font: bold, color: rgb(1, 1, 1) });
  cover.drawText('Version 3.2 · Oktober 2026', { x: 60, y: h * 0.62 - 36, size: 15, font: regular, color: rgb(0.85, 0.88, 1) });
  cover.drawText('Beispiel Software GmbH', { x: 60, y: 70, size: 12, font: bold, color: rgb(0.85, 0.88, 1) });

  chapters.forEach(([title, kind], index) => {
    const page = doc.addPage(A4);
    page.drawRectangle({ x: 0, y: h - 130, width: w, height: 130, color: ACCENT_SOFT });
    page.drawText(title, { x: 50, y: h - 88, size: 30, font: bold, color: ACCENT });
    let y = h - 180;
    if (kind === 'toc') {
      chapters.slice(1).forEach(([chapter], i) => {
        page.drawText(chapter, { x: 50, y, size: 13, font: regular, color: INK });
        const num = String(i + 3);
        page.drawText(num, { x: w - 50 - regular.widthOfTextAtSize(num, 13), y, size: 13, font: regular, color: INK });
        page.drawLine({ start: { x: 50, y: y - 8 }, end: { x: w - 50, y: y - 8 }, thickness: 0.5, color: LINE });
        y -= 36;
      });
    } else {
      y = paragraph(page, filler, { x: 50, y, maxWidth: w - 100, font: regular, size: 11 });
      if (kind === 'figure') {
        page.drawRectangle({ x: 50, y: y - 230, width: w - 100, height: 220, color: rgb(0.95, 0.96, 0.98), borderColor: LINE, borderWidth: 1 });
        page.drawRectangle({ x: 70, y: y - 60, width: w - 140, height: 28, color: ACCENT });
        for (let i = 0; i < 3; i += 1) page.drawRectangle({ x: 70 + i * 160, y: y - 200, width: 140, height: 120, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 1 });
        page.drawText(`Abbildung ${index}: Übersicht`, { x: 50, y: y - 250, size: 9.5, font: regular, color: MUTED });
        y -= 290;
      } else if (kind === 'table') {
        const rows = 8;
        for (let r = 0; r < rows; r += 1) {
          page.drawRectangle({ x: 50, y: y - 26 * (r + 1), width: w - 100, height: 26, color: r === 0 ? ACCENT : r % 2 ? rgb(1, 1, 1) : rgb(0.96, 0.97, 0.99) });
          page.drawText(r === 0 ? 'Funktion' : `Eintrag ${r}`, { x: 60, y: y - 26 * (r + 1) + 9, size: 10, font: r === 0 ? bold : regular, color: r === 0 ? rgb(1, 1, 1) : INK });
          page.drawText(r === 0 ? 'Beschreibung' : 'Kurze Erläuterung der Funktion', { x: 220, y: y - 26 * (r + 1) + 9, size: 10, font: r === 0 ? bold : regular, color: r === 0 ? rgb(1, 1, 1) : MUTED });
        }
        y -= 26 * rows + 30;
      } else if (kind === 'chart') {
        const values = [0.45, 0.62, 0.38, 0.8, 0.7, 0.92];
        values.forEach((v, i) => page.drawRectangle({ x: 70 + i * 75, y: y - 230, width: 46, height: 200 * v, color: i % 2 ? ACCENT : rgb(0.55, 0.65, 1) }));
        page.drawLine({ start: { x: 60, y: y - 230 }, end: { x: w - 60, y: y - 230 }, thickness: 1, color: MUTED });
        y -= 270;
      } else if (kind === 'steps') {
        for (let i = 1; i <= 4; i += 1) {
          page.drawCircle({ x: 64, y: y - 6, size: 13, color: ACCENT });
          page.drawText(String(i), { x: 60.5, y: y - 10, size: 11, font: bold, color: rgb(1, 1, 1) });
          page.drawText(`Schritt ${i}: Anweisung ausführen und Ergebnis prüfen`, { x: 90, y: y - 10, size: 11.5, font: regular, color: INK });
          y -= 46;
        }
        y -= 10;
      }
      for (let i = 0; i < 3 && y > 140; i += 1) y = paragraph(page, filler, { x: 50, y, maxWidth: w - 100, font: regular, size: 11 });
    }
    const pageNo = String(index + 2);
    page.drawText(pageNo, { x: w - 50 - regular.widthOfTextAtSize(pageNo, 10), y: 36, size: 10, font: regular, color: MUTED });
  });
  return doc.save();
}

/* ------------------------------------------------------------------ app driving */

const workDir = await mkdtemp(join(tmpdir(), 'pdf-tool-store-'));
const downloadDir = join(workDir, 'downloads');
const profileDir = join(workDir, 'profile');
await mkdir(downloadDir);
await mkdir(OUT_DIR, { recursive: true });

const samples = {
  'Bewerbung.pdf': await bewerbung(),
  'Lebenslauf.pdf': await lebenslauf(),
  'Zeugnis.pdf': await zeugnis(),
  'Handbuch.pdf': await handbuch(),
};
const asFile = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(samples[name]) });

const env = { ...process.env, PDF_TOOL_E2E_DOWNLOAD_DIR: downloadDir, PDF_TOOL_E2E_USER_DATA_DIR: profileDir };
if (process.platform === 'linux') env.LC_ALL = 'C.UTF-8';
const args = [
  // Chromium refuses to run as root without --no-sandbox (containers/CI only).
  ...(process.platform === 'linux' && process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),
  '--force-device-scale-factor=1',
  '.',
];

const app = await electron.launch({ executablePath: ELECTRON_PATH, args, cwd: DESKTOP_DIR, env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('load');

  // nativeTheme switches prefers-color-scheme on Windows and macOS, but not on Linux: emulate it as well.
  // Reduced motion makes the app scroll results into view instantly instead of smoothly.
  const setTheme = async (theme) => {
    await app.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.waitForFunction((value) => matchMedia(`(prefers-color-scheme: ${value})`).matches, theme);
  };
  await setTheme('light');
  await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'PDF-Tool');
    win.setContentSize(width, height);
    win.webContents.setZoomFactor(zoom);
  }, { width: WIDTH, height: HEIGHT, zoom: ZOOM });
  await page.waitForFunction(({ width, zoom }) => Math.abs(window.innerWidth - width / zoom) < 2, { width: WIDTH, zoom: ZOOM });

  /**
   * Waits until the page is idle, removes focus and hover effects, scrolls and saves a screenshot.
   * scroll: undefined = page top; { top: selector } = that element at the top; { bottom: selector } =
   * that element at the bottom of the window.
   */
  async function shoot(name, scroll = {}) {
    await page.locator('#busy').waitFor({ state: 'hidden' });
    await page.mouse.move(2, 2);
    await page.evaluate(({ top, bottom, margin }) => {
      document.activeElement?.blur();
      let y = 0;
      if (top) y = document.querySelector(top).getBoundingClientRect().top + window.scrollY - margin;
      if (bottom) y = document.querySelector(bottom).getBoundingClientRect().bottom + window.scrollY - window.innerHeight + margin;
      window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    }, { top: scroll.top, bottom: scroll.bottom, margin: scroll.margin ?? 20 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700); // transitions (160 ms) and thumbnails that were just inserted
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'PDF-Tool');
      const image = await win.webContents.capturePage();
      return { size: image.getSize(), data: image.toPNG().toString('base64') };
    });
    if (png.size.width !== WIDTH || png.size.height !== HEIGHT) {
      throw new Error(`${name}: ${png.size.width}x${png.size.height} statt ${WIDTH}x${HEIGHT}`);
    }
    await writeFile(join(OUT_DIR, name), Buffer.from(png.data, 'base64'));
    console.log(`gespeichert: store/screenshots/${name}`);
  }

  async function waitForMergeThumbs(count) {
    await page.waitForFunction((n) => document.querySelectorAll('#merge-list canvas').length >= n, count);
  }
  async function waitForSplitThumbs() {
    await page.waitForFunction(() => {
      const frames = [...document.querySelectorAll('#split-thumbnails .page-thumb-frame')];
      return frames.length > 0 && frames.every((frame) => frame.querySelector('canvas'));
    });
  }

  // 1 – Zusammenführen: eine Bewerbungsmappe aus drei Dateien.
  await page.locator('#merge-input').setInputFiles(['Bewerbung.pdf', 'Lebenslauf.pdf', 'Zeugnis.pdf'].map(asFile));
  await waitForMergeThumbs(3);
  await page.locator('#merge-filename').fill('Bewerbungsmappe_Max_Mustermann.pdf');
  await shoot('01-zusammenfuehren.png');

  // 2 – Ergebnis des Zusammenführens.
  await page.locator('#merge-run').click();
  await page.locator('#merge-result').waitFor({ state: 'visible' });
  await shoot('02-ergebnis-zusammenfuehren.png', { bottom: '.site-footer', margin: 0 });

  // 3 – Teilen nach Seitenbereichen: die Seitenvorschau zeigt, in welcher Datei jede Seite landet.
  await page.locator('#tab-split').click();
  await page.locator('#split-input').setInputFiles(asFile('Handbuch.pdf'));
  await waitForSplitThumbs();
  await page.locator('#split-ranges').fill('1-2, 3-6, 7-12');
  await shoot('03-teilen-seitenbereiche.png', { top: '#split-file-info', margin: 14 });

  // 4 – Seiten auswählen per Klick in der Vorschau.
  await page.locator('input[name="split-mode"][value="extract"]').check();
  for (const pageNo of [1, 4, 5, 9]) await page.locator(`.page-thumb[data-page="${pageNo}"]`).click();
  await shoot('04-seiten-auswaehlen.png', { top: '#split-file-info', margin: 14 });

  // 6 – Dunkler Modus (folgt der Windows-Einstellung): Teilen in gleich große Teile. Taken before 5, while
  // the status line still says that the file was loaded.
  await setTheme('dark');
  await page.locator('input[name="split-mode"][value="chunk"]').check();
  await page.locator('#split-chunk-size').fill('3');
  await shoot('06-dunkler-modus.png', { top: '#split-file-info', margin: 14 });
  await setTheme('light');

  // 5 – Ergebnis des Teilens: ZIP-Archiv und einzelne Dateien.
  await page.locator('input[name="split-mode"][value="ranges"]').check();
  await page.locator('#split-run').click();
  await page.locator('#split-results').waitFor({ state: 'visible' });
  await shoot('05-ergebnis-teilen.png', { bottom: '.site-footer', margin: 0 });
} finally {
  await app.close();
  await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
