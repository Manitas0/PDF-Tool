// Shared helpers for the end-to-end tests.
//
// Test PDFs are generated in Node with pdf-lib. Every page gets a unique width
// (e.g. file A: 100, 101, 102 pt; file B: 200, 201, … pt), so the order and
// selection of pages in a downloaded result can be verified by reading the
// page widths back with pdf-lib.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

export { expect };

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const INDEX_FILE_URL = pathToFileURL(join(PROJECT_ROOT, 'index.html')).href;

const PAGE_HEIGHT = 300;

/**
 * `test` with a `page` fixture that records console errors and uncaught page
 * errors and fails the test if any occurred. Individual specs can tolerate
 * known messages via `test.use({ allowedErrors: [/regex/] })`.
 */
export const test = base.extend({
  allowedErrors: [[], { option: true }],

  page: async ({ page, allowedErrors }, use, testInfo) => {
    const errors = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const { url, lineNumber } = message.location();
      errors.push(`console.error: ${message.text()}${url ? ` (${url}:${lineNumber})` : ''}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack || error.message}`));
    page.on('crash', () => errors.push('Die Seite ist abgestürzt.'));

    await use(page);

    const unexpected = errors.filter((entry) => !allowedErrors.some((pattern) => pattern.test(entry)));
    if (unexpected.length > 0) {
      await testInfo.attach('browser-fehler.txt', { body: unexpected.join('\n\n'), contentType: 'text/plain' });
    }
    // Do not mask the original failure of a test that already failed.
    if (testInfo.status === testInfo.expectedStatus) {
      expect(unexpected, 'Konsolen- oder Seitenfehler während des Tests').toEqual([]);
    }
  },
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/**
 * Creates a PDF with `pageCount` pages whose widths are
 * `baseWidth`, `baseWidth + 1`, … so each page is identifiable.
 * @returns {Promise<Uint8Array>}
 */
export async function createPdf(pageCount, { baseWidth = 100, label = 'Seite' } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([baseWidth + i, PAGE_HEIGHT]);
    page.drawRectangle({ x: 8, y: 8, width: baseWidth + i - 16, height: PAGE_HEIGHT - 16, color: rgb(0.86, 0.9, 1) });
    page.drawText(`${label} ${i + 1}`, { x: 14, y: PAGE_HEIGHT - 40, size: 14, font, color: rgb(0.1, 0.1, 0.3) });
  }
  return doc.save();
}

/** A syntactically valid PDF whose trailer declares encryption (pdf-lib refuses to load it). */
export async function createEncryptedPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([200, PAGE_HEIGHT]);
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 1, R: 2, P: -4 });
  return doc.save();
}

/** Starts like a PDF but cannot be parsed. */
export function createBrokenPdf() {
  return new TextEncoder().encode('%PDF-1.7\nDas ist leider kein gültiges PDF-Dokument.\n%%EOF\n');
}

/** Input for `locator.setInputFiles()`. */
export function pdfFile(name, bytes) {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) };
}

export function textFile(name, text) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') };
}

// ---------------------------------------------------------------------------
// Inspecting results
// ---------------------------------------------------------------------------

/** Page widths (rounded) of a PDF, in page order. */
export async function readPageWidths(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

/** Runs `action` and resolves with the download it triggers. */
export async function captureDownload(page, action) {
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  return download;
}

/** Waits for a download to finish and returns its content. */
export async function downloadBytes(download) {
  expect(await download.failure(), 'Download fehlgeschlagen').toBeNull();
  return new Uint8Array(await readFile(await download.path()));
}

/**
 * Reads a ZIP archive.
 * @returns {Promise<{ names: string[], files: Map<string, Uint8Array> }>} names sorted alphabetically
 */
export async function readZip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const files = new Map();
  for (const entry of entries) {
    files.set(entry.name, await entry.async('uint8array'));
  }
  return { names: [...files.keys()].sort(), files };
}

/** Expands a 1-based page list like "2, 5-6, 9" into [2, 5, 6, 9] (ascending ranges only). */
export function expandPageList(text) {
  return text
    .split(/[,;]/)
    .map((token) => token.replace(/\s+/g, ''))
    .filter(Boolean)
    .flatMap((token) => {
      const [from, to = from] = token.split(/[-–—]/).map(Number);
      return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    });
}

/** Regex that matches "1 Seite" but not "1 Seiten" or "11 Seite". */
export const ONE_PAGE = /(^|\D)1 Seite(?!n)/;

// ---------------------------------------------------------------------------
// App interaction
// ---------------------------------------------------------------------------

export const mergeItems = (page) => page.locator('#merge-list li.merge-item');
export const splitThumbs = (page) => page.locator('#split-thumbnails button.page-thumb');

export async function expectIdle(page) {
  await expect(page.locator('#busy')).toBeHidden();
}

export async function addMergeFiles(page, files) {
  await page.locator('#merge-input').setInputFiles(files);
}

/** Opens the split tab and loads `file` into it. */
export async function loadSplitFile(page, file) {
  await page.locator('#tab-split').click();
  await expect(page.locator('#panel-split')).toBeVisible();
  await page.locator('#split-input').setInputFiles(file);
  await expect(page.locator('#split-file-info')).toBeVisible();
  await expectIdle(page);
}

export async function selectSplitMode(page, mode) {
  const radio = page.locator(`input[name="split-mode"][value="${mode}"]`);
  await radio.check();
  await expect(radio).toBeChecked();
}

/** Simulates dropping files (as produced by `pdfFile()`) onto the element matching `selector`. */
export async function dropFiles(page, selector, files) {
  const payload = files.map((file) => ({ name: file.name, type: file.mimeType, data: [...file.buffer] }));
  return page.evaluate(
    ({ selector, payload }) => {
      const target = document.querySelector(selector);
      const dataTransfer = new DataTransfer();
      for (const { name, type, data } of payload) {
        dataTransfer.items.add(new File([new Uint8Array(data)], name, { type }));
      }
      const prevented = {};
      for (const type of ['dragenter', 'dragover', 'drop']) {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
        target.dispatchEvent(event);
        prevented[type] = event.defaultPrevented;
      }
      return prevented;
    },
    { selector, payload },
  );
}
