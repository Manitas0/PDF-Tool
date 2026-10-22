'use strict';

/*
 * PDF-Tool desktop – Electron main process.
 *
 * The desktop app is the unchanged web app (copied into ./app by scripts/prepare-app.mjs)
 * wrapped in a locked-down Electron window:
 *   - the files are served over the privileged custom scheme app://pdf-tool/ instead of file://,
 *     so the page has a real origin: pdf.js can start its Web Worker and the page's CSP 'self' works;
 *   - the renderer has no Node.js access (sandbox + context isolation, no preload);
 *   - no permissions, no navigation away from the app, no network access at all (webRequest blocks
 *     requests, a dead proxy plus the WebRTC IP handling policy block WebRTC's own UDP/TCP traffic);
 *   - downloads triggered by the page (<a download> with blob: URLs) open a native "Speichern unter" dialog.
 */

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, dialog, nativeTheme, net, protocol, session, shell } = require('electron');

const APP_ID = 'io.github.manitas0.pdftool';
const PRODUCT_NAME = 'PDF-Tool';
const SCHEME = 'app';
const HOST = 'pdf-tool';
const INDEX_URL = `${SCHEME}://${HOST}/index.html`;
const APP_DIR = path.join(__dirname, 'app');
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const LICENSE_DIR = '/vendor/licenses/';
const LICENSE_TITLES = {
  'pdf-lib-LICENSE.md': 'pdf-lib',
  'pdfjs-LICENSE': 'pdf.js',
  'jszip-LICENSE.md': 'JSZip',
};
// Matches --bg of css/styles.css, so a window never flashes white in dark mode (or black in light mode).
const BACKGROUND = { light: '#f5f6fa', dark: '#0e1117' };

// Only for the automated tests: save downloads silently into this folder instead of asking.
// Ignored by packaged builds, so an installed app always asks where to save.
const E2E_DOWNLOAD_DIR = app.isPackaged ? '' : process.env.PDF_TOOL_E2E_DOWNLOAD_DIR || '';
// Only for the automated tests: a fresh profile folder per app instance. Ignored by packaged builds.
const E2E_USER_DATA_DIR = app.isPackaged ? '' : process.env.PDF_TOOL_E2E_USER_DATA_DIR || '';
// Unreachable on purpose (port 9 = discard): see configureSession().
const DEAD_PROXY = 'http://127.0.0.1:9';

// Everything the app serves; anything else (unknown extensions included) is answered with 404.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  // License texts (e.g. vendor/licenses/pdfjs-LICENSE has no extension) are shown as plain text.
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '': 'text/plain; charset=utf-8',
};

// Request schemes the app may use; everything else (http, https, ws, file, ftp …) is cancelled.
const ALLOWED_REQUEST_SCHEMES = new Set([`${SCHEME}:`, 'blob:', 'data:', 'devtools:']);

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// Sandbox every renderer process. Skipped only when --no-sandbox was passed explicitly (the
// automated tests need that when they run as root on Linux); the windows below still request
// `sandbox: true` themselves.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

let mainWindow = null;
let licenseWindow = null;
// Folder of the last "Speichern unter" dialog – remembered while the app is running.
let lastSaveDir = null;

/* ------------------------------------------------------------------ helpers */

function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light;
}

function secureWebPreferences() {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false, // the spellchecker would download dictionaries
    devTools: !app.isPackaged,
  };
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isHttpUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed) && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
}

function isIndexUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed) && parsed.protocol === `${SCHEME}:` && parsed.host === HOST && parsed.pathname === '/index.html';
}

/**
 * Maps the path of an app:// URL to a file inside APP_DIR, or returns null if the path is not
 * acceptable. Strict on purpose: the app only consists of plain ASCII file names.
 * @param {string} pathname still percent-encoded, as in URL#pathname
 */
function resolveAppFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  // No backslashes, colons, NUL bytes, percent signs (double encoding) or other unusual characters.
  if (!/^\/[A-Za-z0-9._\-/]+$/.test(decoded)) return null;
  const segments = decoded.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;

  const filePath = path.resolve(APP_DIR, ...segments);
  return isInsideAppDir(filePath) ? filePath : null;
}

