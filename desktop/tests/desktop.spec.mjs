// End-to-end tests of the Electron desktop app (main.js + the web app copied to desktop/app/).
//
// Every test starts a fresh app instance with PDF_TOOL_E2E_DOWNLOAD_DIR pointing at an empty
// temporary folder, so downloads are saved there silently instead of opening the native
// "Speichern unter" dialog, and with PDF_TOOL_E2E_USER_DATA_DIR pointing at a fresh profile, so a
// PDF-Tool that is running anyway (`npm start`, an installed copy) does not get in the way. Test
// PDFs come from the web app's e2e helpers: every page has a unique width, which identifies it in
// a saved result.
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, _electron as electron } from '@playwright/test';
import { createPdf, pdfFile, readPageWidths, readZip } from '../../tests/e2e/helpers.mjs';

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url));
const INDEX_URL = 'app://pdf-tool/index.html';
// The Electron binary of desktop/node_modules (Playwright itself lives in the repository root).
const ELECTRON_PATH = createRequire(join(DESKTOP_DIR, 'package.json'))('electron');
// Chromium refuses to run as root without --no-sandbox (only in containers/CI, never on Windows).
const LAUNCH_ARGS = [
  ...(process.platform === 'linux' && process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),
  '.',
];

const test = base.extend({
  // Console errors a test expects (e.g. Chromium refusing to load file:// URLs).
  allowedErrors: [[], { option: true }],

  downloadDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-tool-desktop-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-tool-profile-'));
    await use(dir);
    // On Windows, helper processes (crash handler) may hold files a moment after the app quit.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  },

  /** Environment of an app instance started by a test. */
  appEnv: async ({ downloadDir, userDataDir }, use) => {
    const env = { ...process.env, PDF_TOOL_E2E_DOWNLOAD_DIR: downloadDir, PDF_TOOL_E2E_USER_DATA_DIR: userDataDir };
    // Keep non-ASCII download names intact under a POSIX locale (see the root playwright.config.mjs).
    if (process.platform === 'linux') env.LC_ALL = 'C.UTF-8';
    await use(env);
  },

  electronApp: async ({ appEnv }, use, testInfo) => {
    const app = await electron.launch({ executablePath: ELECTRON_PATH, args: LAUNCH_ARGS, cwd: DESKTOP_DIR, env: appEnv });
    await app.context().tracing.start({ screenshots: true, snapshots: true });

    await use(app);

    const failed = testInfo.status !== testInfo.expectedStatus;
    await app.context().tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : undefined);
    await app.close();
  },

  /** The main window; fails the test on console errors or uncaught exceptions in it. */
  window: async ({ electronApp, allowedErrors }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack || error.message}`));
    page.on('crash', () => errors.push('Der Renderer ist abgestürzt.'));
    await page.waitForLoadState('load');

    await use(page);

    const unexpected = errors.filter((entry) => !allowedErrors.some((pattern) => pattern.test(entry)));
    if (testInfo.status === testInfo.expectedStatus) {
      expect(unexpected, 'Konsolen- oder Seitenfehler im Hauptfenster').toEqual([]);
    }
  },
});

/** Titles of all open windows, as seen by the main process. */
function windowTitles(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.getTitle()).sort());
}

/** Waits until `name` has been saved completely into `dir` and returns its content. */
async function savedFile(dir, name, parse) {
  let result;
  await expect
    .poll(
      async () => {
        try {
          const bytes = new Uint8Array(await readFile(join(dir, name)));
          result = parse ? await parse(bytes) : bytes;
          return true;
        } catch {
          return false; // not there yet, or still being written
        }
      },
      { message: `${name} wurde nicht gespeichert`, timeout: 20_000 }
    )
    .toBe(true);
  return result;
}

test('startet abgesichert: Titel, app://-Herkunft, kein Node.js im Renderer, keine Berechtigungen', async ({
  electronApp,
  window,
  userDataDir,
}) => {
  // Reload once so that the error listeners of the fixture also cover the very first page load.
  await window.reload();
  await expect(window.locator('#tab-merge')).toBeVisible();

  expect(await windowTitles(electronApp)).toEqual(['PDF-Tool']);
  expect(window.url()).toBe(INDEX_URL);
  expect(await window.evaluate(() => location.origin)).toBe('app://pdf-tool');
  // The test's own profile, not the one of an installed PDF-Tool (realpath: Windows short names).
  const [appName, userData] = await electronApp.evaluate(({ app }) => [app.getName(), app.getPath('userData')]);
  expect(appName).toBe('PDF-Tool');
  expect(await realpath(userData)).toBe(await realpath(userDataDir));

  const prefs = await electronApp.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      sandbox: p.sandbox,
      nodeIntegration: p.nodeIntegration,
      webSecurity: p.webSecurity,
      webviewTag: p.webviewTag,
      preload: p.preload || null,
    };
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    preload: null,
  });

  const globals = await window.evaluate(() => ({
    require: typeof require,
    process: typeof process,
    module: typeof module,
    Buffer: typeof Buffer,
    electron: typeof electron,
    PDFLib: typeof PDFLib,
    pdfjsLib: typeof pdfjsLib,
    JSZip: typeof JSZip,
    PdfCore: typeof PdfCore,
  }));
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    Buffer: 'undefined',
    electron: 'undefined',
    PDFLib: 'object',
    pdfjsLib: 'object',
    JSZip: 'function',
    PdfCore: 'object',
  });

  // Every permission request is denied.
  expect(await window.evaluate(() => Notification.requestPermission())).toBe('denied');

  const menu = await electronApp.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => [item.label.replace('&', ''), item.submenu.items.map((sub) => sub.label)])
  );
  expect(menu.map(([label]) => label)).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Hilfe']);
  expect(menu[0][1]).toEqual(['Beenden']);
  expect(menu[1][1]).toEqual(
    expect.arrayContaining(['Rückgängig', 'Wiederherstellen', 'Ausschneiden', 'Kopieren', 'Einfügen', 'Alles auswählen'])
  );
  expect(menu[2][1]).toEqual(expect.arrayContaining(['Originalgröße', 'Vergrößern', 'Verkleinern', 'Vollbild']));
  expect(menu[3][1]).toEqual(['Über PDF-Tool']);

  // The window background follows the system theme (no white flash in dark mode).
  const backgrounds = await electronApp.evaluate(async ({ BrowserWindow, nativeTheme }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = {};
    for (const theme of ['dark', 'light']) {
      nativeTheme.themeSource = theme;
      await new Promise((resolve) => setTimeout(resolve, 200));
      result[theme] = win.getBackgroundColor().toLowerCase();
    }
    nativeTheme.themeSource = 'system';
    return result;
  });
  expect(backgrounds).toEqual({ dark: '#0e1117', light: '#f5f6fa' });
});

test('pdf.js rendert Vorschaubilder mit echtem Web Worker', async ({ window }) => {
  await window.locator('#merge-input').setInputFiles(pdfFile('vorschau.pdf', await createPdf(2, { baseWidth: 220 })));
  const canvas = window.locator('#merge-list .merge-item-thumb canvas');
  await expect(canvas).toHaveCount(1);

  // The canvas actually shows the page: light-blue rectangle and dark text, not just white.
  const coloredPixels = await canvas.evaluate((element) => {
    const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) count += 1;
    }
    return count;
  });
  expect(coloredPixels).toBeGreaterThan(100);

  // A real worker thread runs vendor/pdf.worker.min.js – no main-thread "fake worker" fallback.
  expect(window.workers().map((worker) => worker.url())).toContain('app://pdf-tool/vendor/pdf.worker.min.js');
  expect(await window.evaluate(() => typeof globalThis.pdfjsWorker)).toBe('undefined');

  // The worker parses the untrusted PDFs, so it has a CSP of its own: no string eval, no requests.
  // (A string passed to setTimeout is not covered by the evaluate() bypass of the DevTools protocol.)
  const worker = window.workers().find((w) => w.url() === 'app://pdf-tool/vendor/pdf.worker.min.js');
  await worker.evaluate(() => {
    self.__stringTimerRan = false;
    setTimeout('self.__stringTimerRan = true', 0);
  });
  await window.waitForTimeout(500);
  expect(await worker.evaluate(() => self.__stringTimerRan)).toBe(false);
  expect(
    await worker.evaluate(() =>
      fetch('app://pdf-tool/index.html').then(
        (response) => `geladen (${response.status})`,
        () => 'blockiert'
      )
    )
  ).toBe('blockiert');
});

test('Zusammenführen speichert die PDF im Download-Ordner in der gewählten Reihenfolge', async ({
  window,
  downloadDir,
}) => {
  await window
    .locator('#merge-input')
    .setInputFiles([
      pdfFile('erste.pdf', await createPdf(3, { baseWidth: 100 })),
      pdfFile('zweite.pdf', await createPdf(2, { baseWidth: 200 })),
    ]);
  const items = window.locator('#merge-list li.merge-item');
  await expect(items).toHaveCount(2);
  await expect(window.locator('#merge-summary')).toContainText('5 Seiten');

  // Move the second file to the front and pick only some of its pages.
  await items.nth(1).locator('.merge-item-up').click();
  await expect(items.nth(0).locator('.merge-item-name')).toHaveText('zweite.pdf');
  await items.nth(1).locator('.merge-item-range').fill('3, 1');
  await window.locator('#merge-filename').fill('Ergebnis Desktop.pdf');

  await window.locator('#merge-run').click();
  await expect(window.locator('#status')).toContainText('Fertig!');

  const widths = await savedFile(downloadDir, 'Ergebnis Desktop.pdf', readPageWidths);
  expect(widths).toEqual([200, 201, 102, 100]);
  expect(await readdir(downloadDir)).toEqual(['Ergebnis Desktop.pdf']);
});

test('Teilen nach Seitenbereichen speichert ein ZIP mit den richtigen PDFs', async ({ window, downloadDir }) => {
  await window.locator('#tab-split').click();
  await window.locator('#split-input').setInputFiles(pdfFile('bericht.pdf', await createPdf(6, { baseWidth: 300 })));
  await expect(window.locator('#split-file-info')).toBeVisible();
  await expect(window.locator('#busy')).toBeHidden();

  await expect(window.locator('input[name="split-mode"][value="ranges"]')).toBeChecked();
  await expect(window.locator('#split-zip')).toBeChecked();
  await window.locator('#split-ranges').fill('1-3, 5-4, 6');
  await expect(window.locator('#split-preview')).toContainText('Ergibt 3 Dateien');

  await window.locator('#split-run').click();
  await expect(window.locator('#split-results a.split-download')).toHaveCount(3);

  const zip = await savedFile(downloadDir, 'bericht_geteilt.zip', readZip);
  expect(zip.names).toEqual(['bericht_S1-3.pdf', 'bericht_S5-4.pdf', 'bericht_S6.pdf']);
  expect(await readPageWidths(zip.files.get('bericht_S1-3.pdf'))).toEqual([300, 301, 302]);
  expect(await readPageWidths(zip.files.get('bericht_S5-4.pdf'))).toEqual([304, 303]);
  expect(await readPageWidths(zip.files.get('bericht_S6.pdf'))).toEqual([305]);
  // Only the archive is saved automatically; the single files are just offered as links.
  expect(await readdir(downloadDir)).toEqual(['bericht_geteilt.zip']);
});

/** URL of the main window according to the main process. */
function mainWindowUrl(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'PDF-Tool');
    return main.webContents.getURL();
  });
}

/**
 * Clicks an element from within the page. Playwright's own click() would wait for the navigation
 * the click requests – which the app blocks, so it would wait forever. For the same reason the
 * tests below check the main window with evaluate() instead of locators once a navigation was
 * blocked: Playwright keeps considering a navigation cancelled by the app as pending.
 */
function clickInPage(page, selector) {
  return page.evaluate((sel) => document.querySelector(sel).click(), selector);
}

test.describe('Navigation und Fenster', () => {
  // Chromium itself refuses file:// URLs in an app:// page and reports that on the console.
  test.use({ allowedErrors: [/^console\.error: Not allowed to load local resource: file:\/\/\//] });

  test('Navigation weg von index.html wird blockiert', async ({ electronApp, window }) => {
    for (const target of ['https://example.com/', 'file:///', 'app://pdf-tool/js/app.js', 'app://pdf-tool/vendor/']) {
      await window.evaluate((url) => {
        location.href = url;
      }, target);
      // Give a (wrongly) permitted navigation time to commit.
      await window.waitForTimeout(500);
      expect(await mainWindowUrl(electronApp), `Navigation zu ${target}`).toBe(INDEX_URL);
      expect(await window.evaluate(() => location.href), `Navigation zu ${target}`).toBe(INDEX_URL);
    }

    // The page is still alive and usable.
    const splitVisible = await window.evaluate(() => {
      document.querySelector('#tab-split').click();
      return !document.querySelector('#panel-split').hidden;
    });
    expect(splitVisible).toBe(true);
    expect(await windowTitles(electronApp)).toEqual(['PDF-Tool']);
  });

  test('window.open: http(s) im Standardbrowser, alles andere wird verweigert', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ shell }) => {
      globalThis.__openedExternally = [];
      shell.openExternal = async (url) => {
        globalThis.__openedExternally.push(url);
      };
    });

    const opened = await window.evaluate(() =>
      ['https://example.com/', 'http://example.org/seite', 'file:///', 'app://pdf-tool/index.html', 'about:blank'].map(
        (url) => window.open(url) !== null
      )
    );
    expect(opened).toEqual([false, false, false, false, false]);

    expect(await electronApp.evaluate(() => globalThis.__openedExternally)).toEqual([
      'https://example.com/',
      'http://example.org/seite',
    ]);
    expect(await windowTitles(electronApp)).toEqual(['PDF-Tool']);
    expect(await mainWindowUrl(electronApp)).toBe(INDEX_URL);
  });

  test('Lizenz-Links öffnen ein eigenes Fenster, das Hauptfenster bleibt auf index.html', async ({
    electronApp,
    window,
  }) => {
    const pdfLibLink = '.site-footer a[href="vendor/licenses/pdf-lib-LICENSE.md"]';
    const pdfjsLink = '.site-footer a[href="vendor/licenses/pdfjs-LICENSE"]';
    await expect(window.locator(pdfLibLink)).toHaveText('pdf-lib');

    const [licenseWindow] = await Promise.all([electronApp.waitForEvent('window'), clickInPage(window, pdfLibLink)]);
    await licenseWindow.waitForLoadState('load');
    expect(licenseWindow.url()).toBe('app://pdf-tool/vendor/licenses/pdf-lib-LICENSE.md');
    expect(await licenseWindow.evaluate(() => document.contentType)).toBe('text/plain');
    await expect(licenseWindow.locator('body')).toContainText('Permission is hereby granted');

    expect(await mainWindowUrl(electronApp)).toBe(INDEX_URL);
    expect(await windowTitles(electronApp)).toEqual(['Lizenz – pdf-lib', 'PDF-Tool']);

    // The license window itself cannot navigate anywhere.
    await licenseWindow.evaluate(() => {
      location.href = 'app://pdf-tool/index.html';
    });
    await licenseWindow.waitForTimeout(500);
    expect(await licenseWindow.evaluate(() => location.href)).toBe('app://pdf-tool/vendor/licenses/pdf-lib-LICENSE.md');

    // Another license link reuses the same window.
    await clickInPage(window, pdfjsLink);
    await expect.poll(() => licenseWindow.url()).toBe('app://pdf-tool/vendor/licenses/pdfjs-LICENSE');
    await expect(licenseWindow.locator('body')).toContainText('Apache License');
    expect(await windowTitles(electronApp)).toEqual(['Lizenz – pdf.js', 'PDF-Tool']);
    expect(await mainWindowUrl(electronApp)).toBe(INDEX_URL);

    // Escape closes it again (sent like a real key press, through the main process).
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('Lizenz'));
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    });
    await expect.poll(() => windowTitles(electronApp)).toEqual(['PDF-Tool']);
  });
});

test('app://-Protokoll liefert nichts außerhalb von app/', async ({ electronApp, window }) => {
  await expect(window.locator('#tab-merge')).toBeVisible();
  const fetchAll = (urls) =>
    electronApp.evaluate(async ({ net }, list) => {
      const results = [];
      for (const url of list) {
        try {
          const response = await net.fetch(url);
          const body = await response.text();
          results.push({
            url,
            status: response.status,
            type: response.headers.get('content-type'),
            csp: response.headers.get('content-security-policy'),
            body: body.slice(0, 300),
          });
        } catch (error) {
          results.push({ url, status: 0, type: null, csp: null, body: String(error) });
        }
      }
      return results;
    }, urls);

  const allowed = await fetchAll([
    'app://pdf-tool/index.html',
    'app://pdf-tool/',
    'app://pdf-tool/vendor/pdf.worker.min.js',
    'app://pdf-tool/vendor/licenses/pdfjs-LICENSE',
  ]);
  expect(allowed.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
  expect(allowed[0].type).toMatch(/^text\/html/);
  expect(allowed[2].type).toMatch(/^text\/javascript/);
  expect(allowed[3].type).toMatch(/^text\/plain/);
  // index.html brings its CSP as <meta>; scripts (for the pdf.js worker) and plain texts get one as header.
  expect(allowed.map(({ csp }) => csp)).toEqual([null, null, "default-src 'none'", "default-src 'none'"]);

  const blocked = await fetchAll([
    'app://pdf-tool/../package.json',
    'app://pdf-tool/../main.js',
    'app://pdf-tool/..%2fpackage.json',
    'app://pdf-tool/..%2Fmain.js',
    'app://pdf-tool/%2e%2e/package.json',
    'app://pdf-tool/%2e%2e%2fpackage.json',
    'app://pdf-tool/vendor/..%2f..%2fpackage.json',
    'app://pdf-tool/js/%2e%2e%2f%2e%2e%2fmain.js',
    'app://pdf-tool/..%5cpackage.json',
    'app://pdf-tool/js%5c..%5c..%5cmain.js',
    'app://pdf-tool/%252e%252e%252fpackage.json',
    'app://pdf-tool/package.json',
    'app://pdf-tool/main.js',
    'app://pdf-tool/js/',
    'app://pdf-tool/vendor',
    'app://pdf-tool/index.html%00.png',
    'app://pdf-tool/%E0%A4%A',
    'app://anderer-host/index.html',
  ]);
  for (const { url, status, body } of blocked) {
    expect(status, url).toBe(404);
    expect(body, url).not.toContain('pdf-tool-desktop');
    expect(body, url).not.toContain('require(');
  }

  // Read-only: HEAD works, anything that would send data does not.
  const methods = await electronApp.evaluate(async ({ net }) => {
    const head = await net.fetch('app://pdf-tool/index.html', { method: 'HEAD' });
    const post = await net.fetch('app://pdf-tool/index.html', { method: 'POST', body: 'x' });
    return { head: head.status, headBody: await head.text(), post: post.status };
  });
  expect(methods).toEqual({ head: 200, headBody: '', post: 405 });
});

test('Netzwerkzugriffe werden blockiert, auch aus dem Hauptprozess', async ({ electronApp, window }) => {
  await expect(window.locator('#tab-merge')).toBeVisible();
  // No real traffic: the request is cancelled before it leaves the app.
  const results = await electronApp.evaluate(async ({ net, BrowserWindow }) => {
    const out = {};
    for (const url of ['https://example.com/', 'http://127.0.0.1:9/', 'file:///']) {
      try {
        out[url] = `geladen (${(await net.fetch(url)).status})`;
      } catch (error) {
        out[url] = String(error.message || error);
      }
    }
    const hidden = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      await hidden.loadURL('https://example.com/');
      out.window = `geladen: ${hidden.webContents.getURL()}`;
    } catch (error) {
      out.window = String(error.message || error);
    } finally {
      hidden.destroy();
    }
    return out;
  });
  for (const [what, result] of Object.entries(results)) {
    expect(result, what).toContain('ERR_BLOCKED_BY_CLIENT');
  }
});

test('WebRTC (STUN/TURN über UDP und TCP) erreicht das Netz nicht', async ({ window }) => {
  // WebRTC does not go through webRequest. Local listeners stand in for a STUN/TURN server; with a
  // hole in the blocking they receive STUN/TURN requests within a few hundred milliseconds.
  const received = [];
  const udp = createSocket('udp4');
  udp.on('message', (message) => received.push(`UDP ${message.length} Bytes`));
  await new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve));
  const tcp = createServer((socket) => {
    received.push('TCP-Verbindung');
    socket.on('data', (data) => received.push(`TCP ${data.length} Bytes`));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));

  try {
    const ports = { udp: udp.address().port, tcp: tcp.address().port };
    await window.evaluate(async ({ udp: udpPort, tcp: tcpPort }) => {
      const connection = new RTCPeerConnection({
        iceServers: [
          { urls: `turn:127.0.0.1:${udpPort}?transport=udp`, username: 'pdf-tool', credential: 'x' },
          { urls: `turn:127.0.0.1:${tcpPort}?transport=tcp`, username: 'pdf-tool', credential: 'x' },
          { urls: `stun:127.0.0.1:${udpPort}` },
        ],
      });
      connection.createDataChannel('test');
      await connection.setLocalDescription(await connection.createOffer());
      await new Promise((resolve) => setTimeout(resolve, 3000));
      connection.close();
    }, ports);
    expect(received, 'Pakete an den STUN/TURN-Server').toEqual([]);
  } finally {
    udp.close();
    tcp.close();
  }
});

test('die App baut keinerlei Netzwerkverbindungen auf (Net-Log)', async ({ downloadDir, appEnv }) => {
  // Own app instance: Chromium writes the complete net log only when the app quits. Its profile is
  // fresh, like at the first start after installing (that is when e.g. dictionaries get downloaded).
  const netLog = join(downloadDir, 'netlog.json');
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [`--log-net-log=${netLog}`, ...LAUNCH_ARGS],
    cwd: DESKTOP_DIR,
    env: appEnv,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    // Exercise the app a little: thumbnails (pdf.js worker), typing into a text field, merging.
    await page.locator('#merge-input').setInputFiles(pdfFile('netz.pdf', await createPdf(2)));
    await expect(page.locator('#merge-list .merge-item-thumb canvas')).toHaveCount(1);
    await page.locator('#merge-filename').fill('Rechtschreibpruefung Testwort.pdf');
    await page.locator('#merge-run').click();
    await savedFile(downloadDir, 'Rechtschreibpruefung Testwort.pdf');
    // Give background services (e.g. a spellchecker dictionary download) time to start.
    await page.waitForTimeout(2000);
  } finally {
    await app.close();
  }

  const log = await readFile(netLog, 'utf8');
  const urls = [...new Set([...log.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]))];
  const external = urls.filter((url) => !/^(app|blob|data|devtools|file):/.test(url));
  expect(external, 'Netzwerkanfragen der App').toEqual([]);
});

test('ein zweiter Start öffnet kein zweites Fenster, sondern holt das vorhandene nach vorn', async ({
  electronApp,
  window,
  appEnv,
}) => {
  await expect(window.locator('#tab-merge')).toBeVisible();
  await electronApp.evaluate(({ app }) => {
    globalThis.__secondInstance = 0;
    app.on('second-instance', () => {
      globalThis.__secondInstance += 1;
    });
  });

  // Same profile as the running instance – the single-instance lock belongs to the profile.
  const second = spawn(ELECTRON_PATH, LAUNCH_ARGS, { cwd: DESKTOP_DIR, env: appEnv, stdio: 'ignore' });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('Die zweite Instanz hat sich nicht beendet.'));
    }, 30_000);
    second.once('error', reject);
    second.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(exitCode).toBe(0);
  await expect.poll(() => electronApp.evaluate(() => globalThis.__secondInstance)).toBe(1);
  expect(await windowTitles(electronApp)).toEqual(['PDF-Tool']);
});

test('Tastenkürzel zum Zoomen funktionieren auch mit deutscher Tastatur und Ziffernblock', async ({
  electronApp,
  window,
}) => {
  await expect(window.locator('#tab-merge')).toBeVisible();
  const zoomLevel = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  const cdp = await window.context().newCDPSession(window);
  // Windows virtual key codes; modifiers: Ctrl = 2, Shift = 8.
  const keys = {
    'Strg + „+“ (deutsche Tastatur, ohne Umschalt)': { key: '+', code: 'BracketRight', vk: 0xbb, modifiers: 2, zoom: 'in' },
    'Strg + Umschalt + „=“ (US-Tastatur)': { key: '+', code: 'Equal', vk: 0xbb, modifiers: 10, zoom: 'in' },
    'Strg + „+“ auf dem Ziffernblock': { key: '+', code: 'NumpadAdd', vk: 0x6b, modifiers: 2, zoom: 'in' },
    'Strg + „-“': { key: '-', code: 'Slash', vk: 0xbd, modifiers: 2, zoom: 'out' },
    'Strg + „-“ auf dem Ziffernblock': { key: '-', code: 'NumpadSubtract', vk: 0x6d, modifiers: 2, zoom: 'out' },
  };
  for (const [name, { key, code, vk, modifiers, zoom }] of Object.entries(keys)) {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(0));
    for (const type of ['rawKeyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    }
    await expect.poll(zoomLevel, { message: name }).toBe(zoom === 'in' ? 0.5 : -0.5);
  }
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(0));
});

test('Rechtsklick: Bearbeiten-Menü in Textfeldern, „Kopieren“ für markierten Text', async ({ electronApp, window }) => {
  await expect(window.locator('#merge-filename')).toBeVisible();
  // Record the menus instead of opening them (a native popup would wait for the user).
  await electronApp.evaluate(({ Menu }) => {
    globalThis.__contextMenus = [];
    Menu.prototype.popup = function popup() {
      globalThis.__contextMenus.push(this);
    };
  });
  const lastMenu = () =>
    electronApp.evaluate(() =>
      globalThis.__contextMenus.map((menu) => menu.items.filter((item) => item.type !== 'separator').map((item) => item.label))
    );

  await window.locator('#merge-filename').click({ button: 'right' });
  await expect
    .poll(lastMenu)
    .toEqual([['Rückgängig', 'Wiederherstellen', 'Ausschneiden', 'Kopieren', 'Einfügen', 'Alles auswählen']]);

  // „Einfügen“ really pastes, although the app denies every permission (no clipboard API needed).
  await window.locator('#merge-filename').fill('');
  const pasted = await electronApp.evaluate(({ BrowserWindow, clipboard }) => {
    const previous = clipboard.readText();
    clipboard.writeText('aus der Zwischenablage.pdf');
    const win = BrowserWindow.getAllWindows()[0];
    globalThis.__contextMenus[0].items.find((item) => item.label === 'Einfügen').click(undefined, win, win.webContents);
    return previous;
  });
  await expect(window.locator('#merge-filename')).toHaveValue('aus der Zwischenablage.pdf');
  await electronApp.evaluate(({ clipboard }, previous) => clipboard.writeText(previous), pasted);

  // Plain text without a selection: no menu at all.
  await window.locator('h1').click({ button: 'right' });
  await window.waitForTimeout(500);
  expect(await lastMenu()).toHaveLength(1);

  // Selected text: only „Kopieren“.
  await window.evaluate(() => getSelection().selectAllChildren(document.querySelector('.subtitle')));
  await window.locator('.subtitle').click({ button: 'right' });
  await expect.poll(lastMenu).toHaveLength(2);
  expect((await lastMenu())[1]).toEqual(['Kopieren']);
});
