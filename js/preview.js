/*
 * PdfPreview – thin wrapper around pdf.js (global `pdfjsLib`) for page thumbnails.
 *
 * Thumbnails are a nice-to-have: every failure surfaces as a rejected promise so the
 * UI can keep its placeholder and carry on. Nothing here touches the DOM except for
 * creating canvases (and, on file://, one <script> tag for the pdf.js worker code).
 *
 * API (global `PdfPreview`):
 *   isAvailable(): boolean
 *   open(bytes): Promise<{ numPages, renderThumbnail(pageIndex0, maxCssWidth, maxCssHeight?), destroy() }>
 */
(function (root) {
  'use strict';

  const WORKER_PATH = 'vendor/pdf.worker.min.js';
  // Upper bound for a single thumbnail canvas (device pixels) to keep memory in check
  // for huge page formats or high device pixel ratios.
  const MAX_CANVAS_PIXELS = 2048 * 2048;
  const MAX_PIXEL_RATIO = 2;

  let setupPromise = null;
  let sharedWorker = null;

  function getLib() {
    return root.pdfjsLib || null;
  }

  function isAvailable() {
    const lib = getLib();
    if (!lib || typeof lib.getDocument !== 'function' || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return typeof canvas.getContext === 'function';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error(`Skript konnte nicht geladen werden: ${src}`)), {
        once: true,
      });
      document.head.appendChild(script);
    });
  }

  /**
   * Configures pdf.js once. Over http(s) pdf.js starts vendor/pdf.worker.min.js as a real
   * Web Worker. Pages opened via file:// cannot start workers from local files; pdf.js would
   * then try a blob-wrapped importScripts() (which fails noisily) before falling back to its
   * main-thread "fake worker". Loading the worker code up front via <script> (it defines
   * `globalThis.pdfjsWorker`) makes pdf.js use the fake worker directly and silently.
   */
  function setup() {
    if (!setupPromise) {
      setupPromise = (async () => {
        const lib = getLib();
        if (!lib) throw new Error('pdf.js ist nicht verfügbar.');
        lib.GlobalWorkerOptions.workerSrc = new URL(WORKER_PATH, document.baseURI).href;
        if (root.location && root.location.protocol === 'file:' && !root.pdfjsWorker) {
          await loadScript(WORKER_PATH);
        }
      })();
      // Allow a retry later if the setup failed (e.g. the worker script was missing).
      setupPromise.catch(() => {
        setupPromise = null;
      });
    }
    return setupPromise;
  }

  /**
   * One real Web Worker shared by all documents – avoids starting a thread and re-parsing the
   * worker script for every thumbnail. With the main-thread fake worker (file://) there is
   * nothing to share; pdf.js then creates a cheap one per document (and, because getDocument
   * applies `verbosity` first, without logging a "fake worker" warning).
   */
  function getWorker(lib) {
    if (root.pdfjsWorker) return undefined;
    if (!sharedWorker || sharedWorker.destroyed) {
      sharedWorker = new lib.PDFWorker({ name: 'pdf-tool-preview', verbosity: lib.VerbosityLevel.ERRORS });
    }
    return sharedWorker;
  }

  /**
   * pdf.js transfers (detaches) the ArrayBuffer it receives to its worker. Always hand it a
   * private copy so the caller's bytes stay usable for pdf-lib.
   */
  function copyBytes(bytes) {
    if (bytes instanceof Uint8Array) return bytes.slice();
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0));
    if (ArrayBuffer.isView(bytes)) {
      return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    throw new TypeError('PdfPreview.open erwartet ein Uint8Array oder einen ArrayBuffer.');
  }

  async function renderPage(doc, pageIndex, maxCssWidth, maxCssHeight) {
    const page = await doc.getPage(pageIndex + 1);
    try {
      const base = page.getViewport({ scale: 1 }); // includes the page's /Rotate
      let cssScale = maxCssWidth / base.width;
      if (Number.isFinite(maxCssHeight) && maxCssHeight > 0) {
        cssScale = Math.min(cssScale, maxCssHeight / base.height);
      }
      const ratio = Math.min(Math.max(root.devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);
      let scale = cssScale * ratio;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${Math.max(1, Math.round(base.width * cssScale))}px`;
      canvas.style.height = `${Math.max(1, Math.round(base.height * cssScale))}px`;
      canvas.setAttribute('aria-hidden', 'true');

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas wird nicht unterstützt.');
      await page.render({ canvasContext: context, viewport, intent: 'display' }).promise;
      return canvas;
    } finally {
      page.cleanup();
    }
  }

  async function open(bytes) {
    await setup();
    const lib = getLib();
    const loadingTask = lib.getDocument({
      data: copyBytes(bytes),
      worker: getWorker(lib),
      // Security: never compile PDF-provided code (CVE-2024-4367 for pdf.js < 4.2.67).
      isEvalSupported: false,
      enableXfa: false,
      verbosity: lib.VerbosityLevel.ERRORS,
    });

    let doc;
    try {
      doc = await loadingTask.promise;
    } catch (err) {
      loadingTask.destroy().catch(() => {});
      throw err;
    }

    let destroyed = false;
    return {
      numPages: doc.numPages,
      renderThumbnail(pageIndex, maxCssWidth, maxCssHeight) {
        if (destroyed) return Promise.reject(new Error('Die Vorschau wurde bereits geschlossen.'));
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) {
          return Promise.reject(new RangeError(`Ungültiger Seitenindex: ${pageIndex}`));
        }
        return renderPage(doc, pageIndex, maxCssWidth, maxCssHeight);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        loadingTask.destroy().catch(() => {});
      },
    };
  }

  root.PdfPreview = Object.freeze({ isAvailable, open });
})(typeof globalThis !== 'undefined' ? globalThis : window);