/** True if `filePath` lies inside APP_DIR (APP_DIR itself does not count). */
function isInsideAppDir(filePath) {
  const relative = path.relative(APP_DIR, filePath);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function textResponse(status, text) {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
  });
}

/** Handler for app://pdf-tool/<path> – serves the files of APP_DIR (inside app.asar when packaged). */
async function handleAppRequest(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Methode nicht erlaubt');
  const url = parseUrl(request.url);
  if (!url || url.host !== HOST) return textResponse(404, 'Nicht gefunden');

  const filePath = resolveAppFile(url.pathname);
  const type = filePath && MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!filePath || !type) return textResponse(404, 'Nicht gefunden');

  try {
    // fs is asar-aware in Electron; this also rules out directories (file:// would list them).
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return textResponse(404, 'Nicht gefunden');
  } catch {
    return textResponse(404, 'Nicht gefunden');
  }

  let upstream;
  try {
    upstream = await net.fetch(pathToFileURL(filePath).href);
  } catch {
    return textResponse(404, 'Nicht gefunden');
  }
  if (!upstream.ok) return textResponse(404, 'Nicht gefunden');
  const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' };
  // Plain-text documents (license texts) need no scripts, styles or anything else.
  if (type.startsWith('text/plain')) headers['content-security-policy'] = "default-src 'none'";
  // A Web Worker (pdf.worker.min.js, which parses the untrusted PDFs) takes its CSP from its own
  // response, not from the <meta> CSP of index.html: no eval/new Function, no fetch, no imports.
  // Classic <script> includes ignore this header. A future pdf.js with WASM decoders would need
  // 'wasm-unsafe-eval' here (and possibly a connect-src for the .wasm file).
  if (type.startsWith('text/javascript')) headers['content-security-policy'] = "default-src 'none'";
  if (request.method === 'HEAD') {
    await upstream.body?.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(upstream.body, { status: 200, headers });
}

/* ------------------------------------------------------------------ session hardening */

async function configureSession(ses) {
  // The built-in spellchecker would download Hunspell dictionaries from Google's servers – outside
  // of webRequest. The app has no free-text fields worth spellchecking, so switch it off entirely
  // and drop its languages (disabling it alone does not stop the download). Must run right when the
  // app is ready, before any `await`: a fresh profile otherwise starts the download in the meantime.
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);

  // The app needs no permissions at all (no camera, notifications, clipboard API, …).
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback(null));

  // Defense in depth: the app works fully offline, so no request may leave the app (WebRTC: see below).
  // file: is only allowed for the app's own files, which the app:// handler reads via net.fetch.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = parseUrl(details.url);
    let allowed = Boolean(url) && ALLOWED_REQUEST_SCHEMES.has(url.protocol);
    if (url && url.protocol === 'file:') {
      try {
        allowed = isInsideAppDir(fileURLToPath(url));
      } catch {
        allowed = false; // e.g. a file URL with a host on Linux
      }
    }
    callback({ cancel: !allowed });
  });

  ses.on('will-download', (_event, item) => {
    const fileName = path.basename(item.getFilename()) || 'dokument.pdf';

    if (E2E_DOWNLOAD_DIR) {
      item.setSavePath(path.join(E2E_DOWNLOAD_DIR, fileName));
      return;
    }

    const extension = path.extname(fileName).toLowerCase();
    const filters = [];
    if (extension === '.pdf') filters.push({ name: 'PDF-Dokument', extensions: ['pdf'] });
    if (extension === '.zip') filters.push({ name: 'ZIP-Archiv', extensions: ['zip'] });
    filters.push({ name: 'Alle Dateien', extensions: ['*'] });

    item.setSaveDialogOptions({
      title: 'Speichern unter',
      defaultPath: path.join(lastSaveDir || app.getPath('downloads'), fileName),
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    item.once('done', (_doneEvent, state) => {
      const savePath = item.getSavePath();
      if (state === 'completed' && savePath) {
        lastSaveDir = path.dirname(savePath);
      } else if (state === 'interrupted') {
        const options = {
          type: 'error',
          title: 'Speichern fehlgeschlagen',
          message: `„${fileName}“ konnte nicht gespeichert werden.`,
          detail: 'Bitte wähle einen anderen Speicherort und versuche es erneut.',
          buttons: ['OK'],
        };
        if (mainWindow && !mainWindow.isDestroyed()) dialog.showMessageBox(mainWindow, options);
        else dialog.showMessageBox(options);
      }
    });
  });

  // WebRTC (ICE: STUN/TURN over UDP and TCP) bypasses webRequest. hardenWebContents() limits WebRTC
  // to proxied connections; this proxy is dead on purpose, so WebRTC's TCP fallback fails as well.
  // Ordinary http(s)/ws requests never reach it (webRequest cancels them first), and app:, blob:,
  // data: and file: are not proxied. '<-loopback>' sends loopback addresses to the proxy too.
  await ses.setProxy({ proxyRules: DEAD_PROXY, proxyBypassRules: '<-loopback>' });
}

/**
 * Applied to every webContents: no <webview>, no new windows and no renderer-initiated navigation
 * (only the main window may navigate to index.html itself). http(s) URLs meant for a new window
 * open in the default browser; the license links of the footer open in a separate read-only window.
 */
function hardenWebContents(contents) {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // WebRTC may only use proxied connections – and the session's proxy is dead (configureSession).
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  contents.on('context-menu', (_event, params) => showContextMenu(contents, params));

  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      shell.openExternal(url).catch(() => {});
    } else if (licenseFileName(url)) {
      openLicenseWindow(url);
    }
    return { action: 'deny' };
  });

  const guardNavigation = (details) => {
    const isMain = mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
    if (isMain && isIndexUrl(details.url)) return;
    details.preventDefault();
    if (isMain && licenseFileName(details.url)) openLicenseWindow(details.url);
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
}

/**
 * Electron has no context menu of its own. Like a browser, offer the edit commands in text fields
 * (file name, page ranges) and „Kopieren“ for selected text; nothing anywhere else.
 */
function showContextMenu(contents, params) {
  const flags = params.editFlags;
  let template;
  if (params.isEditable) {
    template = [
      { role: 'undo', label: 'Rückgängig', enabled: flags.canUndo },
      { role: 'redo', label: 'Wiederherstellen', enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden', enabled: flags.canCut },
      { role: 'copy', label: 'Kopieren', enabled: flags.canCopy },
      { role: 'paste', label: 'Einfügen', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Alles auswählen', enabled: flags.canSelectAll },
    ];
  } else if (params.selectionText.trim()) {
    template = [{ role: 'copy', label: 'Kopieren', enabled: flags.canCopy }];
  } else {
    return;
  }
  const window = BrowserWindow.fromWebContents(contents);
  Menu.buildFromTemplate(template).popup(window ? { window } : {});
}

/* ------------------------------------------------------------------ windows */

/** Returns the license file name if `url` points at one of the bundled license texts. */
function licenseFileName(url) {
  const parsed = parseUrl(url);
  if (!parsed || parsed.protocol !== `${SCHEME}:` || parsed.host !== HOST) return null;
  if (!parsed.pathname.startsWith(LICENSE_DIR)) return null;
  const name = parsed.pathname.slice(LICENSE_DIR.length);
  if (!/^[A-Za-z0-9._-]+$/.test(name) || !resolveAppFile(parsed.pathname)) return null;
  return name;
}

function openLicenseWindow(url) {
  const name = licenseFileName(url);
  if (!name) return;
  const target = `${SCHEME}://${HOST}${LICENSE_DIR}${name}`;
  const title = `Lizenz – ${LICENSE_TITLES[name] || name}`;

  if (!licenseWindow || licenseWindow.isDestroyed()) {
    licenseWindow = new BrowserWindow({
      title,
      width: 760,
      height: 680,
      minWidth: 360,
      minHeight: 300,
      show: false,
      icon: ICON_PATH,
      autoHideMenuBar: true,
      backgroundColor: backgroundColor(),
      webPreferences: secureWebPreferences(),
    });
    licenseWindow.on('page-title-updated', (event) => event.preventDefault());
    licenseWindow.once('ready-to-show', () => licenseWindow && licenseWindow.show());
    licenseWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        licenseWindow.close();
      }
    });
    licenseWindow.on('closed', () => {
      licenseWindow = null;
    });
  } else {
    if (licenseWindow.isMinimized()) licenseWindow.restore();
    licenseWindow.show();
    licenseWindow.focus();
  }
  licenseWindow.setTitle(title);
  licenseWindow.loadURL(target).catch(() => {});
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1200,
    height: 860,
    minWidth: 400,
    minHeight: 500,
    show: false,
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(),
    webPreferences: secureWebPreferences(),
  });

  // Keep the window title „PDF-Tool“ instead of the page's longer <title>.
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    // The license window belongs to the main window.
    if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
  });

  mainWindow.loadURL(INDEX_URL).catch((err) => {
    dialog.showErrorBox(PRODUCT_NAME, `Die Oberfläche konnte nicht geladen werden.\n\n${err && err.message}`);
  });
}

function showAboutDialog() {
  const options = {
    type: 'info',
    title: `Über ${PRODUCT_NAME}`,
    message: `${PRODUCT_NAME} ${app.getVersion()}`,
    detail: [
      'PDFs zusammenführen und teilen.',
      '',
      'Verarbeitung lokal mit pdf-lib, pdf.js und JSZip.',
      'Deine Dateien verlassen nie deinen Rechner – die App lädt nichts hoch und braucht keine Internetverbindung.',
    ].join('\n'),
    buttons: ['OK'],
    noLink: true,
  };
  const parent = BrowserWindow.getFocusedWindow() || mainWindow;
  if (parent && !parent.isDestroyed()) dialog.showMessageBox(parent, options);
  else dialog.showMessageBox(options);
}

function buildMenu() {
  const viewItems = [];
  if (!app.isPackaged) {
    viewItems.push(
      { role: 'reload', label: 'Neu laden' },
      { role: 'toggleDevTools', label: 'Entwicklertools' },
      { type: 'separator' }
    );
  }
  viewItems.push(
    { role: 'resetZoom', label: 'Originalgröße' },
    { role: 'zoomIn', label: 'Vergrößern' },
    { role: 'zoomOut', label: 'Verkleinern' },
    // Hidden extra shortcuts: the zoomIn role listens for Ctrl+Shift+„=“ (US layout). On a German
    // keyboard „+“ is that key without Shift (Ctrl+„=“ here); the numeric keypad has its own keys.
    { role: 'zoomIn', label: 'Vergrößern', accelerator: 'CommandOrControl+=', visible: false },
    { role: 'zoomIn', label: 'Vergrößern', accelerator: 'CommandOrControl+numadd', visible: false },
    { role: 'zoomOut', label: 'Verkleinern', accelerator: 'CommandOrControl+numsub', visible: false },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Vollbild' }
  );

  // „&“ marks the access key of a menu (Alt+D, Alt+B, Alt+A, Alt+H on Windows).
  return Menu.buildFromTemplate([
    { label: '&Datei', submenu: [{ role: 'quit', label: 'Beenden' }] },
    {
      label: '&Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederherstellen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    { label: '&Ansicht', submenu: viewItems },
    { label: '&Hilfe', submenu: [{ label: `Über ${PRODUCT_NAME}`, click: showAboutDialog }] },
  ]);
}

/* ------------------------------------------------------------------ app lifecycle */

// Development and test runs (`npm start`, `npm test`) get a profile of their own: they share
// neither data nor the single-instance lock with an installed or portable PDF-Tool, which would
// otherwise make them quit immediately. The tests additionally pass a fresh folder per instance.
if (!app.isPackaged) {
  app.setPath('userData', E2E_USER_DATA_DIR || path.join(app.getPath('appData'), `${PRODUCT_NAME}-Dev`));
}

if (!app.requestSingleInstanceLock()) {
  // Another instance is already running – it gets focused via 'second-instance'.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(backgroundColor());
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
    await configureSession(session.defaultSession);
    protocol.handle(SCHEME, handleAppRequest);
    Menu.setApplicationMenu(buildMenu());
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch((err) => {
    // Never open the window without the session hardening; tell the user instead of hanging silently.
    dialog.showErrorBox(PRODUCT_NAME, `PDF-Tool konnte nicht gestartet werden.\n\n${err && err.message}`);
    app.quit();
  });
}
